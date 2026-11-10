import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../api';
import Brand from '../Brand';
import CustomerPortal from '../CustomerPortal';
import PasswordReset from '../PasswordReset';
import '../fonts.css';
import '../styles.css';

type Customer = { id: string; name: string; role: 'CUSTOMER'; clientId: string };
const session = () => api<{ user: Customer | null }>('/api/customer/session');
const post = (path: string, data: object = {}) => api(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'logistics-os' },
  body: JSON.stringify(data),
});

function PortalApp() {
  const [user, setUser] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    let active = true;
    const expire = () => setUser(null);
    window.addEventListener('nexora:session-expired', expire);
    session().then(result => {
      if (active) setUser(result.user);
    }).catch((error: Error) => {
      if (active) setError(error.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      window.removeEventListener('nexora:session-expired', expire);
    };
  }, []);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await post('/api/customer/login', { username: username.trim(), password });
      const result = await session();
      if (!result.user) throw new Error('No se pudo abrir la sesión del portal.');
      setPassword('');
      setUser(result.user);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError('');
    try {
      await post('/api/customer/logout');
      setUser(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo cerrar sesión.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="auth-shell"><section className="auth-card"><Brand /><p role="status">Cargando portal…</p></section></main>;
  if (user) return <>{error && <p className="notice error" role="alert">{error}</p>}<CustomerPortal user={user} busy={busy} onLogout={logout} /></>;
  return <main className="auth-shell"><section className="auth-card">
    <Brand />
    <h1>Portal de clientes</h1>
    {error && <p className="notice error" role="alert">{error}</p>}
    <form className="stack" onSubmit={authenticate}>
      <label className="field"><span>Usuario</span><input required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
      <label className="field"><span>Contraseña</span><input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="button button-primary" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
    </form>
  </section></main>;
}

const isReset = () => new URLSearchParams(location.hash.slice(1)).has('restablecer');
function PortalEntry() {
  const [reset, setReset] = useState(isReset);
  useEffect(() => {
    const update = () => setReset(isReset());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return reset ? <PasswordReset customer /> : <PortalApp />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><PortalEntry /></StrictMode>);
