import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresSql, PostgresStore } from '../server/postgres.ts';

test('PostgreSQL convierte parámetros sin interpretar los signos dentro de literales', () => {
  assert.equal(postgresSql("SELECT '?' AS literal,rowid FROM parcels WHERE code=? AND state='O''Brien?' AND org_id=?"),
    "SELECT '?' AS literal,_sequence FROM parcels WHERE code=$1 AND state='O''Brien?' AND org_id=$2");
});

test('PostgreSQL rechaza configuración incompleta y esquemas ajenos a Nexora', () => {
  assert.throws(() => new PostgresStore(''), /DATABASE_URL/);
  assert.throws(() => new PostgresStore('postgresql://example.invalid', 'public'), /Esquema/);
  assert.throws(() => new PostgresStore('https://example.invalid'), /PostgreSQL/);
});
