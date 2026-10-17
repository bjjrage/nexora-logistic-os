import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';

type Status = { configured: boolean; message: string; bindings: { vehicleId: string; externalVehicleId: string }[] };
type Tracking = {
  provider: string;
  status: 'FRESH' | 'STALE' | 'NO_POSITION'; sourceError: string | null; checkedAt: string | null;
  pollIntervalMs: number; staleAfterMs: number;
  position: { latitude: number; longitude: number; measuredAt: string; receivedAt: string } | null;
};
type Props = {
  vehicles: { id: string; plate: string }[]; routes: { id: string; name: string; vehicleId: string }[];
  timezone: string; canManage: boolean; busy: boolean;
  configurationOnly?: boolean;
  initialRouteId?: string;
  action: (path: string, payload: Record<string, unknown>, message: string) => Promise<boolean>;
};

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  return api<T>(path, { signal }, { timeoutMs: 15000 });
}

export default function QuadMindsPanel({ vehicles, routes, timezone, canManage, busy, action, configurationOnly=false, initialRouteId='' }: Props) {
  const [integration, setIntegration] = useState<Status | null>(null);
  const [revision, setRevision] = useState(0);
  const [vehicleId, setVehicleId] = useState('');
  const [externalId, setExternalId] = useState('');
  const [routeId, setRouteId] = useState(initialRouteId);
  const [result, setResult] = useState<Tracking | null>(null);
  const [error, setError] = useState('');
  const [configError, setConfigError] = useState('');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    setConfigError('');
    read<Status>('/api/integrations/quadminds', controller.signal).then(setIntegration).catch(failure => {
      if (!controller.signal.aborted) setConfigError(failure.message);
    });
    return () => controller.abort();
  }, [canManage, revision]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setResult(null); setError(''); setLoading(false);
    if (!routeId) return () => controller.abort();
    const poll = async () => {
      if (controller.signal.aborted) return;
      if (document.visibilityState === 'hidden') { timer = setTimeout(poll, 30_000); return; }
      setLoading(true);
      let delay = 30_000;
      try {
        const value = await read<Tracking>(`/api/routes/${encodeURIComponent(routeId)}/tracking`, controller.signal);
        if (!controller.signal.aborted) { setResult(value); setError(''); setNow(Date.now()); delay = value.pollIntervalMs; }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la ubicación.');
      } finally {
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(poll, delay); }
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [routeId, revision]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const date = (value: string) => new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'medium', timeZone: timezone }).format(new Date(value));
  const bind = async (event: FormEvent) => {
    event.preventDefault();
    if (await action(`/api/vehicles/${vehicleId}/tracking-binding`, { externalVehicleId: externalId.trim() || null }, externalId.trim() ? 'Vehículo vinculado con QuadMinds.' : 'Vinculación eliminada.')) setRevision(value => value + 1);
  };
  const position = result?.position;
  const stale = !!error || result?.status === 'STALE' || !!position && now - Date.parse(position.measuredAt) > (result?.staleAfterMs ?? 0);
  const selectedRoute = routes.find(route => route.id === routeId);
  return <section className="card stack">
    <div className="card-header"><div><h2>{configurationOnly?'Vincular vehículo con QuadMinds':'Ubicación del vehículo'}</h2><p className="muted">{configurationOnly?'Elegí el vehículo y su identificador en la cuenta de Universo.':'Elegí una ruta para ver su ubicación.'}</p></div></div>
    {configError && <p role="alert" className="muted">{configError}</p>}
    {canManage && configurationOnly && <div className="tracking-form-card">
      <form className="stack" onSubmit={bind}><fieldset disabled={busy}><div className="form-grid">
        <label className="field"><span>Vehículo de Nexora</span><select required value={vehicleId} onChange={event => {
          setVehicleId(event.target.value); setExternalId(integration?.bindings.find(binding => binding.vehicleId === event.target.value)?.externalVehicleId ?? '');
        }}><option value="">Seleccionar vehículo</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate}</option>)}</select></label>
        <label className="field"><span>ID del vehículo en QuadMinds</span><input maxLength={128} value={externalId} onChange={event => setExternalId(event.target.value)} placeholder="Identificador proporcionado por QuadMinds" /><small>Dejalo vacío para quitar la vinculación. Las credenciales se configuran en el servidor.</small></label>
      </div></fieldset><button className="button button-primary" disabled={busy || !vehicleId}>Guardar vinculación</button></form>
    </div>}
    {!configurationOnly&&<div className="stack">
      <label className="field"><span>Ruta para consultar su vehículo</span><select value={routeId} onChange={event => setRouteId(event.target.value)}><option value="">Seleccionar ruta</option>{routes.map(route => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
      {loading && <p role="status">Consultando ubicación…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <div aria-live="polite">
        <strong>{position ? stale ? 'Última posición · desactualizada' : 'Última posición recibida' : 'Sin posición disponible'}</strong>
        <p className="muted">Fuente: {result.provider}</p>
        {result.sourceError && <p>No se pudo obtener una posición nueva. {position ? 'Se conserva la última recibida.' : 'Verificá el acceso y la transmisión del vehículo.'}</p>}
        {position && <>
          <p>{vehicles.find(vehicle => vehicle.id === selectedRoute?.vehicleId)?.plate ?? 'Vehículo'} · {position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}</p>
          <p>Medición: {date(position.measuredAt)} · Recibida: {date(position.receivedAt)}</p>
          <iframe title="Última ubicación del vehículo" referrerPolicy="no-referrer" loading="lazy" style={{width:'100%',height:300,border:0,borderRadius:12}} src={`https://www.openstreetmap.org/export/embed.html?bbox=${Math.max(-180,position.longitude-.012)},${Math.max(-90,position.latitude-.008)},${Math.min(180,position.longitude+.012)},${Math.min(90,position.latitude+.008)}&layer=mapnik&marker=${position.latitude},${position.longitude}`}/>
          <a className="button button-secondary" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${position.latitude}&mlon=${position.longitude}#map=16/${position.latitude}/${position.longitude}`}>Ver posición en el mapa</a>
        </>}
        {result.checkedAt && <p className="muted">Última consulta: {date(result.checkedAt)} · Actualización cada {Math.round(result.pollIntervalMs / 1000)} s mientras esta pantalla está visible.</p>}
      </div>}
    </div>}
  </section>;
}
