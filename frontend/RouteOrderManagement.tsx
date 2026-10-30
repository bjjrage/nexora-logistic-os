import {useEffect,useState} from 'react';
import {api} from './api';
import OrderCorrections from './OrderCorrections';
type Row=Record<string,any>;
export default function RouteOrderManagement({routeId,revision,onChanged,onOrganize}:{routeId:string;revision:unknown;onChanged:()=>Promise<void>;onOrganize:()=>void}){
 const [route,setRoute]=useState<Row|null>(null),[error,setError]=useState(''),[supported,setSupported]=useState(false),[working,setWorking]=useState(false),[feedback,setFeedback]=useState('');
 useEffect(()=>{let active=true;void api<Row>('/api/routing/queue').then(b=>{if(active){setRoute((b.routes??[]).find((r:Row)=>r.id===routeId)??null);setSupported(!!b.features?.batchCorrections);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[routeId,revision]);
 const orders=route?.orders.filter((o:Row)=>o.status)??[];
 return <section className="route-order-management" aria-label="Gestionar reservas de este camión"><h3>Pedidos de este camión</h3><p className="muted">Quitar del reparto conserva la reserva. Desreservar devuelve el pedido completo al stock disponible.</p>{feedback&&<p role="status" className="notice success">{feedback}</p>}{error&&<p role="alert" className="notice error">{error}</p>}{orders.map((order:Row)=><div className="route-order-action" key={order.id}><div><strong>{order.reference} · {order.recipientName}</strong><small>{order.units} bultos · {order.loaded} en vehículo · {order.pendingLoad} por cargar</small></div><OrderCorrections orders={[{...order,id:order.id}]} allowRequeue disabled={working||!supported} onWorking={setWorking} onSuccess={setFeedback} onChanged={onChanged} onError={setError}/></div>)}{!orders.length&&<p>No hay pedidos de inventario asignados a este camión. <button type="button" className="button button-primary" onClick={onOrganize}>Volver a organizar pedidos</button></p>}</section>;
}
