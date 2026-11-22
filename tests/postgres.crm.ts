import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresStore } from '../server/postgres.ts';
import { crmAvailable } from '../server/crm-routes.ts';
import { exerciseCrm } from './support/crm-scenarios.ts';

test('CRM PostgreSQL aislado: equivalencia funcional, RLS del runtime e historial inmutable', async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.pathname === '/nexora_test');
  const db = new PostgresStore(url.toString());
  const uninstalled = new PostgresStore(url.toString(), 'nexora_test_crm_schema_not_installed');
  try {
    await db.verify();
    const {a,b,first,foreignId} = await exerciseCrm(db, 1100);
    assert.equal(await crmAvailable(uninstalled, {orgId: a, id: foreignId, name: 'QA', role: 'ADMIN', driverId: null}), false);
    await assert.rejects(db.transaction(() => db.run(
      'UPDATE crm_prospects SET owner_id=? WHERE org_id=? AND id=?', foreignId, a, first,
    ), {crmOrgId: a}), /reglas de integridad/);
    assert.deepEqual(await db.all('SELECT id FROM crm_prospects'), []);
    await db.transaction(async () => {
      assert.deepEqual(await db.all('SELECT id FROM crm_prospects WHERE org_id=?', b), []);
      assert.ok(await db.one('SELECT id FROM crm_prospects WHERE org_id=? AND id=?', a, first));
      for (const table of ['crm_prospects','crm_identifiers','crm_contacts','crm_activities','crm_transitions','crm_tasks']) {
        for (const role of ['anon','authenticated','service_role','nexora_tracking_worker']) {
          const detail = await db.one('SELECT has_table_privilege(?,?,?) AS granted', role, 'nexora.' + table, 'SELECT, INSERT, UPDATE, DELETE');
          assert.equal(detail?.granted, false, role + ' has privileges on ' + table);
        }
      }
      for (const table of ['crm_transitions','crm_activities']) {
        assert.equal((await db.one('SELECT has_table_privilege(?,?,?) AS granted', 'nexora_runtime', 'nexora.' + table, 'UPDATE, DELETE'))?.granted, false);
      }
    }, {crmOrgId: a, readOnly: true});
    assert.deepEqual(await db.all('SELECT id FROM crm_prospects'), []);
  } finally {
    await db.close();
    await uninstalled.close();
  }
});
