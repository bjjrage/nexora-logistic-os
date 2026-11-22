import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/db.ts';
import { exerciseCrm } from './support/crm-scenarios.ts';

test('CRM SQLite: permisos, aislamiento, idempotencia y métricas de 2.500 prospectos', async () => {
  const db = new Store(':memory:');
  try {
    const {a, first, foreignId} = await exerciseCrm(db, 2500);
    await assert.rejects(db.run('UPDATE crm_prospects SET owner_id=? WHERE org_id=? AND id=?', foreignId, a, first), /FOREIGN KEY/);
    await assert.rejects(db.run('DELETE FROM crm_transitions WHERE org_id=? AND prospect_id=?', a, first), /inmutable/);
    await assert.rejects(db.run("UPDATE crm_activities SET detail='mutado' WHERE org_id=? AND prospect_id=?", a, first), /inmutable/);
  } finally {
    await db.close();
  }
});
