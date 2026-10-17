import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, RefreshCw, Send, Link2, FileCheck2, ListChecks, Settings } from 'lucide-react';
import { api as apiRequest, type ApiProblem } from './api';
import './tracking.css';

type Entity={id:string;reference?:string;name?:string;state?:string;code?:string;shipmentId?:string};
type Props={shipments:Entity[];parcels:Entity[];routes:Entity[];onRefresh:()=>Promise<void>;onConfigure:()=>void};
type Link={parcelId:string;parcelCode:string;reference:string;externalCode:string;externalOrderId:string|null;state:string;errorCode:string|null;providerResult:string;evidenceState:string};
type RouteLink={routeId:string;externalRouteId:string;syncedAt:string|null;errorCode:string|null};
type Status={configured:boolean;proofDownloadsConfigured:boolean;statusMappingConfigured:boolean;parcels:Link[];routes:RouteLink[];events:{id:string;eventType:string;externalCode:string;state:string;receivedAt:string}[]};
const pendingCommands=new Map<string,string>();
async function api<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  const value=body&&typeof body==='object'?body as Record<string,unknown>:null;
  const key=value?path+':'+JSON.stringify(Object.fromEntries(Object.entries(value).filter(([name])=>name!=='commandId'))):null;
  const commandId=key?pendingCommands.get(key)??(typeof value?.commandId==='string'?value.commandId:crypto.randomUUID()):null;
  if(key&&commandId)pendingCommands.set(key,commandId);
  try{const result=await apiRequest<T>(path,{method:body?'POST':'GET',signal,headers:body?{'Content-Type':'application/json','X-Requested-With':'logistics-os'}:undefined,body:body?JSON.stringify({...value,commandId}):undefined},{timeoutMs:body?30000:15000});if(key)pendingCommands.delete(key);return result;}
  catch(error){if(key&&(error as ApiProblem)?.status&&((error as ApiProblem).status??0)<500)pendingCommands.delete(key);throw error;}
}
export default function QuadOperationsPanel({shipments,parcels,routes,onRefresh,onConfigure}:Props){
  const [task,setTask]=useState<'home'|'send'|'route'|'sync'|'results'|'existing'>('home');
  const [page,setPage]=useState(0);
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [shipmentId,setShipment]=useState(''),[poiId,setPoi]=useState(''),[date,setDate]=useState(()=>new Date().toLocaleDateString('en-CA'));
  const [routeId,setRoute]=useState(''),[externalRouteId,setExternalRoute]=useState('');
  const [parcelId,setParcel]=useState(''),[externalCode,setExternalCode]=useState(''),[externalOrderId,setExternalOrder]=useState('');
  const load=useCallback(async(signal?:AbortSignal)=>{try{const value=await api<Status>('/api/quadminds/operations',undefined,signal);if(!signal?.aborted){setStatus(value);setError('');}}catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Error de conexión.');}},[]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  async function run(work:()=>Promise<unknown>,message:string){setBusy(true);setError('');setNotice('');try{await work();setNotice(message);await load();await onRefresh();}catch(e){setError(e instanceof Error?e.message:'No se pudo completar la operación.');}finally{setBusy(false);}}
  const titles={home:'Universo · QuadMinds',send:'Enviar un pedido',route:'Vincular una ruta',sync:'Actualizar entregas',results:'Pedidos y comprobantes',existing:'Vincular una orden existente'};
  const stateLabels:Record<string,string>={QUEUED:'Pendiente de envío',PROCESSING:'Enviando',EXPORTED:'Enviado',LINKED:'Vinculado',ERROR:'Revisar'};
  const rows=status?.parcels??[],pages=Math.max(1,Math.ceil(rows.length/20)),currentPage=Math.min(page,pages-1);
  return <section className="tracking-workspace quad-operations" aria-labelledby="quad-operations-title">
    <header className="tracking-heading"><div>{task!=='home'&&<button className="tracking-back" type="button" disabled={busy} onClick={()=>{setTask('home');setError('');setNotice('');}}><ArrowLeft size={16}/>Volver a QuadMinds</button>}<h2 id="quad-operations-title">{titles[task]}</h2>{task==='home'&&<p>Elegí qué necesitás hacer para Universo.</p>}</div><div className="tracking-heading-actions"><span className={`tracking-status ${status?.configured?'is-connected':''}`}>{status?status.configured?'Conectado':'Conexión pendiente':'Consultando…'}</span><button type="button" className="button button-secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/>Actualizar</button></div></header>
    {error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    {task==='home'&&<>
      {status&&!status.configured&&<p className="tracking-feedback">Falta conectar la cuenta de Universo para enviar pedidos y recibir entregas.</p>}
      {status?.configured&&(!status.proofDownloadsConfigured||!status.statusMappingConfigured)&&<p className="tracking-feedback">Falta completar la configuración de comprobantes.</p>}
      <div className="tracking-task-grid">
        <button className="tracking-task" onClick={()=>setTask('send')}><Send/><span><strong>Enviar pedido</strong><small>Preparar y enviar al planificador</small></span><span aria-hidden="true">→</span></button>
        <button className="tracking-task" onClick={()=>setTask('route')}><Link2/><span><strong>Vincular ruta</strong><small>Usar una ruta publicada por Universo</small></span><span aria-hidden="true">→</span></button>
        <button className="tracking-task" onClick={()=>setTask('sync')}><FileCheck2/><span><strong>Actualizar entregas</strong><small>Recibir resultados, fotos y firmas</small></span><span aria-hidden="true">→</span></button>
        <button className="tracking-task" onClick={()=>setTask('results')}><ListChecks/><span><strong>Pedidos y comprobantes</strong><small>Consultar el estado de cada pedido</small></span><span aria-hidden="true">→</span></button>
      </div>
      <div className="tracking-secondary-actions"><a className="button button-secondary" href="https://saas.quadminds.com" target="_blank" rel="noreferrer"><ExternalLink size={16}/>Abrir QuadMinds</a><button className="text-button" onClick={onConfigure}><Settings size={16}/>Vincular vehículo</button><button className="text-button" onClick={()=>setTask('existing')}>Vincular orden existente</button></div>
    </>}
    <div className="tracking-form-area">
      {task==='send'&&<form className="card tracking-form-card" onSubmit={e=>{e.preventDefault();void run(()=>api(`/api/quadminds/shipments/${shipmentId}/queue`,{poiId:Number(poiId),date}),'Pedido preparado. Ya podés enviar los pendientes.');}}>
        <label>Pedido preparado<select required value={shipmentId} onChange={e=>setShipment(e.target.value)}><option value="">Seleccionar</option>{shipments.map(s=><option key={s.id} value={s.id}>{s.reference}</option>)}</select></label>
        <label>ID del destino en QuadMinds<input required type="number" min="1" step="1" value={poiId} onChange={e=>setPoi(e.target.value)}/></label>
        <small className="muted">Usá el destino registrado por Universo.</small>
        <label>Fecha de entrega<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        <div className="button-row"><button className="button button-primary" disabled={busy} type="submit">Preparar envío</button>
        <button className="button button-secondary" type="button" disabled={busy||!status?.configured} onClick={()=>void run(async()=>{const result=await api<{results:{state:string}[]}>('/api/quadminds/process',{limit:10});const failed=result.results.filter(r=>r.state==='ERROR').length;if(failed)throw new Error(`${failed} órdenes siguen pendientes. Revisá Pedidos y comprobantes.`);},'Cola procesada. Revisá las órdenes en QuadMinds.')}>Enviar pendientes</button></div>
      </form>}
      {(task==='route'||task==='sync')&&<form className="card tracking-form-card" onSubmit={e=>{e.preventDefault();if(task==='route')void run(()=>api(`/api/quadminds/routes/${routeId}/bind`,{externalRouteId}),'Ruta vinculada.');}}>
        <label>Ruta de Nexora<select required value={routeId} onChange={e=>setRoute(e.target.value)}><option value="">Seleccionar ruta</option>{routes.filter(r=>task==='route'||status?.routes.some(link=>link.routeId===r.id)).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        {task==='sync'&&!status?.routes.length&&<p className="tracking-empty">Primero vinculá la ruta publicada en QuadMinds.</p>}
        {task==='route'&&<><label>ID de ruta QuadMinds<input required maxLength={128} value={externalRouteId} onChange={e=>setExternalRoute(e.target.value)}/></label>
        <div className="button-row"><button className="button button-primary" disabled={busy} type="submit">Guardar vínculo</button>
        <button className="button button-secondary" disabled={busy||!routeId||!status?.configured} type="button" onClick={()=>void run(()=>api(`/api/quadminds/routes/${routeId}/sync`,{applySequence:true}),'Orden de paradas aplicado al borrador de Nexora.')}>Importar orden de paradas</button>
        </div><details className="tracking-help"><summary>Cuándo importar las paradas</summary><p>La ruta debe estar en borrador y tener sus unidades vinculadas. Se copia el orden publicado por Universo.</p></details></>}
        {task==='sync'&&<button className="button button-primary" disabled={busy||!status?.routes.some(link=>link.routeId===routeId)||!status?.configured} type="button" onClick={()=>void run(async()=>{const result=await api<{unknown:string[];outcomes:{error?:string}[];reconciled:{applied:{pending?:boolean}[];pending?:string}}>(`/api/quadminds/routes/${routeId}/sync`,{applySequence:false});if(result.unknown.length||result.outcomes.some(o=>o.error)||result.reconciled.pending||result.reconciled.applied.some(a=>a.pending))throw new Error('Quedan entregas o comprobantes por revisar en Pedidos y comprobantes.');},'Entregas actualizadas. Revisá los comprobantes.') }><FileCheck2 size={16}/>Actualizar entregas</button>}
      </form>}
    </div>
    {task==='existing'&&<form className="card tracking-form-card" onSubmit={e=>{e.preventDefault();void run(()=>api(`/api/quadminds/parcels/${parcelId}/bind`,{externalCode,externalOrderId,poiId:Number(poiId),date}),'Orden existente vinculada.');}}>
      <label>Unidad / bulto<select required value={parcelId} onChange={e=>setParcel(e.target.value)}><option value="">Seleccionar</option>{parcels.map(p=><option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
      <label>Código de orden QuadMinds<input required maxLength={40} value={externalCode} onChange={e=>setExternalCode(e.target.value)}/></label>
      <label>ID de orden QuadMinds<input required maxLength={128} value={externalOrderId} onChange={e=>setExternalOrder(e.target.value)}/></label>
      <label>ID del destino<input type="number" required min="1" value={poiId} onChange={e=>setPoi(e.target.value)}/></label>
      <label>Fecha<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><button className="button" type="submit" disabled={busy}>Vincular orden</button>
    </form>}
    {task==='results'&&<><div className="card"><div className="table-wrap"><table className="table"><thead><tr><th>Pedido / bulto</th><th>Envío</th><th>Entrega</th><th>Comprobante</th></tr></thead><tbody>{rows.slice(currentPage*20,(currentPage+1)*20).map(p=><tr key={p.parcelId}><td><strong>{p.reference}</strong><br/><small>{p.parcelCode}</small></td><td>{stateLabels[p.state]??'En proceso'}{p.errorCode&&<details className="tracking-help"><summary>Ver motivo</summary><p>{p.errorCode}</p></details>}</td><td>{p.providerResult==='DELIVERED'?'Informada':p.providerResult==='FAILED'?'No completada':'Pendiente'}</td><td>{p.evidenceState==='COMPLETE'?'Foto y firma guardadas':p.providerResult==='DELIVERED'?'Falta evidencia':'Pendiente'}</td></tr>)}</tbody></table></div>{!rows.length&&<p className="tracking-empty">Todavía no hay pedidos vinculados con QuadMinds.</p>}{pages>1&&<div className="list-pagination"><button className="button button-secondary" disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>Anterior</button><span>{currentPage+1} / {pages}</span><button className="button button-secondary" disabled={currentPage===pages-1} onClick={()=>setPage(currentPage+1)}>Siguiente</button></div>}</div>
    {!!status?.routes.length&&<details className="tracking-help"><summary>Últimas consultas de rutas</summary><div className="table-wrap"><table className="table"><thead><tr><th>Ruta</th><th>ID externo</th><th>Última consulta</th><th>Estado</th></tr></thead><tbody>{status.routes.map(r=><tr key={r.routeId}><td>{routes.find(x=>x.id===r.routeId)?.name??r.routeId}</td><td>{r.externalRouteId}</td><td>{r.syncedAt?new Date(r.syncedAt).toLocaleString():'Sin consultar'}</td><td>{r.errorCode??'Sin error registrado'}</td></tr>)}</tbody></table></div></details>}</>}
  </section>;
}
