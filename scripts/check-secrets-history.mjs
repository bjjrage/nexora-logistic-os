// Escanea TODO el historial de git (todos los blobs de todas las ramas) con los mismos criterios que check-secrets.
// Nunca imprime valores: solo ruta, commit-agnóstico y tipo de coincidencia.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const git = (args, input) => execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, ...args], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, input: input === undefined ? undefined : Buffer.from(input) });
const known = new Set();
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL))=(.+)$/);
    if (!match) continue;
    const value = match[2].replace(/^['"]|['"]$/g, '');
    if (value.length >= 16) known.add(value);
    if (match[1] === 'DATABASE_URL') { try { const p = decodeURIComponent(new URL(value).password); if (p.length >= 12) known.add(p); } catch {} }
  }
}
const objects = git(['rev-list', '--objects', '--all']).toString().split('\n').filter(Boolean).map(line => { const i = line.indexOf(' '); return i < 0 ? { sha: line, path: '' } : { sha: line.slice(0, i), path: line.slice(i + 1) }; });
const types = git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], objects.map(o => o.sha).join('\n') + '\n').toString().split('\n').filter(Boolean);
const blobs = new Map(); const seen = new Set();
types.forEach((line, index) => { const [sha, type, size] = line.split(' '); if (type === 'blob' && Number(size) < 5_000_000 && !seen.has(sha)) { seen.add(sha); blobs.set(sha, objects[index].path); } });
const failures = new Set();
for (const [sha, path] of blobs) {
  if (/(^|\/)\.env(\.|$)/.test(path) && !path.endsWith('.env.example')) failures.add(`${path}: archivo .env en el historial`);
  const body = git(['cat-file', 'blob', sha]).toString('utf8');
  if ([...known].some(value => body.includes(value))) failures.add(`${path}: coincide con una credencial local`);
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/.test(body) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body)) failures.add(`${path}: token o clave privada`);
  for (const jwt of body.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g)) {
    try { if (JSON.parse(Buffer.from(jwt[0].split('.')[1], 'base64url').toString()).role === 'service_role') failures.add(`${path}: JWT service_role`); } catch {}
  }
  if (/postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]{8,}@(?!127\.0\.0\.1|localhost)[\w.-]+/.test(body)) failures.add(`${path}: URI de base con contraseña`);
}
console.log(`Historial: ${blobs.size} versiones de archivos revisadas.`);
if (failures.size) { console.error([...failures].join('\n')); process.exit(1); }
console.log('Sin coincidencias.');
