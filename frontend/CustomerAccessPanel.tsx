import {useCallback,useEffect,useId,useState,type FormEvent} from 'react';
import {api} from './api';
import AccountRecovery from './AccountRecovery';

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
    if(await mutate('/api/customer-access',{clientId,...form},'Usuario habilitado. Ya puede ingresar al portal de '+clientName+'.'))setForm(emptyForm);
  }

  return <section className="card" aria-labelledby="customer-depot-access-title">
    <div className="card-header"><div><h2 id="customer-depot-access-title">Acceso al portal</h2><p>Usuarios de {clientName}. Pueden consultar y exportar su inventario, movimientos y pedidos.</p></div><span className="badge badge-neutral">{items.filter(item=>item.enabled).length} activos</span></div>
    <p className="muted">Cada persona usa su propia cuenta. Las recepciones, ajustes y despachos quedan a cargo de Nexora.</p>
    <label className="field"><span>Enlace de ingreso</span><input readOnly value={window.location.origin} onFocus={event=>event.target.select()}/></label>
    {error&&<p className="notice error" role="alert">{error} <button className="text-button" type="button" disabled={busy||loading} onClick={()=>void load()}>Volver a consultar</button></p>}
    {message&&<p className="notice" role="status">{message}</p>}
    <form className="stack" onSubmit={event=>void create(event)}>
      <fieldset disabled={busy}>
        <legend>Habilitar usuario</legend>
        <div className="inventory-form-grid">
          <label className="field"><span>Nombre de la persona</span><input required maxLength={200} value={form.name} onChange={event=>setForm(current=>({...current,name:event.target.value}))} autoComplete="off"/></label>
          <label className="field"><span id={fieldId+'-username'}>Usuario de ingreso</span><input required minLength={3} maxLength={80} pattern="[a-zA-Z0-9_.@\-]+" aria-labelledby={fieldId+'-username'} aria-describedby={fieldId+'-username-hint'} value={form.username} onChange={event=>setForm(current=>({...current,username:event.target.value}))} autoComplete="off" autoCapitalize="none" spellCheck={false}/><small id={fieldId+'-username-hint'}>Usá letras sin acentos, números, punto, guion, guion bajo o @.</small></label>
          <label className="field"><span id={fieldId+'-password'}>Contraseña</span><input required type="password" minLength={6} maxLength={128} aria-labelledby={fieldId+'-password'} aria-describedby={fieldId+'-password-hint'} value={form.password} onChange={event=>setForm(current=>({...current,password:event.target.value}))} autoComplete="new-password"/><small id={fieldId+'-password-hint'}>Entre 6 y 128 caracteres. Compartila en privado con la persona.</small></label>
        </div>
        <button className="button button-primary" type="submit" disabled={busy||!form.name.trim()||!form.username.trim()||!form.password}>{busy?'Guardando…':'Habilitar usuario'}</button>
      </fieldset>
    </form>
    <h3>Usuarios del cliente</h3>
    {loading?<p className="muted" role="status">Consultando usuarios…</p>:items.length?<div className="inventory-list">{items.map(item=><article className="inventory-list-row customer-access-user" key={item.id} aria-label={'Acceso de '+item.name}>
      <div><strong>{item.name}</strong><small>{item.username}</small><span className={item.enabled?'badge badge-success':'badge badge-neutral'}>{item.enabled?'Activo':'Suspendido'}</span></div>
      <div className="inventory-actions">
        {item.enabled&&<AccountRecovery id={item.id} kind="CUSTOMER"/>}
        <button className="button button-secondary" type="button" disabled={busy} aria-label={(item.enabled?'Suspender':'Reactivar')+' acceso de '+item.name} onClick={()=>void mutate('/api/customer-access/'+encodeURIComponent(item.id)+(item.enabled?'/revoke':'/enable'),{},item.enabled?'Acceso suspendido. Sus sesiones quedaron cerradas.':'Acceso reactivado. La persona debe ingresar nuevamente.')}>
          {item.enabled?'Suspender':'Reactivar'}
        </button>
      </div>
    </article>)}</div>:!error&&<p className="empty-state">Todavía no hay usuarios para este cliente.</p>}
  </section>;
}
