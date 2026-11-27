import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresStore } from '../server/postgres.ts';
import { exerciseProcurement } from './support/procurement-story.ts';

function localUrl(value: string | undefined) {
  const url = new URL(value ?? '');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/nexora_test', 'PostgreSQL aislado obligatorio');
  return url.toString();
}

test('PostgreSQL: concurrencia entre conexiones, reintentos, reversos y persistencia', async () => {
  const runtime = localUrl(process.env.DATABASE_URL);
  const store = new PostgresStore(runtime);
  const second = new PostgresStore(runtime);
  let ids: Awaited<ReturnType<typeof exerciseProcurement>>;
  try {
    await store.verify();
    ids = await exerciseProcurement(store, second);
  } finally {
    await store.close();
    await second.close();
  }
  const reopened = new PostgresStore(runtime);
  const admin = new pg.Client({ connectionString: localUrl(process.env.PG_TEST_ADMIN_URL) });
  await admin.connect();
  try {
    assert.ok((await reopened.one('SELECT voided_at FROM procurement_documents WHERE org_id=? AND id=?', ids.orgId, ids.documentId))?.voided_at);
    for (const role of ['anon', 'authenticated', 'nexora_tracking_worker', 'service_role']) {
      await admin.query('SET ROLE ' + role);
      try {
        for (const table of ['procurement_documents', 'procurement_attachments', 'procurement_import_batches']) {
          await assert.rejects(admin.query('SELECT id FROM nexora.' + table), (error: pg.DatabaseError) => error.code === '42501');
        }
      } finally {
        await admin.query('RESET ROLE');
      }
    }
  } finally {
    await reopened.close();
    await admin.query('BEGIN');
    try {
      for (const table of ['procurement_events','procurement_movements','procurement_applications','procurement_lines','procurement_budgets',
        'procurement_documents','procurement_settlements','procurement_accounts','procurement_categories','procurement_parties','audit','idempotency','users']) {
        await admin.query('DELETE FROM nexora.' + table + ' WHERE org_id=ANY($1)', [[ids.orgId, ids.otherOrgId]]);
      }
      await admin.query('DELETE FROM nexora.organizations WHERE id=ANY($1)', [[ids.orgId, ids.otherOrgId]]);
      await admin.query('COMMIT');
    } finally {
      await admin.end();
    }
  }
});
