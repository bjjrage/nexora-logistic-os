import {useEffect,useState} from 'react';
import {api} from './api';
import {Search} from 'lucide-react';
import HelpTip from './HelpTip';
import {movementLabels} from './customer-labels';

type Movement = {id:string;createdAt:string;action:string;productName:string;sku:string;serial?:string;quantity:number;fromLocationCode?:string;toLocationCode?:string;fromLocationName?:string;toLocationName?:string;reference?:string};

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
    <div className="card-header"><div className="help-label"><h2 id="customer-movements-title">Historial</h2><HelpTip label="Historial de movimientos">Ingresos, salidas y cambios registrados sobre tu mercadería.</HelpTip></div><span className="badge badge-neutral">{total} registros</span></div>
    <div className="customer-table-tools"><div className="search-field"><Search aria-hidden="true"/><input aria-label="Buscar en tus movimientos" value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}} placeholder="SKU, producto, serie, depósito o referencia"/></div></div>
    {error&&<p className="notice error" role="alert">{error}</p>}
    {loading&&<p className="muted" role="status">Consultando movimientos…</p>}
    <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Producto / serie</th><th>Cantidad</th><th>Origen → destino</th><th>Referencia</th></tr></thead><tbody>
      {items.map(item=><tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('es')}</td><td><span className="badge badge-neutral">{movementLabels[item.action]??item.action}</span></td><td><strong>{item.productName}</strong><small>{item.sku}{item.serial?' · '+item.serial:''}</small></td><td>{item.quantity}</td><td><strong>{item.fromLocationName??item.fromLocationCode??'—'} → {item.toLocationName??item.toLocationCode??'—'}</strong><small>{item.fromLocationCode??'—'} → {item.toLocationCode??'—'}</small></td><td>{item.reference||'—'}</td></tr>)}
    </tbody></table></div>
    {!items.length&&!loading&&!error&&<p className="empty-state">No hay movimientos para esta búsqueda.</p>}
    <nav className="pagination" aria-label="Páginas de movimientos"><button type="button" className="button button-secondary" disabled={loading||page===0} onClick={()=>setPage(current=>current-1)}>Anterior</button><span>{page+1} / {Math.max(1,Math.ceil(total/25))}</span><button type="button" className="button button-secondary" disabled={loading||(page+1)*25>=total} onClick={()=>setPage(current=>current+1)}>Siguiente</button></nav>
  </section>;
}
