import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {PointEditor} from './RoutingPanel';
import './routing.css';
type Row=Record<string,any>;
const total=(order:Row)=>order.units??order.lines.reduce((n:number,l:Row)=>n+l.quantity,0);
const matches=(order:Row,query:string)=>[order.reference??order.external_id,order.clientName??order.client_name,order.recipientName??order.recipient_name,order.destination,...order.lines.map((l:Row)=>`${l.name} ${l.sku}`)].join(' ').toLocaleLowerCase().includes(query);
function Articles({order}:{order:Row}){return <div className="dispatch-products">{order.lines.length?order.lines.map((line:Row)=><span key={line.sku}><strong>{line.name} × {line.quantity}</strong><small>SKU: {line.sku}</small></span>):<span>{total(order)} bultos directos</span>}</div>;}
export default function ReservedDispatch({onRefresh,onOpen,onConfigureDepot,revision}:{onConfigureDepot?:()=>void;onRefresh:()=>Promise<void>;onOpen:(id:string)=>void;revision?:unknown}){
 const [board,setBoard]=useState<Row|null>(null),[result,setResult]=useState<Row|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState<Row|null>(null),[search,setSearch]=useState('');
 const command=useRef<string|null>(null),generation=useRef(0);
 async function refresh(){const id=++generation.current,value=await api<Row>('/api/routing/queue');if(id===generation.current)setBoard(value);}
 useEffect(()=>{void refresh().catch(e=>setError(e.message));return()=>{generation.current++;};},[revision]);
 async function organize(){setBusy(true);setError('');command.current??=crypto.randomUUID();try{const value=await api<Row>('/api/routing/organize',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},body:JSON.stringify({commandId:command.current})},{timeoutMs:120000});setResult(value);command.current=null;await Promise.all([refresh(),onRefresh()]);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const query=search.trim().toLocaleLowerCase(),pending=board?.orders.filter((o:Row)=>matches(o,query))??[];
 const routes=(board?.routes??[]).map((r:Row)=>({...r,visibleOrders:r.orders.filter((o:Row)=>matches(o,query)||`${r.name} ${r.plate} ${r.driverName}`.toLocaleLowerCase().includes(query))})).filter((r:Row)=>r.visibleOrders.length);
 const assigned=new Set((board?.routes??[]).flatMap((r:Row)=>r.orders.map((o:Row)=>o.id))).size;
 return <section className="card reserved-dispatch" aria-label="Reservados por organizar">
  <div className="card-header"><div><h2>Reservados por organizar</h2><p>{board?`Por organizar: ${board.orders.length} (incluye atrasados) · Organizados: ${assigned} · Repartos activos: ${board.routes.length}`:'Consultando pedidos y camiones…'}</p></div><button type="button" className="button button-primary" disabled={busy||!board?.orders.length} onClick={()=>void organize()}>{busy?'Organizando…':'Organizar todos los reservados'}</button></div>
  {error&&<p className="notice error" role="alert">{error}</p>}
  {result&&<p className="dispatch-result" role="status">Organizados en esta operación: {result.organized} · Pendientes: {result.pending.length}. La distribución actual se muestra abajo.</p>}
  {board&&<><label className="field dispatch-search"><span>Buscar pedido, cliente, destinatario o camión</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Referencia, nombre, SKU o matrícula"/></label>
   <section aria-label="Pedidos por organizar" className="dispatch-section"><h3>Pedidos por organizar <span>{board.orders.length}</span></h3>
    {!!pending.length&&<div className="dispatch-columns" aria-hidden="true"><span>Pedido / cliente</span><span>Entrega</span><span>Artículos reservados</span><span>Organización</span></div>}
    {pending.map((order:Row)=><article className="dispatch-order" key={order.id} aria-label={order.external_id}>
     <div><strong>{order.external_id}</strong><small>{order.client_name}</small><span className="dispatch-count">{total(order)} bultos reservados</span></div>
     <div><strong>{order.recipient_name}</strong><small>{order.destination}</small></div>
     <Articles order={order}/>
     <div className="dispatch-order-action"><span className={'dispatch-reason '+(order.point?'':'dispatch-reason--review')}>{order.reason}</span><button type="button" className="button button-secondary" disabled={busy} onClick={()=>setReview(order)}>Revisar dirección</button>{onConfigureDepot&&order.reason.includes('ubicación del depósito')&&<button className="text-button" type="button" onClick={onConfigureDepot}>Configurar depósito</button>}</div>
    </article>)}
    {!pending.length&&<p className="muted">{query?'No hay pedidos pendientes que coincidan con la búsqueda.':board.orders.length?'Ajustá la búsqueda para ver los pedidos.':'No quedan reservas sin camión. Las nuevas reservas aparecerán aquí.'}</p>}
   </section>
   {review&&<section className="dispatch-location" aria-label="Revisar dirección"><div className="card-header"><div><strong>{review.recipient_name}</strong><small>{review.external_id} · {review.client_name}</small></div><button type="button" className="text-button" onClick={()=>setReview(null)}>Cerrar</button></div><PointEditor key={review.id} kind="ORDER" autoSearch item={review} point={review.point??undefined} onSave={()=>{setReview(null);setResult(null);command.current=null;void refresh().catch(e=>setError(e.message));}}/></section>}
   <section aria-label="Pedidos organizados por camión" className="dispatch-section"><h3>Pedidos organizados por camión <span>{assigned}</span></h3>
    {routes.map((route:Row)=><article className="routing-route dispatch-truck" key={route.id} aria-label={`${route.name} · ${route.plate}`}>
     <div className="card-header"><div><h4>{route.name} · Camión {route.plate}</h4><p>Chofer: <strong>{route.driverName}</strong> · Pedidos: {route.orders.length} · Bultos: {route.orders.reduce((n:number,o:Row)=>n+total(o),0)}</p></div><span className="badge badge-neutral">{route.state==='IN_PROGRESS'?'En reparto':route.state==='READY'?'Ruta confirmada':'Por cargar / confirmar'}</span></div>
     {route.capacityUnverified&&<p className="muted">Capacidad sin verificar: hay bultos sin peso o volumen.</p>}
     <ol className="dispatch-stop-list">{route.visibleOrders.map((order:Row)=><li key={`${order.id}:${order.kind}`}><div><span className="dispatch-stop-number">{order.sequence??'—'}</span><div><strong>{order.reference} · {order.clientName}</strong><small>{order.kind==='PICKUP'?'Retiro · ':''}{order.recipientName} · {order.destination}</small><Articles order={order}/></div></div><span className="dispatch-count">{total(order)} bultos{order.pendingLoad?` · ${order.pendingLoad} por cargar`:order.delivered?` · ${order.delivered} entregados`:` · ${order.loaded} en vehículo`}</span></li>)}</ol>
     <button className="button button-primary" type="button" disabled={busy} onClick={()=>onOpen(route.id)}>{route.state==='IN_PROGRESS'?'Abrir reparto':'Cargar este camión'}</button>
    </article>)}
    {!routes.length&&<p className="muted">{query?'No hay repartos que coincidan con la búsqueda.':'Al organizar, vas a ver aquí cada pedido con su camión, chofer y posición en la ruta.'}</p>}
   </section>
  </>}
 </section>;
}
