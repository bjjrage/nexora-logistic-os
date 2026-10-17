import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Static guard for checked-in public tables; runtime privilege tests are still required. */
export function publicMigrationErrors(sql: string): string[] {
  const source = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''), errors: string[] = [];
  for (const match of source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(\w+)\.)?(\w+)\s*\(/gi)) {
    const prefix = source.slice(0, match.index), searchPaths = [...prefix.matchAll(/SET\s+(?:LOCAL\s+)?search_path\s*(?:TO|=)\s*(\w+)/gi)];
    const schema = (match[1] ?? searchPaths.at(-1)?.[1] ?? 'public').toLowerCase();
    if (schema !== 'public') continue;
    const table = match[2], object = `(?:public\\.)?${table}\\b`;
    const requirements: [string, RegExp][] = [
      ['RLS', new RegExp(`ALTER\\s+TABLE\\s+${object}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i')],
      ['REVOKE', new RegExp(`REVOKE\\s+[^;]+?\\s+ON\\s+(?:TABLE\\s+)?(?:[\\w.]+\\s*,\\s*)*${object}(?:\\s*,\\s*[\\w.]+)*\\s+FROM\\s+`, 'i')],
      ['GRANT', new RegExp(`GRANT\\s+[^;]+?\\s+ON\\s+(?:TABLE\\s+)?(?:[\\w.]+\\s*,\\s*)*${object}(?:\\s*,\\s*[\\w.]+)*\\s+TO\\s+`, 'i')],
    ];
    for (const [name, rule] of requirements) if (!rule.test(source)) errors.push(`public.${table}: falta ${name} explícito en la migración`);
  }
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).flatMap(file => publicMigrationErrors(readFileSync('supabase/migrations/' + file, 'utf8')).map(error => `${file}: ${error}`));
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('Migraciones públicas: RLS y permisos explícitos verificados estáticamente.');
}
