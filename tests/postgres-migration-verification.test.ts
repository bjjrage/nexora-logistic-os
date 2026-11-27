import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresStore } from '../server/postgres.ts';

test('PostgreSQL startup requires main migrations and procurement without commercial migrations', async () => {
  const verify = (versions: number[]) => PostgresStore.prototype.verify.call({
    all: async () => versions.map(version => ({ version })),
  } as unknown as PostgresStore);
  const main=Array.from({length:23},(_,index)=>index+1);
  await verify([...main,29]);
  await assert.rejects(verify(main), /migraciones esperadas/);
  await assert.rejects(verify([...main.slice(0,22),29]), /migraciones esperadas/);
  await assert.rejects(verify([...main.filter(version=>version!==17),29]), /migraciones esperadas/);
  await assert.rejects(verify([...main,24,25,26,27,29]), /migraciones esperadas/);
});
