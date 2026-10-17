import test from 'node:test';
import assert from 'node:assert/strict';
import { publicMigrationErrors } from '../scripts/check-migrations.ts';

test('guardia de migraciones detecta cada permiso/RLS faltante en tablas públicas nuevas', () => {
  const create = 'CREATE TABLE public.example (id text);';
  assert.equal(publicMigrationErrors(create).length, 3);
  const secure = create + ' ALTER TABLE public.example ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.example FROM PUBLIC,anon; GRANT SELECT ON public.example TO authenticated;';
  assert.deepEqual(publicMigrationErrors(secure), []);
  for (const clause of ['ALTER TABLE public.example ENABLE ROW LEVEL SECURITY;', 'REVOKE ALL ON public.example FROM PUBLIC,anon;', 'GRANT SELECT ON public.example TO authenticated;']) assert.equal(publicMigrationErrors(secure.replace(clause, '')).length, 1);
  assert.equal(publicMigrationErrors('SET search_path TO public; CREATE TABLE example (id text);').length, 3);
  assert.deepEqual(publicMigrationErrors('SET LOCAL search_path TO nexora,pg_catalog; CREATE TABLE example (id text);'), []);
  assert.equal(publicMigrationErrors(create + ' -- GRANT SELECT ON public.example TO authenticated;').length, 3);
});

test('guard accepts explicit comma-separated table grants without granting unrelated names',()=>{
 const sql='CREATE TABLE public.example(id text); ALTER TABLE public.example ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.other, public.example FROM anon; GRANT SELECT ON public.example, public.third TO authenticated;';
 assert.deepEqual(publicMigrationErrors(sql),[]);
 assert.equal(publicMigrationErrors(sql.replaceAll('ON public.example, public.third','ON public.example_other, public.third')).length,1);
});
