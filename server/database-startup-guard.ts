type StartupEnv = Partial<Pick<NodeJS.ProcessEnv,
  'NODE_ENV' | 'DATABASE_PROVIDER' | 'DATABASE_URL' | 'DATABASE_TARGET' |
  'DATABASE_PRODUCTION_HOST' | 'DATABASE_STAGING_HOST' |
  'DATABASE_PRODUCTION_PROJECT_REF' | 'DATABASE_STAGING_PROJECT_REF'>>;

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DATABASE_TARGETS = new Set(['local', 'staging', 'production']);

function normalizedHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function supabaseProjectRef(database: URL): string | undefined {
  const hostRef = database.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1];
  if (hostRef) return hostRef.toLowerCase();
  try {
    return decodeURIComponent(database.username).match(/^postgres\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  } catch {
    return undefined;
  }
}

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Fail closed before the server opens a database connection. Local development
 * may use SQLite or a loopback PostgreSQL instance. A remote non-production
 * database needs an explicit staging target and an exact host allowlist that
 * is distinct from the production host. Production remains available only in
 * a production runtime.
 */
export function assertSafeDatabaseStartup(env: StartupEnv = process.env): void {
  const provider = env.DATABASE_PROVIDER ?? 'sqlite';
  const nodeEnv = env.NODE_ENV ?? 'development';
  const target = env.DATABASE_TARGET ?? 'local';

  if (!DATABASE_TARGETS.has(target)) fail('DATABASE_TARGET debe ser local, staging o production.');
  if (!['sqlite', 'postgres'].includes(provider)) fail('DATABASE_PROVIDER inválido.');
  if (nodeEnv === 'production' && provider !== 'postgres') {
    fail('Producción requiere PostgreSQL; no se permite una base SQLite temporal.');
  }
  if (nodeEnv === 'production' && target === 'local') {
    fail('Un runtime de producción requiere DATABASE_TARGET=production o staging.');
  }
  if (target === 'production' && nodeEnv !== 'production') {
    fail('La base de producción solo se permite con NODE_ENV=production.');
  }
  if (provider === 'sqlite') {
    if (target !== 'local') fail('SQLite solo se permite con DATABASE_TARGET=local.');
    return;
  }

  let database: URL;
  try {
    database = new URL(env.DATABASE_URL ?? '');
  } catch {
    fail('DATABASE_URL debe ser una URI PostgreSQL válida.');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
    fail('DATABASE_URL debe ser una URI PostgreSQL válida.');
  }

  const host = normalizedHost(database.hostname);
  if (target === 'production') return;

  if (target === 'local') {
    if (!LOCAL_DATABASE_HOSTS.has(host)) {
      fail('Desarrollo local solo permite una base PostgreSQL en el mismo equipo. Configure una base local o staging aislado.');
    }
    return;
  }

  const stagingHost = normalizedHost(env.DATABASE_STAGING_HOST ?? '');
  const productionHost = normalizedHost(env.DATABASE_PRODUCTION_HOST ?? '');
  const isSupabase = host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
  if (!stagingHost || !productionHost || host !== stagingHost) {
    fail('La base remota requiere un host de staging explícito y distinto del host de producción.');
  }
  if (isSupabase) {
    const stagingRef = (env.DATABASE_STAGING_PROJECT_REF ?? '').trim().toLowerCase();
    const productionRef = (env.DATABASE_PRODUCTION_PROJECT_REF ?? '').trim().toLowerCase();
    const actualRef = supabaseProjectRef(database);
    if (!stagingRef || !productionRef || stagingRef === productionRef || actualRef !== stagingRef) {
      fail('La base Supabase de staging requiere un project ref explícito y distinto del de producción.');
    }
  } else if (stagingHost === productionHost) {
    fail('La base remota requiere un host de staging explícito y distinto del host de producción.');
  }
}
