import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const patch = readFileSync(resolve('docs/rollback-3a6444-schema22.patch'), 'utf8');
const removed = patch.match(/^\-\s*if \((.+)\) throw new Error\('La base de Nexora no tiene las migraciones esperadas\.'\);$/m)?.[1];
const added = patch.match(/^\+\s*if \((.+)\) throw new Error\('La base de Nexora no tiene las migraciones esperadas\.'\);$/m)?.[1];

test('candidate basado en 3a6444 arranca con esquema 21 o 22, sin aceptar versiones desconocidas', () => {
  assert.ok(removed, 'el patch debe mostrar el contrato original de 3a6444');
  assert.ok(added, 'el patch debe incluir el nuevo contrato de compatibilidad');
  assert.equal((patch.match(/^-[^-]\s*if \(versions\.map/gm) ?? []).length, 1, 'solo se reemplaza el gate del verifier');
  assert.equal((patch.match(/^\+[^+]\s*if \(!\[/gm) ?? []).length, 1, 'el patch agrega un gate allowlist único');
  assert.match(patch, /diff --git a\/tests\/postgres-migration-verification\.test\.ts/, 'el patch incluye la regresión del verifier');

  const original = new Function('versions', `return ${removed};`) as (versions: { version: number }[]) => boolean;
  const compatible = new Function('versions', `return ${added};`) as (versions: { version: number }[]) => boolean;
  const sequence = (count: number) => Array.from({ length: count }, (_, index) => ({ version: index + 1 }));

  assert.equal(original(sequence(21)), false, '3a6444 arranca en el esquema desplegado 21');
  assert.equal(original(sequence(22)), true, '3a6444 sin parche reproduce H3 sobre esquema 22');
  assert.equal(compatible(sequence(21)), false, 'el candidate conserva compatibilidad con esquema 21');
  assert.equal(compatible(sequence(22)), false, 'el candidate acepta esquema 22');
  assert.equal(compatible(sequence(20)), true, 'el candidate rechaza un esquema anterior incompleto');
  assert.equal(compatible(sequence(23)), true, 'rechaza una migración futura desconocida');
  assert.equal(compatible([...sequence(20).filter(({ version }) => version !== 9), { version: 21 }]), true, 'rechaza huecos');
  assert.equal(compatible([...sequence(21), { version: 21 }]), true, 'rechaza duplicados');
});

test('migraciones 21 y 22 agregan sus tablas sin alterar o borrar tablas previas', () => {
  for (const [file, expectedTable] of [
    ['supabase/migrations/20261101011507_return_dispositions.sql', 'return_dispositions'],
    ['supabase/migrations/20261101021500_alert_outbox.sql', 'alert_outbox'],
  ]) {
    const sql = readFileSync(resolve(file), 'utf8');
    const createdTables = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:\w+)\.)?(\w+)/gi)].map(match => match[1]);
    const alteredTables = [...sql.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:(?:\w+)\.)?(\w+)/gi)].map(match => match[1]);
    assert.deepEqual(createdTables, [expectedTable], `${file} debe crear solo su tabla nueva`);
    assert.deepEqual(alteredTables, [expectedTable], `${file} solo puede alterar su tabla nueva para RLS`);
    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA)\b/i, `${file} no debe borrar objetos`);
  }
});
