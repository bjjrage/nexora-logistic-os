import {useEffect,useState} from 'react';
import {api} from './api';
import {PointEditor} from './RoutingPanel';
type Row=Record<string,any>;
export default function CompanyDepots({onManage}:{onManage?:()=>void}){
 const [data,setData]=useState<Row|null>(null),[error,setError]=useState('');
 async function refresh(){try{setData(await api<Row>('/api/routing/context'));setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void refresh();},[]);
 return <section className="card" aria-label="Depósitos de la empresa"><div className="card-header"><div><h2>Depósitos y salida de repartos</h2><p>Registrá la dirección y el punto del depósito una sola vez. Se comparte con Inventario y todos los repartos.</p></div>{onManage&&<button type="button" className="button button-secondary" onClick={onManage}>Administrar depósitos y sectores</button>}</div>
  {error&&<p role="alert" className="notice error">{error}</p>}
  {!data&&!error&&<p>Cargando depósitos…</p>}
  {data?.locations.map((location:Row)=>{const point=data.points.find((p:Row)=>p.kind==='LOCATION'&&p.id===location.id);return <article key={location.id} className="routing-route"><h3>{location.code} · {location.name}</h3><p>{point?point.address:'Ubicación pendiente de configurar'}</p><PointEditor kind="LOCATION" item={location} point={point} onSave={()=>void refresh()}/></article>;})}
  {data&&!data.locations.length&&<p>Primero creá el depósito donde recibís la mercadería con «Administrar depósitos y sectores».</p>}
 </section>;
}
