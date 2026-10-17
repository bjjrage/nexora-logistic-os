import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {api} from './api';

type Props={clients:Array<{id:string;name:string}>};
type Access={userId:string;email:string;clientName:string;status:string};
type ShippingRequest={id:string;reference:string;clientName:string;originText:string;destinationText:string;parcelCount:number;status:string};

async function request<T>(path:string,body?:unknown):Promise<T>{
  return api<T>(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Requested-With':'logistics-os'}:undefined,body:body?JSON.stringify(body):undefined},{timeoutMs:body?30000:15000});
}

export default function GooglePortalAccess({clients}:Props){
  const [items,setItems]=useState<Access[]>([]),[requests,setRequests]=useState<ShippingRequest[]>([]),[available,setAvailable]=useState(false),[email,setEmail]=useState(''),[clientId,setClientId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const load=useCallback(async()=>{try{const data=await request<{available:boolean;items:Access[];requests:ShippingRequest[]}>('/api/customer-google-access');setAvailable(data.available);setItems(data.items);setRequests(data.requests);}catch(caught){setError(caught instanceof Error?caught.message:'No se pudieron cargar los accesos.');}},[]);
  useEffect(()=>{void load();},[load]);
  async function mutate(path:string,body:unknown,success:string){setBusy(true);setError('');setMessage('');try{await request(path,body);setMessage(success);await load();}catch(caught){setError(caught instanceof Error?caught.message:'No se pudo guardar.');}finally{setBusy(false);}}
  function grant(event:FormEvent){event.preventDefault();void mutate('/api/customer-google-access',{commandId:crypto.randomUUID(),clientId,email:email.trim()},'Cuenta vinculada. El cliente ya puede entrar al portal.');}

  const pendingRequests=requests.filter(item=>item.status==='REQUESTED').length;
  return <section className="card customer-access-method" aria-labelledby="google-access-title">
    <div className="card-header"><div><h2 id="google-access-title">Conectar con Google</h2><p>Para clientes que ya usan el portal con Google.</p></div></div>
    {error&&<p role="alert" className="notice error">{error}</p>}
    {message&&<p role="status" className="notice">{message}</p>}
    {!available?<p className="muted">La conexión con Google no está disponible.</p>:<>
      <form className="stack" onSubmit={grant}>
        <div className="inventory-form-grid">
          <label className="field"><span>Cliente</span><select value={clientId} onChange={event=>setClientId(event.target.value)} required><option value="">Seleccionar</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label className="field"><span>Correo de Google</span><input type="email" value={email} onChange={event=>setEmail(event.target.value)} required autoComplete="email"/></label>
        </div>
        <button className="button button-primary" disabled={busy}>Vincular cuenta</button>
      </form>
      <details className="customer-access-disclosure" open={items.length>0}>
        <summary>Cuentas vinculadas <span className="customer-access-count">{items.length}</span></summary>
        {items.length?<div className="inventory-list">{items.map(item=><div className="inventory-list-row" key={item.userId}><span><strong>{item.email}</strong><small>{item.clientName} · {item.status==='active'?'Activa':'Suspendida'}</small></span>{item.status==='active'&&<button className="button button-secondary" disabled={busy} onClick={()=>void mutate(`/api/customer-google-access/${encodeURIComponent(item.userId)}/revoke`,{commandId:crypto.randomUUID()},'Acceso suspendido.')}>Suspender</button>}</div>)}</div>:<p className="muted">Todavía no hay cuentas vinculadas.</p>}
      </details>
      <details className="customer-access-disclosure" open={pendingRequests>0}>
        <summary>Solicitudes del portal <span className="customer-access-count">{pendingRequests}</span></summary>
        {requests.length?<div className="inventory-list">{requests.map(item=><div className="inventory-list-row" key={item.id}><span><strong>{item.reference} · {item.clientName}</strong><small>{item.originText} → {item.destinationText} · {item.parcelCount} bultos · {item.status}</small></span>{item.status==='REQUESTED'&&<button className="button button-primary" disabled={busy} onClick={()=>void mutate(`/api/customer-shipping-requests/${encodeURIComponent(item.id)}/accept`,{},'Solicitud aceptada y envío creado en el OS.')}>Crear envío</button>}</div>)}</div>:<p className="muted">No hay solicitudes pendientes.</p>}
      </details>
    </>}
  </section>;
}
