import test from 'node:test';
import {Store} from '../server/db.ts';
import {exerciseAgent} from './support/crm-agent-scenario.ts';

test('CRM investigación: lote autorizado, relevancia, presupuesto, reintento e inbox con opt-out',async()=>{
  const db=new Store(':memory:');
  try { await exerciseAgent(db); }
  finally { await db.close(); }
});
