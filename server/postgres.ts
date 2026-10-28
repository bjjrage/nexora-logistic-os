import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Database, Row, SqlValue } from './database.ts';
import { DomainError } from './errors.ts';

// Shared domain SQL uses positional '?' parameters. Preserve literals and quoted identifiers.
export function postgresSql(sql: string): string {
  let quoted = false, identifier = false, index = 0, result = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !identifier) {
      if (quoted && sql[i + 1] === "'") { result += "''"; i++; continue; }
      quoted = !quoted;
    } else if (ch === '"' && !quoted) identifier = !identifier;
    result += ch === '?' && !quoted && !identifier ? `$${++index}` : ch;
  }
  return result.replace(/\browid\b/g, '_sequence');
}

export class PostgresStore implements Database {
  readonly kind = 'postgres' as const;
  private pool: pg.Pool;
  private context = new AsyncLocalStorage<{ client: pg.PoolClient; savepoint: number }>();
  private schema: string;
  constructor(connectionString: string, schema = 'nexora') {
    if (!connectionString) throw new Error('Falta DATABASE_URL en el archivo privado .env.');
    if (!/^nexora(?:_test_[a-z0-9_]+)?$/.test(schema)) throw new Error('Esquema de Nexora inválido.');
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL debe ser una URI PostgreSQL.');
    // Keep certificate validation explicit; URI SSL settings must not override it.
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
    this.schema = schema;
    const localTest=process.env.NODE_ENV==='test'&&process.env.DATABASE_LOCAL_TEST==='true'&&['127.0.0.1','localhost'].includes(url.hostname)&&/^\/nexora_test[a-z0-9_]*$/.test(url.pathname);
    this.pool = new pg.Pool({ connectionString: url.toString(), max: 5, connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000, statement_timeout: 20_000, application_name: 'nexora-os',
      ssl: localTest?false:{ rejectUnauthorized: true, ca: readFileSync(process.env.PGSSLROOTCERT ?? new URL('./certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8') },
      types: { getTypeParser: (oid: number, format?: string) => {
        if (oid === 1184) return (value: string) => new Date(value).toISOString();
        if (oid === 20) return (value: string) => { const number = Number(value); if (!Number.isSafeInteger(number)) throw new Error('Valor entero fuera de rango.'); return number; };
        return pg.types.getTypeParser(oid, format as 'text');
      } },
    });
    this.pool.on('error', () => console.error('Se interrumpió una conexión de la base de Nexora.'));
  }
  private async query(sql: string, params: SqlValue[]) {
    const active = this.context.getStore();
    const client = active?.client ?? await this.pool.connect();
    try {
      if (!active) await client.query(`SET search_path TO "${this.schema}", pg_catalog`);
      const result = await client.query(postgresSql(sql), params.map(value => value instanceof Uint8Array ? Buffer.from(value) : value));
      return result;
    } catch (error) {
      throw this.domainError(error);
    } finally { if (!active) client.release(); }
  }
  private domainError(error: unknown): unknown {
    const failure = error as { code?: string; constraint?: string };
    if (failure.code === '23505' && failure.constraint === 'client_profiles_tax_id_unique') return new DomainError('VALIDATION_ERROR','Ya existe un cliente con ese RUC en tu empresa.',409);
    if (failure.code === '23505' && ['routes_driver_in_progress','routes_vehicle_in_progress'].includes(failure.constraint ?? '')) return new DomainError('VERSION_CONFLICT', 'El chofer o el vehículo sigue en reparto en otra ruta. Finalizá esa ruta antes de registrar otra salida.');
    if (failure.code === '23P01') return new DomainError('VERSION_CONFLICT', 'El chofer o el vehículo ya está asignado a otra ruta en ese horario.');
    if (failure.code === '23505' && failure.constraint === 'one_active_assignment') return new DomainError('VERSION_CONFLICT', 'El bulto ya está asignado a otra ruta.');
    if (failure.code === '23505') return new DomainError('VALIDATION_ERROR', 'Ya existe un registro con esa referencia.', 409);
    if (failure.code === '23503' || failure.code === '23514') return new DomainError('VALIDATION_ERROR', 'La operación no cumple las reglas de integridad.', 400);
    return error;
  }
  async all(sql: string, ...params: SqlValue[]): Promise<Row[]> {
    return (await this.query(sql, params)).rows.map(({ _sequence: _ignored, ...row }) => row);
  }
  async one(sql: string, ...params: SqlValue[]) { return (await this.all(sql, ...params))[0]; }
  async run(sql: string, ...params: SqlValue[]) { return { changes: (await this.query(sql, params)).rowCount ?? 0 }; }
  async transaction<T>(work: () => T | Promise<T>): Promise<T> {
    const active = this.context.getStore();
    if (active) {
      const name = `nexora_savepoint_${++active.savepoint}`;
      await active.client.query(`SAVEPOINT ${name}`);
      try { const value = await work(); await active.client.query(`RELEASE SAVEPOINT ${name}`); return value; }
      catch (error) { await active.client.query(`ROLLBACK TO SAVEPOINT ${name}`); await active.client.query(`RELEASE SAVEPOINT ${name}`); throw this.domainError(error); }
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path TO "${this.schema}", pg_catalog`);
      // Preserve the serialized command semantics of the previous SQLite core, across servers.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`nexora-commands:${this.schema}`]);
      const result = await this.context.run({ client, savepoint: 0 }, work);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw this.domainError(error); }
    finally { client.release(); }
  }
  async verify() {
    const versions = await this.all('SELECT version FROM schema_migrations ORDER BY version');
    if (versions.map(row => row.version).join(',') !== '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16') throw new Error('La base de Nexora no tiene las migraciones esperadas.');
  }
  async close() { await this.pool.end(); }
}
