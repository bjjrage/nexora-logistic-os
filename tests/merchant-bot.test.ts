import test from 'node:test';
import {Store} from '../server/db.ts';
import {exerciseBot} from './support/merchant-bot-scenario.ts';

test('Mini OS bot: stock real, aislamiento, simulador persistente y entrada compartida',async()=>{
  const db=new Store(':memory:');
  try { await exerciseBot(db); }
  finally { await db.close(); }
});
