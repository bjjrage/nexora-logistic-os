import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError } from './errors.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from './database.ts';

export type Row = Record<string, any>;
export class Store implements Database {
  readonly kind = 'sqlite' as const;
  private context = new AsyncLocalStorage<boolean>();
  private queue: Promise<unknown> = Promise.resolve();
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
      this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(1,?)').run(new Date().toISOString());
      if (!this.db.prepare('SELECT version FROM schema_migrations WHERE version=2').get()) {
        this.db.exec(readFileSync(new URL('./migrations/002_controls.sql', import.meta.url), 'utf8'));
        this.db.prepare('INSERT INTO schema_migrations VALUES(2,?)').run(new Date().toISOString());
      }
      if (!this.db.prepare('SELECT version FROM schema_migrations WHERE version=3').get()) {
        this.db.exec(readFileSync(new URL('./migrations/003_tracking.sql', import.meta.url), 'utf8'));
        this.db.prepare('INSERT INTO schema_migrations VALUES(3,?)').run(new Date().toISOString());
      }
      for(const [version,file] of [[4,'004_inventory.sql'],[5,'005_customer_access.sql'],[6,'006_quad_operations.sql'],[7,'007_inventory_imports.sql'],[8,'008_traccar.sql'],[9,'009_client_profiles.sql'],[10,'010_stable_client_providers.sql'],[11,'011_password_recovery.sql'],[12,'012_listing_indexes.sql'],[13,'013_recovery_audit.sql'],[14,'014_staff_access.sql'],[15,'015_billing.sql'],[16,'016_super_admin_owner.sql']] as const) {
        const path=new URL(`./migrations/${file}`,import.meta.url);
        if(existsSync(path)&&!this.db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(version)) {
          this.db.exec(readFileSync(path,'utf8'));
          this.db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,new Date().toISOString());
        }
      }
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
  }
  private exclusive<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
  }
  private query<T>(work: () => T): Promise<T> { return this.context.getStore() ? Promise.resolve(work()) : this.exclusive(work); }
  all(sql: string, ...params: SQLInputValue[]): Promise<Row[]> { return this.query(() => this.db.prepare(sql).all(...params) as Row[]); }
  one(sql: string, ...params: SQLInputValue[]): Promise<Row | undefined> { return this.query(() => this.db.prepare(sql).get(...params) as Row | undefined); }
  run(sql: string, ...params: SQLInputValue[]) { return this.query(() => this.db.prepare(sql).run(...params)); }
  async transaction<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.context.getStore()) return work();
    return this.exclusive(() => this.context.run(true, async () => {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = await work(); this.db.exec('COMMIT'); return result; }
    catch (error) {
      this.db.exec('ROLLBACK');
      if (error instanceof Error && /UNIQUE constraint failed: client_profiles.org_id, client_profiles.tax_id/.test(error.message)) throw new DomainError('VALIDATION_ERROR','Ya existe un cliente con ese RUC en tu empresa.',409);
      if (error instanceof Error && /ROUTE_RESOURCE_CONFLICT|UNIQUE constraint failed: route_assignments.parcel_id/.test(error.message)) throw new DomainError('VERSION_CONFLICT','El recurso ya está comprometido en otra ruta.');
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw new DomainError('VALIDATION_ERROR','Ya existe un registro con esa referencia.',409);
      throw error;
    }
    }));
  }
  async close() { await this.queue; this.db.close(); }
}
export function camel(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value]));
}
