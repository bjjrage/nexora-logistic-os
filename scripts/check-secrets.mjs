import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const gitArgs = ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`];
const git = (...args) => execFileSync('git', [...gitArgs, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const staged = process.argv.includes('--staged');
const files = git('ls-files', '-z').split('\0').filter(Boolean);
const known = new Set();
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL))=(.+)$/);
    if (match) {
      const value = match[2].replace(/^['"]|['"]$/g, '');
      if (value.length >= 16) known.add(value);
      if (match[1] === 'DATABASE_URL') {
        try { const password = decodeURIComponent(new URL(value).password); if (password.length >= 12) known.add(password); } catch {}
      }
    }
  }
}
function collect(value, key = '') {
  if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) collect(item, name);
  else if (/secret|password|token|credential/i.test(key) && typeof value === 'string' && value.length >= 16) known.add(value);
}
for (const path of ['.local/runtime-credential.json', '.local/traccar/secrets.json', '.local/traccar/worker-private.json']) {
  if (existsSync(path)) collect(JSON.parse(readFileSync(path, 'utf8')));
}
const failures = [];
for (const file of files) {
  if (/^(?:\.local|\.npm-cache|node_modules|dist|web-publica|\.aws|\.codex|\.agents)\//.test(file) || /^\.env(?:\.|$)/.test(file) && file !== '.env.example') {
    failures.push(`${file}: archivo privado en el índice`); continue;
  }
  const body = staged ? git('show', `:${file}`) : readFileSync(file, 'utf8');
  if ([...known].some(value => body.includes(value))) failures.push(`${file}: coincide con una credencial local`);
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/.test(body) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body)) failures.push(`${file}: token o clave privada`);
  for (const jwt of body.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g)) {
    try { if (JSON.parse(Buffer.from(jwt[0].split('.')[1], 'base64url').toString()).role === 'service_role') failures.push(`${file}: JWT service_role`); } catch {}
  }
}
if (failures.length) { console.error([...new Set(failures)].join('\n')); process.exit(1); }
console.log(`Escaneo de secretos: ${files.length} archivos revisados; sin coincidencias.`);
