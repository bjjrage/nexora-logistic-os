import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresStore } from '../server/postgres.ts';

test('PostgreSQL startup requires the complete migration set including test mode', async () => {
  const verify = (versions: number[]) => PostgresStore.prototype.verify.call({
    all: async () => versions.map(version => ({ version })),
  } as unknown as PostgresStore);
  await verify(Array.from({length: 18}, (_, index) => index + 1));
  await assert.rejects(verify(Array.from({length: 17}, (_, index) => index + 1)), /migraciones esperadas/);
  await assert.rejects(verify([...Array.from({length: 16}, (_, index) => index + 1), 18]), /migraciones esperadas/);
  await assert.rejects(verify(Array.from({length: 19}, (_, index) => index + 1)), /migraciones esperadas/);
});
