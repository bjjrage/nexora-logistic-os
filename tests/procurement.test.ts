import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/db.ts';
import { exerciseProcurement } from './support/procurement-story.ts';

test('Proveedores: importes, aplicaciones, reversos y persistencia local', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexora-procurement-qa-'));
  const filename = join(directory, 'qa.sqlite');
  const store = new Store(filename);
  try {
    const { orgId, partyId, documentId } = await exerciseProcurement(store);
    await store.close();
    const reopened = new Store(filename);
    try {
      const row = await reopened.one('SELECT party_id,voided_at FROM procurement_documents WHERE org_id=? AND id=?', orgId, documentId);
      assert.equal(row?.party_id, partyId);
      assert.ok(row?.voided_at);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
