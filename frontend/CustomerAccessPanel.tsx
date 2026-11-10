import {useCallback,useEffect,useId,useState,type FormEvent} from 'react';
import {api} from './api';
import AccountRecovery from './AccountRecovery';
import {customerPortalUrl} from './portal-url';
import HelpTip from './HelpTip';
import {Copy,ExternalLink} from 'lucide-react';

type Access = {id:string;clientId:string;name:string;username:string;enabled:boolean};
const emptyForm = {name:'',username:'',password:''};

export default function CustomerAccessPanel({clientId,clientName}:{clientId:string;clientName:string}) {
  const fieldId = useId();
  const [items,setItems] = useState<Access[]>([]);
  const [form,setForm] = useState(emptyForm);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');

  const load = useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');
    try {
      const result = await api<{items:Access[]}>('/api/customer-access?'+new URLSearchParams({clientId}),{signal});
      if(!signal?.aborted)setItems(result.items);
    } catch(caught) {
      if(!signal?.aborted)setError(caught instanceof Error?caught.message:'No se pudieron consultar los usuarios.');
    } finally {if(!signal?.aborted)setLoading(false);}
  },[clientId]);

  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);

  async function mutate(path:string,body:Record<string,unknown>,success:string) {
    if(busy)return false;
    setBusy(true);setError('');setMessage('');
    try {
      await api(path,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},body:JSON.stringify({...body,commandId:crypto.randomUUID()})});
      setMessage(success);
      await load();
      return true;
    } catch(caught) {
      setError(caught instanceof Error?caught.message:'No se pudo guardar el acceso.');
      return false;
    } finally {setBusy(false);}
  }

  async function create(event:FormEvent) {
    event.preventDefault();
    if(await mutate('/api/customer-access',{clientId,...form},'Usuario habilitado.'))setForm(emptyForm);
  }

  return <section className="card" aria-labelledby="customer-depot-access-title">
    <div className="card-header"><div className="help-label"><h2 id="customer-depot-access-title">Acceso al portal</h2><HelpTip label="Acceso al portal">Cada usuario consulta y exporta únicamente el inventario, movimientos y pedidos de {clientName}. Las operaciones quedan a cargo de Nexora.</HelpTip></div><span className="badge badge-neutral">{items.filter(item=>item.enabled).length} activos</span></div>
    <div className="customer-access-links"><a className="button text-button" href={customerPortalUrl()} target="_blank" rel="noreferrer">Abrir portal<ExternalLink size={14} aria-hidden="true"/></a><button className="text-button" type="button" onClick={()=>void navigator.clipboard.writeText(customerPortalUrl()).then(()=>setMessage('Enlace copiado.')).catch(()=>setError('No se pudo copiar el enlace.'))}><Copy size={14} aria-hidden="true"/>Copiar enlace</button></div>
    {error&&<p className="notice error" role="alert">{error} <button className="text-button" type="button" disabled={busy||loading} onClick={()=>void load()}>Volver a consultar</button></p>}
    {message&&<p className="notice" role="status">{message}</p>}
    <form className="stack customer-access-create" onSubmit={event=>void create(event)}>
      <fieldset disabled={busy}>
        <legend>Nuevo usuario</legend>
        <div className="customer-access-fields">
          <label className="field"><span>Nombre de la persona</span><input required maxLength={200} value={form.name} onChange={event=>setForm(current=>({...current,name:event.target.value}))} autoComplete="off"/></label>
          <div className="field"><div className="help-label"><label htmlFor={fieldId+'-username'}>Usuario de ingreso</label><HelpTip label="Usuario de ingreso" id={fieldId+'-username-hint'}>Entre 3 y 80 caracteres. Letras sin acentos, números, punto, guion, guion bajo o @.</HelpTip></div><input id={fieldId+'-username'} required minLength={3} maxLength={80} pattern="[a-zA-Z0-9_.@\-]+" aria-describedby={fieldId+'-username-hint'} value={form.username} onChange={event=>setForm(current=>({...current,username:event.target.value}))} autoComplete="off" autoCapitalize="none" spellCheck={false}/></div>
          <div className="field"><div className="help-label"><label htmlFor={fieldId+'-password'}>Contraseña</label><HelpTip label="Contraseña" id={fieldId+'-password-hint'}>Entre 6 y 128 caracteres. Compartila en privado con la persona.</HelpTip></div><input id={fieldId+'-password'} required type="password" minLength={6} maxLength={128} aria-describedby={fieldId+'-password-hint'} value={form.password} onChange={event=>setForm(current=>({...current,password:event.target.value}))} autoComplete="new-password"/></div>
        </div>
        <button className="button button-primary" type="submit" disabled={busy||!form.name.trim()||!form.username.trim()||!form.password}>{busy?'Guardando…':'Habilitar usuario'}</button>
      </fieldset>
    </form>
    <h3>Usuarios</h3>
    {loading?<p className="muted" role="status">Consultando usuarios…</p>:items.length?<div className="inventory-list">{items.map(item=><article className="inventory-list-row customer-access-user" key={item.id} aria-label={'Acceso de '+item.name}>
      <div><strong>{item.name}</strong><small>{item.username}</small><span className={item.enabled?'badge badge-success':'badge badge-neutral'}>{item.enabled?'Activo':'Suspendido'}</span></div>
      <div className="inventory-actions">
        {item.enabled&&<AccountRecovery id={item.id} kind="CUSTOMER"/>}
        <button className="button button-secondary" type="button" disabled={busy} aria-label={(item.enabled?'Suspender':'Reactivar')+' acceso de '+item.name} onClick={()=>void mutate('/api/customer-access/'+encodeURIComponent(item.id)+(item.enabled?'/revoke':'/enable'),{},item.enabled?'Acceso suspendido.':'Acceso reactivado.')}>
          {item.enabled?'Suspender':'Reactivar'}
        </button>
      </div>
    </article>)}</div>:!error&&<p className="empty-state">Sin usuarios.</p>}
  </section>;
}
