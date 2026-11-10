import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const portalFiles = new Set([
  'frontend/CustomerPortal.tsx',
  'frontend/CustomerStock.tsx',
  'frontend/CustomerMovements.tsx',
  'frontend/customer-portal.css',
  'frontend/customer-labels.ts',
]);
const sharedFiles = new Set([
  'frontend/Brand.tsx',
  'frontend/ClientLocations.tsx',
  'frontend/HelpTip.tsx',
  'frontend/PasswordReset.tsx',
  'frontend/StatCard.tsx',
  'frontend/api.ts',
  'frontend/diagnostics.ts',
  'package.json',
  'package-lock.json',
  'scripts/vercel-ignore-build.mjs',
  'tsconfig.json',
  'vite.config.ts',
]);
const portalOnly = path => portalFiles.has(path) || path.startsWith('deploy/portal/') || path.startsWith('frontend/portal/');
const portalInput = path => portalOnly(path) || sharedFiles.has(path) || path.startsWith('public/') || /^frontend\/[^/]+\.css$/.test(path);
const previous = process.env.VERCEL_GIT_PREVIOUS_SHA ?? '';
const app = process.argv[2];

// Build if this project has no previous release or Git cannot compare it.
process.exitCode = 1;
if (/^[a-f0-9]{40}$/.test(previous) && (app === 'os' || app === 'portal')) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', previous, 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
    const affected = app === 'os' ? changed.some(path => !portalOnly(path)) : changed.some(portalInput);
    process.exitCode = affected ? 1 : 0;
  } catch {
    // A shallow clone may not contain the previous release.
  }
}
