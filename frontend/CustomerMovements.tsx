import {useEffect,useState} from 'react';
import {api} from './api';

type Movement = {id:string;createdAt:string;action:string;productName:string;sku:string;serial?:string;quantity:number;fromLocationCode?:string;toLocationCode?:string;reference?:string};
const labels:Record<string,string> = {RECEIVE:'Ingreso',MOVE:'Traslado',ADJUST:'Ajuste',RESERVE:'Reserva',RELEASE:'Liberación',LOAD:'Carga',UNLOAD:'Descarga',DELIVER:'Entrega',RETURN:'Devolución'};

export default function CustomerMovements({revision}:{revision:number}) {
  const [items,setItems] = useState<Movement[]>([]);
  const [total,setTotal] = useState(0);
  const [page,setPage] = useState(0);
  const [search,setSearch] = useState('');
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    const controller = new AbortController();
    setLoading(true);setError('');
    const timer = setTimeout(()=>{
      void api<{items:Movement[];total:number}>('/api/inventory/movements?'+new URLSearchParams({limit:'25',offset:String(page*25),q:search}),{signal:controller.signal})
        .then(result=>{if(!controller.signal.aborted){setItems(result.items);setTotal(result.total);}})
        .catch(caught=>{if(!controller.signal.aborted){setItems([]);setError(caught instanceof Error?caught.message:'No se pudieron consultar los movimientos.');}})
        .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },200);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[page,search,revision]);

  return <section className="card" aria-labelledby="customer-movements-title">
    <div className="card-header"><div><h2 id="customer-movements-title">Historial de movimientos</h2><p>Ingresos, salidas y cambios registrados sobre tu mercadería.</p></div></div>
    <label className="field"><span>Buscar en tus movimientos</span><input value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}} placeholder="SKU, producto, serie o referencia"/></label>
    {error&&<p className="notice error" role="alert">{error}</p>}
    {loading&&<p className="muted" role="status">Consultando movimientos…</p>}
    <nav className="pagination" aria-label="Páginas de movimientos">
      <button type="button" disabled={loading||page===0} onClick={()=>setPage(current=>current-1)}>Anterior</button>
      <span>Página {page+1} · {total} registros</span>
      <button type="button" disabled={loading||(page+1)*25>=total} onClick={()=>setPage(current=>current+1)}>Siguiente</button>
    </nav>
    <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Producto / serie</th><th>Cantidad</th><th>Ubicación</th><th>Referencia</th></tr></thead><tbody>
      {items.map(item=><tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('es')}</td><td>{labels[item.action]??item.action}</td><td><strong>{item.productName}</strong><small>{item.sku}{item.serial?' · '+item.serial:''}</small></td><td>{item.quantity}</td><td>{item.fromLocationCode??'—'} → {item.toLocationCode??'—'}</td><td>{item.reference||'—'}</td></tr>)}
    </tbody></table></div>
    {!items.length&&!loading&&!error&&<p className="empty-state">No hay movimientos para esta búsqueda.</p>}
  </section>;
}
