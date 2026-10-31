import {lazy,Suspense,useEffect,useRef,useState,type ReactNode} from 'react';
import {api} from './api';
import './route-itinerary.css';
const RouteItineraryMap=lazy(()=>import('./RouteItineraryMap'));
type Row=Record<string,any>;
type Source={routeId:string}|{proposalCommandId:string;vehicleId:string};
type Props={sources:{label:string;source:Source}[];footer?:ReactNode|((close:()=>void)=>ReactNode);label?:string};
const km=(n:number|null)=>n==null?'Sin calcular':new Intl.NumberFormat('es-PY',{maximumFractionDigits:1}).format(n/1000)+' km';
const duration=(n:number|null)=>n==null?'Sin calcular':`${Math.floor(n/3600)} h ${Math.ceil((n%3600)/60)} min`;
export default function RouteItinerary({sources,footer,label='Ver mapa grande y recorrido'}:Props){
 const [open,setOpen]=useState(false);
 return <><button type="button" className="button button-secondary" onClick={()=>setOpen(true)}>{label}</button>{open&&<ItineraryDialog sources={sources} footer={footer} onClose={()=>setOpen(false)}/>}</>;
}
function ItineraryDialog({sources,footer,onClose}:{sources:Props['sources'];footer?:Props['footer'];onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),list=useRef<HTMLDivElement>(null);
 const [index,setIndex]=useState(0),[report,setReport]=useState<Row|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[selected,setSelected]=useState<number|null>(null),[view,setView]=useState<'map'|'stops'>('map');
 const sourceKey=JSON.stringify(sources[index].source);
 useEffect(()=>{const el=dialog.current!;el.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=overflow;el.close();};},[]);
 useEffect(()=>{const controller=new AbortController();setReport(null);setError('');setSelected(null);void api<Row>('/api/routing/itinerary',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os'},body:sourceKey,signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setReport(value);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[sourceKey,retry]);
 const time=(value:string|null)=>value?new Intl.DateTimeFormat('es-PY',{timeZone:report?.timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'Sin calcular';
 function selectStop(i:number,fromMap=false){setSelected(i);if(fromMap)list.current?.querySelector(`[data-stop="${i}"]`)?.scrollIntoView({block:'nearest'});}
 return <dialog ref={dialog} className="itinerary-dialog" aria-label="Recorrido del reparto" onCancel={e=>{e.preventDefault();onClose();}}>
  <header className="itinerary-header"><div><h2>Recorrido del reparto</h2>{sources.length>1?<label className="itinerary-truck"><span>Camión</span><select value={index} onChange={e=>setIndex(Number(e.target.value))}>{sources.map((s,i)=><option key={JSON.stringify(s.source)} value={i}>{s.label}</option>)}</select></label>:<p>{sources[0].label}</p>}</div><button type="button" className="button button-secondary" onClick={onClose} autoFocus>Cerrar mapa</button></header>
  <div className="itinerary-summary" aria-label="Resumen del recorrido"><div><span>Distancia total</span><strong>{km(report?.distanceMeters??null)}</strong></div><div><span>Duración estimada</span><strong>{duration(report?.totalSeconds??null)}</strong></div><div><span>Paradas</span><strong>{report?.stops.length??'—'}</strong></div><div><span>Chofer</span><strong>{report?.driverName??'—'}</strong></div></div>
  <nav className="itinerary-mobile-switch" aria-label="Vista del recorrido"><button type="button" aria-pressed={view==='map'} onClick={()=>setView('map')}>Mapa</button><button type="button" aria-pressed={view==='stops'} onClick={()=>setView('stops')}>Paradas y productos</button></nav>
  {error?<div className="itinerary-loading" role="alert"><p>{error}</p><button type="button" className="button button-secondary" onClick={()=>setRetry(n=>n+1)}>Reintentar recorrido</button></div>:!report?<div className="itinerary-loading" role="status">Trazando el recorrido por calles…</div>:<div className="itinerary-body" data-view={view}>
   <div className="itinerary-canvas"><Suspense fallback={<p role="status">Cargando mapa…</p>}><RouteItineraryMap report={report} selected={selected} onSelect={i=>selectStop(i,true)}/></Suspense>{!report.geometry&&<div className="itinerary-map-notice" role="status">Trazado no disponible. Revisá los avisos en Paradas.<button type="button" className="text-button" onClick={()=>setRetry(n=>n+1)}>Reintentar</button></div>}</div>
   <div className="itinerary-stops" ref={list} aria-label="Paradas en orden"><div className="itinerary-depot"><strong>Salida · {report.depot?.label??'Depósito sin ubicación'}</strong><small>{time(report.startAt)} · {report.depot?.address}</small></div>
    {report.warnings.map((warning:string)=><p className="itinerary-warning" key={warning}>{warning}</p>)}
    <ol>{report.stops.map((s:Row,i:number)=><li key={s.id??s.orderId} data-stop={i} className={selected===i?'is-selected':''}><button className="itinerary-stop" type="button" aria-pressed={selected===i} onClick={()=>{selectStop(i);setView('map');}}><span className="dispatch-stop-number">{i+1}</span><span><strong>{s.reference} · {s.recipientName}</strong><small>{s.destination}</small><small>{s.kind==='PICKUP'?'Retiro · ':''}{km(s.distanceMeters)} desde {i?'la parada anterior':'el depósito'}{s.arrivalAt?' · Llegada '+time(s.arrivalAt):''}</small></span></button>{!['EXACT','CONFIRMED'].includes(s.precision)&&<p className="itinerary-warning">{s.precision==='MISSING'?'Falta ubicar esta parada':'Ubicación aproximada · '+(s.label??s.destination)}</p>}<div className="dispatch-products">{s.lines.map((line:Row)=><span key={line.sku}><strong>{line.name} × {line.quantity}</strong><small>SKU: {line.sku}</small></span>)}</div>{s.instructions&&<p><strong>Indicaciones:</strong> {s.instructions}</p>}</li>)}</ol>
    <div className="itinerary-depot"><strong>Regreso al depósito</strong><small>{time(report.returnAt)}</small></div>
   </div>
  </div>}
  <footer className="itinerary-footer"><p>Estimación por calles, con atención en paradas y regreso al depósito. Sin tráfico en vivo; el GPS real sigue en Traccar.{footer&&sources.length>1?` La aprobación incluye los ${sources.length} camiones del lote.`:''}</p>{typeof footer==='function'?footer(onClose):footer}</footer>
 </dialog>;
}
