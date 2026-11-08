import {useEffect,useId,useState} from 'react';
import {ArrowRight,Warehouse} from 'lucide-react';
import {api} from './api';
import HelpTip from './HelpTip';
import './client-locations.css';

export type ClientLocation={id:string;name:string;code:string;kind:string;address?:string|null;quantity:number;available:number;reserved:number;quarantine:number;vehicle:number};

export default function ClientLocations({clientId,revision=0,onSelect}:{clientId?:string;revision?:number;onSelect?:(location:ClientLocation)=>void}) {
  const titleId=useId();
  const [items,setItems]=useState<ClientLocation[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    const query=new URLSearchParams({limit:'6',offset:String(page*6)});
    if(clientId)query.set('clientId',clientId);
    void api<{items:ClientLocation[];total:number}>('/api/inventory/locations/stock?'+query,{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted){setItems(result.items);setTotal(result.total);}})
      .catch(caught=>{if(!controller.signal.aborted){setItems([]);setTotal(0);setError(caught instanceof Error?caught.message:'No se pudieron consultar los depósitos.');}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[clientId,revision,page]);
  const quantity=(value:number)=>new Intl.NumberFormat('es').format(value);
  return <section className="card" aria-labelledby={titleId} aria-busy={loading}>
    <div className="card-header"><div className="help-label"><h2 id={titleId}>Depósitos y ubicaciones</h2><HelpTip label="Stock por depósito">En depósito suma disponibles, reservadas y cuarentena. En vehículo indica la ubicación de salida.</HelpTip></div><span className="badge badge-neutral">{total}</span></div>
    {error&&<div className="notice error" role="alert">{error}</div>}
    {loading&&<p className="muted" role="status">Consultando depósitos…</p>}
    <div className="client-locations">{items.map(location=><article className="client-location" key={location.id} aria-label={location.name}>
      <Warehouse className="client-location-icon" aria-hidden="true"/>
      <div className="client-location-name"><strong>{location.name}</strong><small>{location.code} · {location.kind==='DEPOT'?'Depósito':location.kind==='QUARANTINE'?'Cuarentena':'Sector'}</small>{location.address&&<small>{location.address}</small>}</div>
      <div className="client-location-quantities"><span><strong>{quantity(location.quantity)}</strong><small>En depósito</small></span>{location.vehicle>0&&<span><strong>{quantity(location.vehicle)}</strong><small>En vehículo</small></span>}</div>
      {onSelect&&<button type="button" className="text-button" aria-label={'Ver existencias en '+location.name} onClick={()=>onSelect(location)}><ArrowRight aria-hidden="true"/></button>}
    </article>)}</div>
    {!items.length&&!loading&&!error&&<p className="empty-state">Sin mercadería en depósito.</p>}
    {total>6&&<nav className="pagination" aria-label="Páginas de depósitos"><button type="button" className="button button-secondary" disabled={loading||page===0} onClick={()=>setPage(current=>current-1)}>Anterior</button><span>{page+1} / {Math.ceil(total/6)}</span><button type="button" className="button button-secondary" disabled={loading||(page+1)*6>=total} onClick={()=>setPage(current=>current+1)}>Siguiente</button></nav>}
  </section>;
}
