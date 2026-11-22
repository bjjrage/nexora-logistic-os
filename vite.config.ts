import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';

export default defineConfig(({mode}) => {
  const portal = mode === 'portal';
  return {
    root: portal ? 'frontend/portal' : undefined,
    base: portal ? '/portal/' : '/',
    publicDir: portal ? '../../public' : 'public',
    server: { host: '127.0.0.1', port: portal ? 5174 : 5173, strictPort: true, fs: { allow: ['.'] }, proxy: { '/api': 'http://127.0.0.1:3001' } },
    build: portal ? { outDir: '../../deploy/portal/dist', emptyOutDir: true } : { outDir: 'dist', sourcemap: 'hidden' },
    plugins: portal ? [{
      name: 'nexora-portal-release',
      apply: 'build',
      generateBundle() {
        let release = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA;
        if (!release) {
          try { release = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
          catch { release = 'demo-source-unversioned'; } // Docker demo builds lack Git metadata.
        }
        this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify({ release, application: 'customer-portal' }) + '\n' });
      },
    }] : [],
  };
});
