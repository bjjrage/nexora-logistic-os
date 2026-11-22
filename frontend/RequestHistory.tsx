import {useState} from 'react';
import {api} from './api';

const labels: Record<string, string> = {
  SUBMITTED: 'Ingresada', EDITED: 'Editada', CANCELLED: 'Cancelada', ACCEPTED: 'Registrada', REJECTED: 'Rechazada',
  CHANGE_REQUESTED: 'Cambio solicitado', CHANGE_REVIEWED: 'Cambio revisado',
};

export function RequestHistory({path}: {path: string}) {
  const [rows, setRows] = useState<{kind: string; version: number; occurredAt: string; detail: {reason?: string}}[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    if (rows) { setRows(undefined); return; }
    setError('');
    setBusy(true);
    try {
      setRows((await api<{rows: NonNullable<typeof rows>}>(path)).rows);
    } catch (error) {
      setError((error as Error).message);
    } finally { setBusy(false); }
  }
  return <div>
    <button type="button" className="text-button" disabled={busy} aria-expanded={!!rows} onClick={() => void load()}>
      {rows ? 'Ocultar historial' : 'Ver historial'}
    </button>
    {error && <p className="notice error" role="alert">{error}</p>}
    {rows && (rows.length ? <ul>{rows.map(row => <li key={row.version}>
      {labels[row.kind]} · {new Date(row.occurredAt).toLocaleString('es-PY')}{row.detail.reason && ' · ' + row.detail.reason}
    </li>)}</ul> : <span>Sin eventos registrados</span>)}
  </div>;
}
