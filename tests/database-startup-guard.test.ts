import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeDatabaseStartup } from '../server/database-startup-guard.ts';

const base = {
  NODE_ENV: 'development',
  DATABASE_PROVIDER: 'postgres',
  DATABASE_URL: 'postgresql://nexora:private-password@db.prodref.supabase.co:5432/postgres',
};

test('local development rejects a remote production database without revealing its URI', () => {
  assert.throws(
    () => assertSafeDatabaseStartup(base),
    error => error instanceof Error && /Desarrollo local solo permite/.test(error.message)
      && !error.message.includes('private-password')
      && !error.message.includes('prodref'),
  );
});

test('local development allows loopback PostgreSQL and SQLite', () => {
  assert.doesNotThrow(() => assertSafeDatabaseStartup({
    NODE_ENV: 'development', DATABASE_PROVIDER: 'postgres', DATABASE_URL: 'postgres://nexora:secret@127.0.0.1:5432/nexora_dev',
  }));
  assert.doesNotThrow(() => assertSafeDatabaseStartup({ NODE_ENV: 'development', DATABASE_PROVIDER: 'sqlite' }));
});

test('remote staging requires a host or project ref distinct from production', () => {
  assert.doesNotThrow(() => assertSafeDatabaseStartup({
    ...base,
    DATABASE_TARGET: 'staging',
    DATABASE_URL: 'postgresql://nexora:secret@db.stageref.supabase.co:5432/postgres',
    DATABASE_STAGING_HOST: 'db.stageref.supabase.co',
    DATABASE_PRODUCTION_HOST: 'db.prodref.supabase.co',
    DATABASE_STAGING_PROJECT_REF: 'stageref',
    DATABASE_PRODUCTION_PROJECT_REF: 'prodref',
  }));
  assert.throws(() => assertSafeDatabaseStartup({
    ...base,
    DATABASE_TARGET: 'staging',
    DATABASE_STAGING_HOST: 'db.prodref.supabase.co',
    DATABASE_PRODUCTION_HOST: 'db.prodref.supabase.co',
    DATABASE_STAGING_PROJECT_REF: 'prodref',
    DATABASE_PRODUCTION_PROJECT_REF: 'prodref',
  }), /project ref/);
  assert.throws(() => assertSafeDatabaseStartup({
    ...base,
    DATABASE_TARGET: 'staging',
    DATABASE_STAGING_HOST: 'db.stageref.supabase.co',
    DATABASE_PRODUCTION_HOST: 'db.prodref.supabase.co',
    DATABASE_STAGING_PROJECT_REF: 'stageref',
    DATABASE_PRODUCTION_PROJECT_REF: 'prodref',
  }), /host de staging/);
  assert.throws(() => assertSafeDatabaseStartup({
    ...base,
    DATABASE_TARGET: 'staging',
    DATABASE_URL: 'postgresql://postgres.prodref:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
    DATABASE_STAGING_HOST: 'aws-0-us-east-1.pooler.supabase.com',
    DATABASE_PRODUCTION_HOST: 'aws-0-us-east-1.pooler.supabase.com',
    DATABASE_STAGING_PROJECT_REF: 'stageref',
    DATABASE_PRODUCTION_PROJECT_REF: 'prodref',
  }), /project ref/);
  assert.doesNotThrow(() => assertSafeDatabaseStartup({
    ...base,
    DATABASE_TARGET: 'staging',
    DATABASE_URL: 'postgresql://postgres.stageref:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
    DATABASE_STAGING_HOST: 'aws-0-us-east-1.pooler.supabase.com',
    DATABASE_PRODUCTION_HOST: 'aws-0-us-east-1.pooler.supabase.com',
    DATABASE_STAGING_PROJECT_REF: 'stageref',
    DATABASE_PRODUCTION_PROJECT_REF: 'prodref',
  }));
});

test('production database requires an explicit production runtime', () => {
  assert.throws(() => assertSafeDatabaseStartup({ ...base, DATABASE_TARGET: 'production' }), /NODE_ENV=production/);
  assert.throws(() => assertSafeDatabaseStartup({ ...base, NODE_ENV: 'production' }), /DATABASE_TARGET=production/);
  assert.doesNotThrow(() => assertSafeDatabaseStartup({ ...base, NODE_ENV: 'production', DATABASE_TARGET: 'production' }));
  assert.throws(() => assertSafeDatabaseStartup({
    ...base,
    NODE_ENV: 'production',
    DATABASE_TARGET: 'local',
    DATABASE_URL: 'postgres://nexora:secret@127.0.0.1:5432/nexora',
  }), /DATABASE_TARGET=production/);
});
