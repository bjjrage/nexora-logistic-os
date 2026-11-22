import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {api,type ApiProblem} from './api';
import HelpTip from './HelpTip';
import {RequestHistory} from './RequestHistory';

type Product={id:string;sku:string;name:string;active?:boolean};
type RequestLine={productId:string;quantity:number};
type OrderInput={orderDate:string;destination:string;recipientName:string;recipientPhone:string;restrictions:string;lines:RequestLine[]};
type CustomerRequest={id:string;externalId:string;status:'PENDING'|'ACCEPTED'|'REJECTED'|'CANCELLED';createdAt:string;orderId:string|null;rejectionReason:string;version:number;order:OrderInput;change?:{state:string;kind:string;reason:string;reviewReason?:string}};
const changeStatus:Record<string,string>={PENDING:'Cambio pendiente de revisión', ACKNOWLEDGED:'Cambio revisado', REJECTED:'Cambio rechazado'};
const base='/api/customer/order-requests';
const stateLabels={PENDING:'Pendiente de revisión',ACCEPTED:'Registrado en NEXORA',REJECTED:'Observado por NEXORA',CANCELLED:'Cancelada'};

export default function CustomerOrderRequests({products,onCreated,onOrder}:{products:Product[];onCreated:()=>void;onOrder:(id:string)=>void}) {
  const [requests,setRequests]=useState<CustomerRequest[]>([]);
  const [available,setAvailable]=useState(true),[loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const [externalId,setExternalId]=useState(''),[orderDate,setOrderDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [destination,setDestination]=useState(''),[recipientName,setRecipientName]=useState(''),
    [recipientPhone,setRecipientPhone]=useState(''),[restrictions,setRestrictions]=useState('');
  const [lines,setLines]=useState<RequestLine[]>([{productId:'',quantity:1}]);
  const retry=useRef<{key:string;commandId:string}|null>(null);
  const [editing,setEditing]=useState<{request:CustomerRequest;kind:'EDIT'|'CANCEL'}|null>(null);
  const [reason,setReason]=useState('');
  const eligible=products.filter(p=>p.active!==false);
  const begin=(request:CustomerRequest,kind:'EDIT'|'CANCEL')=>{
    setEditing({request,kind});setReason('');setError('');setStatus('');
    setExternalId(request.externalId);setOrderDate(request.order.orderDate);setDestination(request.order.destination);
    setRecipientName(request.order.recipientName);setRecipientPhone(request.order.recipientPhone);
    setRestrictions(request.order.restrictions);setLines(request.order.lines);
  };
  function clear() {
    setEditing(null);setReason('');setExternalId('');setDestination('');setRecipientName('');setRecipientPhone('');
    setRestrictions('');setLines([{productId:'',quantity:1}]);
  }
  const refresh=useCallback(async()=>{
    try {
      const result=await api<{rows:CustomerRequest[];total:number}>(base,{},{timeoutMs:15000});
      setRequests(result.rows);setAvailable(true);
    }catch(e) {
      const issue=e as ApiProblem;
      if(issue.status===503)setAvailable(false);
      else setError(issue.message);
    }finally{setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!available||busy)return;
    const order={orderDate,destination:destination.trim(),recipientName:recipientName.trim(),
      recipientPhone:recipientPhone.trim(),restrictions:restrictions.trim(),lines:lines.map(l=>({productId:l.productId,quantity:l.quantity}))};
    const path=editing?base+'/'+editing.request.id+'/change':base;
    const body=editing
      ? {expectedVersion:editing.request.version,kind:editing.kind,reason:reason.trim(),...(editing.kind==='EDIT'?{order}:{})}
      : {externalId:externalId.trim(),...order};
    const key=JSON.stringify([path,body]),commandId=retry.current?.key===key?retry.current.commandId:crypto.randomUUID();
    retry.current={key,commandId};setBusy(true);setError('');setStatus('');
    try{
      const result=await api<{id:string;status:string;changeId?:string}>(path,{method:'POST',
        headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},
        body:JSON.stringify({...body,commandId})});
      setStatus(result.changeId?'Cambio recibido para revisión.':result.status==='CANCELLED'?'Solicitud cancelada.':'Solicitud guardada.');
      retry.current=null;clear();await refresh();onCreated();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const changeLine=(index:number,patch:Partial<RequestLine>)=>setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line));
  if(loading)return <p role="status">Consultando solicitudes comerciales…</p>;
  if(!available)return <p className="notice" role="status">La carga de solicitudes estará disponible cuando NEXORA habilite este módulo. La consulta de stock y pedidos sigue operativa.</p>;
  return <section className="card stack" aria-label="Solicitudes de pedidos del comerciante">
    <div className="card-header"><h2>{editing?editing.kind==='EDIT'?'Editar '+editing.request.externalId:'Cancelar '+editing.request.externalId:'Solicitar nuevo pedido'}</h2><HelpTip label="Cómo funcionan las solicitudes">Una solicitud expresa qué querés entregar. No reserva stock, no confirma una venta ni despacha mercadería. NEXORA revisa y registra el pedido en el sistema operativo.</HelpTip></div>
    <form className="stack" onSubmit={e=>void submit(e)}>
      {editing?.kind!=='CANCEL'&&<><div className="form-grid">
        <label className="field"><span>Número de pedido</span><input required maxLength={160} readOnly={!!editing} value={externalId} onChange={e=>setExternalId(e.target.value)}/></label>
        <label className="field"><span>Fecha</span><input required type="date" value={orderDate} onChange={e=>setOrderDate(e.target.value)}/></label>
        <label className="field"><span>Destinatario</span><input required maxLength={500} value={recipientName} onChange={e=>setRecipientName(e.target.value)}/></label>
        <label className="field"><span>Teléfono del destinatario</span><input maxLength={80} type="tel" value={recipientPhone} onChange={e=>setRecipientPhone(e.target.value)}/></label>
        <label className="field"><span>Dirección de entrega</span><input required maxLength={500} value={destination} onChange={e=>setDestination(e.target.value)}/></label>
        <label className="field"><span>Indicaciones</span><input maxLength={1000} value={restrictions} onChange={e=>setRestrictions(e.target.value)}/></label>
      </div>
      <div className="stack">
        <strong>Productos</strong>
        {lines.map((line,index)=><div key={index} className="crm-actions" style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'end'}}>
          <label className="field"><span>Producto {index+1}</span><select required value={line.productId} onChange={e=>changeLine(index,{productId:e.target.value})}>
            <option value="">Elegí un producto</option>
            {eligible.filter(p=>p.id===line.productId||!lines.some((other,i)=>i!==index&&other.productId===p.id)).map(p=><option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
          </select></label>
          <label className="field"><span>Cantidad</span><input type="number" min={1} max={200} required value={line.quantity} onChange={e=>changeLine(index,{quantity:Number(e.target.value)})}/></label>
          {lines.length>1&&<button type="button" className="button button-secondary" disabled={busy} onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}>Quitar</button>}
        </div>)}
        {lines.length<200&&<div><button type="button" className="button button-secondary" disabled={busy} onClick={()=>setLines(current=>[...current,{productId:'',quantity:1}])}>Añadir producto</button></div>}
      </div>
      </>}
      {editing&&<label className="field"><span>Motivo del cambio</span><input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
      {error&&<p role="alert" className="notice error">{error}</p>}
      {status&&<p role="status" className="notice">{status}</p>}
      <div className="crm-actions">
        <button className="button button-primary" disabled={busy||(editing?.kind!=='CANCEL'&&eligible.length===0)}>
          {busy?'Guardando…':editing?.request.status==='ACCEPTED'?'Solicitar cambio':editing?.kind==='CANCEL'?'Confirmar cancelación':editing?'Guardar cambios':'Enviar solicitud'}
        </button>
        {editing&&<button type="button" className="button button-secondary" onClick={clear}>Volver</button>}
      </div>
    </form>
    <div className="card-header"><h2>Mis solicitudes</h2><button type="button" className="button button-secondary" onClick={()=>void refresh()} disabled={busy}>Actualizar</button></div>
    {requests.length?<div className="table-wrap"><table className="table">
      <thead><tr><th>Pedido</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>{requests.map(r=><tr key={r.id}><td>{r.externalId}</td><td>{stateLabels[r.status]}{r.rejectionReason&&<small> · {r.rejectionReason}</small>}</td><td>
      <div className="crm-actions">
        {r.orderId&&<button type="button" className="text-button" onClick={()=>onOrder(r.orderId!)}>Ver pedido</button>}
        {(r.status==='PENDING'||r.status==='ACCEPTED')&&r.change?.state!=='PENDING'&&<>
          <button type="button" className="text-button" disabled={busy} onClick={()=>begin(r,'EDIT')}>Editar</button>
          <button type="button" className="text-button" disabled={busy} onClick={()=>begin(r,'CANCEL')}>Cancelar</button>
        </>}
        <RequestHistory key={r.version} path={base+'/'+r.id+'/history'}/>
      </div>
      {r.change&&<small>{changeStatus[r.change.state]}{r.change.reviewReason&&' · '+r.change.reviewReason}</small>}
      </td></tr>)}</tbody>
    </table></div>:<p className="muted">Sin solicitudes pendientes.</p>}
  </section>;
}
