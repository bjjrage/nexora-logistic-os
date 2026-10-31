import {useState,type ReactNode} from 'react';
import RouteItinerary from './RouteItinerary';
type Row=Record<string,any>;
export default function DispatchProposal({proposal,busy,onApprove,onReview,renderActions}:{proposal:Row;busy:boolean;onApprove:()=>Promise<void>;onReview:(id:string)=>void;renderActions:(id:string)=>ReactNode}){
 const [reviewed,setReviewed]=useState(false);
 const approval=(close?:()=>void)=><><label className="checkbox-field"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>Revisé la distribución, las ubicaciones y las indicaciones de entrega</label><button type="button" className="button button-primary" disabled={busy||!reviewed} onClick={()=>{close?.();void onApprove();}}>{busy?'Aplicando…':'Aprobar distribución y crear rutas'}</button></>;
 return <section className="dispatch-proposal" aria-label="Propuesta de distribución">
  <h3>Distribución lista para tu aprobación</h3><p>{proposal.proposed} pedidos agrupados · {proposal.proposedRoutes.length} camión(es). El sistema eligió los vehículos y choferes disponibles. Las rutas se crean al aprobar.</p>
  <p><strong>Salida propuesta: {new Intl.DateTimeFormat('es-PY',{timeZone:proposal.timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(proposal.schedule.startAt))}</strong> · Regreso antes de {new Intl.DateTimeFormat('es-PY',{timeZone:proposal.timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(proposal.schedule.endAt))}.</p>
  <RouteItinerary sources={proposal.proposedRoutes.map((r:Row)=>({label:`Camión ${r.plate} · ${r.driverName}`,source:{proposalCommandId:proposal.id,vehicleId:r.vehicleId}}))} footer={approval}/>
  {proposal.proposedRoutes.map((route:Row,index:number)=><article className="routing-route dispatch-truck" key={`${route.vehicleId}:${index}`} aria-label={`Propuesta · Camión ${route.plate}`}>
   <div className="card-header"><div><h4>Camión {route.plate}</h4><p>Chofer: <strong>{route.driverName}</strong> · {route.stops.length} pedido(s){route.existingOrders?` nuevos · se suman a ${route.name}`:''}</p></div><span className="badge badge-neutral">Por aprobar</span></div>
   {route.capacityUnverified&&<p className="muted">Hay productos sin peso o volumen; revisá la capacidad física antes de cargar.</p>}
   <p>{route.stops.map((s:Row)=>s.reference).join(' · ')}</p>
   <details><summary>Revisar productos o corregir ubicaciones</summary><ol className="dispatch-stop-list">{route.stops.map((stop:Row,i:number)=>{const point=proposal.locationSuggestions.find((p:Row)=>p.id===stop.orderId);return <li key={stop.orderId}><div><span className="dispatch-stop-number">{i+1}</span><div><strong>{stop.reference} · {stop.recipientName}</strong><small>{stop.destination}</small><div className="dispatch-products">{stop.lines.map((line:Row)=><span key={line.sku}><strong>{line.name} × {line.quantity}</strong><small>SKU: {line.sku}</small></span>)}</div>{point&&<p className={point.precision==='EXACT'?'muted':'place-approximate'}>{point.precision==='EXACT'?'Ubicación encontrada':'Referencia cercana para organizar'}: {point.label}{point.precision!=='EXACT'&&<small>{point.precision==='AREA'?'Zona aproximada':'Calle aproximada'}; la altura exacta no está verificada.</small>}</p>}{stop.instructions&&<p><strong>Indicaciones:</strong> {stop.instructions}</p>}<button className="text-button" type="button" disabled={busy} onClick={()=>onReview(stop.orderId)}>Revisar ubicación</button>{renderActions(stop.orderId)}</div></div></li>;})}</ol></details>
  </article>)}
  {approval()}
 </section>;
}
