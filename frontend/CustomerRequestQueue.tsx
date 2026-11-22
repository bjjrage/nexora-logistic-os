import {useCallback,useEffect,useRef,useState} from 'react';
import {api,type ApiProblem} from './api';
import HelpTip from './HelpTip';
import {RequestHistory} from './RequestHistory';

type Order={externalId:string;recipientName:string;recipientPhone:string;destination:string;orderDate:string;lines:{productId:string;quantity:number}[]};
type Request={id:string;clientName:string;externalId:string;status:'PENDING'|'ACCEPTED'|'REJECTED'|'CANCELLED';order:Order;createdAt:string;version:number;change?:{id:string;kind:string;state:string;reason:string;proposed:Order|null}};
type Page={rows:Request[];total:number;limit:number;offset:number};
type Result={id:string;status:string;orderId?:string};
const base='/api/minios/order-requests';
const labels={PENDING:'Pendiente',ACCEPTED:'Registrada',REJECTED:'Rechazada',CANCELLED:'Cancelada',CHANGE_PENDING:'Cambios pendientes'};
export default function CustomerRequestQueue() {
  const [status,setStatus]=useState<keyof typeof labels>('PENDING'),[offset,setOffset]=useState(0);
  const [data,setData]=useState<Page>(),[error,setError]=useState(''),[working,setWorking]=useState<string|null>(null);
  const [reasons,setReasons]=useState<Record<string,string>>({});
  const pending=useRef(new Map<string,{commandId:string;body:string}>());
  const load=useCallback(async()=>{
    try{
      const result=await api<Page>(base+'?'+new URLSearchParams({status,limit:'25',offset:String(offset)}));
      setData(result);setError('');
    }catch(e){const x=e as ApiProblem;setError(x.status===503?'Las solicitudes no están habilitadas hasta verificar la migración.':x.message);}
  },[offset,status]);
  useEffect(()=>{void load();},[load]);
  async function action(request:Request,kind:'accept'|'reject'|'review',outcome?:'ACKNOWLEDGED'|'REJECTED') {
    const reason=(reasons[request.id]??'').trim();
    const body={expectedVersion:request.version,...(kind==='accept'?{}:{reason}),
      ...(kind==='review'?{outcome,changeId:request.change?.id}:{})};
    if(kind!=='accept'&&!reason){setError('Indicá un motivo.');return;}
    const key=request.id+'|'+kind,hash=JSON.stringify(body);
    const existing=pending.current.get(key);
    const commandId=existing?.body===hash?existing.commandId:crypto.randomUUID();
    pending.current.set(key,{commandId,body:hash});setWorking(key);setError('');
    try{
      const response=await api<Result>(base+'/'+request.id+'/'+kind,{
        method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},
        body:JSON.stringify({...body,commandId}),
      });
      pending.current.delete(key);
      if(kind!=='review'&&response.status!== (kind==='accept'?'ACCEPTED':'REJECTED'))throw new Error('La solicitud no confirmó el cambio.');
      await load();
    }catch(e){setError((e as Error).message);}finally{setWorking(null);}
  }
  return <div className="stack">
    <div className="page-heading">
      <h1>Solicitudes de comerciantes</h1>
      <HelpTip label="Alcance">Aceptar registra un pedido DRAFT en el núcleo existente de NEXORA. No reserva stock ni despacha. El comercio no tiene permisos de inventario ni custodia.</HelpTip>
    </div>
    <section className="card stack">
      <div className="crm-actions" style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <label className="field"><span>Estado de solicitudes</span><select value={status} onChange={e=>{setStatus(e.target.value as keyof typeof labels);setOffset(0);}}>
          <option value="PENDING">Pendientes</option><option value="ACCEPTED">Registradas</option><option value="REJECTED">Rechazadas</option><option value="CANCELLED">Canceladas</option><option value="CHANGE_PENDING">Cambios pendientes</option>
        </select></label>
        <button className="button button-secondary" onClick={()=>void load()}>Actualizar</button>
      </div>
      {error&&<p className="notice error" role="alert">{error}</p>}
      <div className="stack">
        {data?.rows.map(r=><article key={r.id} className="card stack">
          <div className="card-header"><h2>{r.clientName} · {r.externalId}</h2><span className="badge badge-neutral">{labels[r.status]}</span></div>
          <div className="form-grid">
            <span><strong>Receptor:</strong> {r.order.recipientName}</span>
            <span><strong>Destino:</strong> {r.order.destination}</span>
            <span><strong>Fecha:</strong> {r.order.orderDate}</span>
            <span><strong>Líneas:</strong> {r.order.lines.map(l=>l.quantity).reduce((a,b)=>a+b,0)} unidades · {r.order.lines.length} SKU</span>
          </div>
          <RequestHistory key={r.version} path={base+'/'+r.id+'/history'}/>
          {r.change?.state==='PENDING'&&<div className="stack">
            <strong>{r.change.kind==='EDIT'?'Edición solicitada':'Cancelación solicitada'} · {r.change.reason}</strong>
            {r.change.proposed&&<ul>
              <li>{r.change.proposed.orderDate} · {r.change.proposed.recipientName} · {r.change.proposed.destination}</li>
              {r.change.proposed.lines.map(line=><li key={line.productId}>{line.productId} · {line.quantity}</li>)}
            </ul>}
            <label className="field"><span>Motivo de revisión</span><input maxLength={500} value={reasons[r.id]??''} onChange={e=>setReasons(v=>({...v,[r.id]:e.target.value}))}/></label>
            <div className="crm-actions">
              <button type="button" className="button button-primary" disabled={working!==null} onClick={()=>void action(r,'review','ACKNOWLEDGED')}>Registrar revisión</button>
              <button type="button" className="button button-secondary" disabled={working!==null} onClick={()=>void action(r,'review','REJECTED')}>Rechazar cambio</button>
            </div>
          </div>}
          {r.status==='PENDING'&&<div className="crm-actions" style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'end'}}>
            <button className="button button-primary" disabled={working!==null} onClick={()=>void action(r,'accept')}>Registrar pedido</button>
            <label className="field"><span>Motivo de rechazo</span><input maxLength={500} value={reasons[r.id]??''} onChange={e=>setReasons(v=>({...v,[r.id]:e.target.value}))}/></label>
            <button className="button button-secondary" disabled={working!==null||!(reasons[r.id]??'').trim()} onClick={()=>void action(r,'reject')}>Rechazar</button>
          </div>}
        </article>)}
        {data&&!data.rows.length&&<p className="muted">No hay solicitudes en este estado.</p>}
      </div>
      {data&&<nav className="pagination" aria-label="Páginas de solicitudes comerciales">
        <button className="button button-secondary" disabled={offset===0} onClick={()=>setOffset(v=>Math.max(0,v-25))}>Anterior</button>
        <span>{data.total?offset+1:0}–{Math.min(offset+25,data.total)} de {data.total}</span>
        <button className="button button-secondary" disabled={offset+25>=data.total} onClick={()=>setOffset(v=>v+25)}>Siguiente</button>
      </nav>}
    </section>
  </div>;
}
