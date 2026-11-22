import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {api,type ApiProblem} from './api';
import HelpTip from './HelpTip';

type Product={id:string;sku:string;name:string;active?:boolean};
type RequestLine={productId:string;quantity:number};
type CustomerRequest={id:string;externalId:string;status:'PENDING'|'ACCEPTED'|'REJECTED';createdAt:string;orderId:string|null;rejectionReason:string};
const base='/api/customer/order-requests';
const stateLabels={PENDING:'Pendiente de revisión',ACCEPTED:'Registrado en NEXORA',REJECTED:'Observado por NEXORA'};

export default function CustomerOrderRequests({products,onCreated}:{products:Product[];onCreated:()=>void}) {
  const [requests,setRequests]=useState<CustomerRequest[]>([]);
  const [available,setAvailable]=useState(true),[loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const [externalId,setExternalId]=useState(''),[orderDate,setOrderDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [destination,setDestination]=useState(''),[recipientName,setRecipientName]=useState(''),
    [recipientPhone,setRecipientPhone]=useState(''),[restrictions,setRestrictions]=useState('');
  const [lines,setLines]=useState<RequestLine[]>([{productId:'',quantity:1}]);
  const retry=useRef<{key:string;commandId:string}|null>(null);
  const eligible=products.filter(p=>p.active!==false);
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
    const body={externalId:externalId.trim(),orderDate,destination:destination.trim(),recipientName:recipientName.trim(),
      recipientPhone:recipientPhone.trim(),restrictions:restrictions.trim(),lines:lines.map(l=>({productId:l.productId,quantity:l.quantity}))};
    const key=JSON.stringify(body),commandId=retry.current?.key===key?retry.current.commandId:crypto.randomUUID();
    retry.current={key,commandId};setBusy(true);setError('');setStatus('');
    try{
      const result=await api<{id:string;status:string}>(base,{method:'POST',
        headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},
        body:JSON.stringify({...body,commandId})});
      setStatus(result.status==='PENDING'?'Solicitud recibida. NEXORA debe revisarla antes de registrar el pedido.':'Solicitud recuperada.');
      retry.current=null;
      setExternalId('');setDestination('');setRecipientName('');setRecipientPhone('');setRestrictions('');
      setLines([{productId:'',quantity:1}]);await refresh();onCreated();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const changeLine=(index:number,patch:Partial<RequestLine>)=>setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line));
  if(loading)return <p role="status">Consultando solicitudes comerciales…</p>;
  if(!available)return <p className="notice" role="status">La carga de solicitudes estará disponible cuando NEXORA habilite este módulo. La consulta de stock y pedidos sigue operativa.</p>;
  return <section className="card stack" aria-label="Solicitudes de pedidos del comerciante">
    <div className="card-header"><h2>Solicitar nuevo pedido</h2><HelpTip label="Cómo funcionan las solicitudes">Una solicitud expresa qué querés entregar. No reserva stock, no confirma una venta ni despacha mercadería. NEXORA revisa y registra el pedido en el sistema operativo.</HelpTip></div>
    <form className="stack" onSubmit={e=>void submit(e)}>
      <div className="form-grid">
        <label className="field"><span>Número de pedido</span><input required maxLength={160} value={externalId} onChange={e=>setExternalId(e.target.value)}/></label>
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
      {error&&<p role="alert" className="notice error">{error}</p>}
      {status&&<p role="status" className="notice">{status}</p>}
      <div><button className="button button-primary" disabled={busy||eligible.length===0}>{busy?'Guardando…':'Enviar solicitud'}</button></div>
    </form>
    <div className="card-header"><h2>Mis solicitudes</h2><button type="button" className="button button-secondary" onClick={()=>void refresh()} disabled={busy}>Actualizar</button></div>
    {requests.length?<div className="table-wrap"><table className="table">
      <thead><tr><th>Pedido</th><th>Estado</th><th>Fecha</th></tr></thead>
      <tbody>{requests.map(r=><tr key={r.id}><td>{r.externalId}</td><td>{stateLabels[r.status]}{r.rejectionReason&&<small> · {r.rejectionReason}</small>}</td><td>{new Date(r.createdAt).toLocaleDateString('es-PY')}</td></tr>)}</tbody>
    </table></div>:<p className="muted">Sin solicitudes pendientes.</p>}
  </section>;
}
