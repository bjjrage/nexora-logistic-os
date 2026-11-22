import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresStore} from '../server/postgres.ts';
import {exerciseAgent} from './support/crm-agent-scenario.ts';

test('CRM agente: recorrido PostgreSQL aislado y protección RLS de fuentes y ejecuciones',async()=>{
  const url=new URL(process.env.DATABASE_URL??'');
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname==='/nexora_test');
  const db=new PostgresStore(url.toString());
  try {
    const {orgId,other}=await exerciseAgent(db);
    for (const table of ['crm_research_sources','crm_agent_runs']) {
      assert.deepEqual(await db.all('SELECT org_id FROM '+table+' WHERE org_id=?',orgId),[]);
      await db.transaction(async()=>{
        assert.equal((await db.all('SELECT org_id FROM '+table+' WHERE org_id=?',orgId)).length,1);
      },{crmOrgId:orgId,readOnly:true});
      await db.transaction(async()=>{
        assert.deepEqual(await db.all('SELECT org_id FROM '+table+' WHERE org_id=?',orgId),[]);
      },{crmOrgId:other,readOnly:true});
      for (const role of ['anon','authenticated','service_role','nexora_tracking_worker'])
        assert.equal((await db.one("SELECT has_table_privilege(?,?,'SELECT') AS allowed",role,'nexora.'+table))?.allowed,false);
    }
  } finally { await db.close(); }
});
