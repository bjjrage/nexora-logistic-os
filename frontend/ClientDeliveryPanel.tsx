import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import './tracking.css';

type Policy = { clientId: string; deliveryProvider: string };
type Settings = { policies: Policy[]; lockedPolicies: Policy[] };
type Props = {
  clients: { id: string; name: string }[];
  busy: boolean;
  action: (path: string, payload: Record<string, unknown>, message: string) => Promise<boolean>;
};

export default function ClientDeliveryPanel({ clients, busy, action }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clientId, setClientId] = useState('');
  const [provider, setProvider] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<Settings>('/api/integrations/traccar', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setSettings(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo consultar la configuración.'); });
    return () => controller.abort();
  }, [retry]);
  const locked = settings?.lockedPolicies.find(item => item.clientId === clientId);
  const persisted = locked?.deliveryProvider ?? settings?.policies.find(item => item.clientId === clientId)?.deliveryProvider;
  const selectClient = (id: string) => {
    setClientId(id);
    setProvider(settings?.lockedPolicies.find(item => item.clientId === id)?.deliveryProvider ?? settings?.policies.find(item => item.clientId === id)?.deliveryProvider ?? '');
    setError('');
    setSaved(false);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || !clientId || !provider || locked || provider === persisted) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      if (await action(`/api/clients/${clientId}/delivery-provider`, { deliveryProvider: provider }, 'Sistema del cliente actualizado.')) {
        setSettings(current => current && { ...current, policies: [...current.policies.filter(item => item.clientId !== clientId), { clientId, deliveryProvider: provider }] });
        setSaved(true);
      } else setError('No se pudo guardar. Revisá el aviso de la operación y volvé a intentar.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar el sistema del cliente.'); }
    finally { setSaving(false); }
  };
  return <section className="tracking-workspace" aria-label="Sistema por cliente">
    <form className="card tracking-form-card" onSubmit={save}>
      <h2>Sistema por cliente</h2>
      <p>Elegí quién gestiona sus repartos. Universo conserva QuadMinds.</p>
      {!settings && !error && <p role="status">Consultando configuración…</p>}
      {error && <p role="alert" className="tracking-assignment-error">{error}</p>}
      {!settings && error && <button type="button" className="button button-secondary" onClick={() => setRetry(value => value + 1)}>Reintentar</button>}
      <fieldset className="stack" disabled={busy || saving || !settings}>
        <label className="field"><span>Cliente</span><select value={clientId} required onChange={event => selectClient(event.target.value)}><option value="">Seleccionar cliente</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="field"><span>Sistema de reparto</span><select value={provider} required disabled={!clientId || !!locked} onChange={event => { setProvider(event.target.value); setSaved(false); setError(''); }}><option value="">Seleccionar sistema</option><option value="NEXORA">Nexora · Traccar</option><option value="QUADMINDS">QuadMinds</option></select></label>
      </fieldset>
      {locked ? <p className="tracking-assignment-saved">Este cliente mantiene QuadMinds por contrato.</p> : clientId && provider && persisted === provider && <p role="status" className="tracking-assignment-saved">{saved ? 'Sistema guardado.' : 'Sistema actual guardado.'}</p>}
      {!locked && <button className="button button-primary" disabled={busy || saving || !settings || !clientId || !provider || persisted === provider}>{saving ? 'Guardando…' : 'Guardar sistema'}</button>}
    </form>
  </section>;
}
