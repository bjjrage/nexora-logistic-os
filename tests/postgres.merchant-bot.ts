import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresStore} from '../server/postgres.ts';
import {exerciseBot} from './support/merchant-bot-scenario.ts';

test('Mini OS bot en PostgreSQL aislado: recorrido, stock y RLS',async()=>{
  const url=new URL(process.env.DATABASE_URL??'');
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname==='/nexora_test');
  const db=new PostgresStore(url.toString());
  try {
    const {orgId}=await exerciseBot(db);
    assert.deepEqual(await db.all('SELECT id FROM customer_bot_simulations WHERE org_id=?',orgId),[]);
    for(const role of ['anon','authenticated','service_role','nexora_tracking_worker'])
      assert.equal((await db.one("SELECT has_table_privilege(?,'nexora.customer_bot_simulations','SELECT') AS allowed",role))?.allowed,false);
  } finally { await db.close(); }
});
