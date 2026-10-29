import './order-reservation-stock.css';

type Line = {productId:string;sku?:string;name?:string;productName?:string;quantity:number;available?:number};
export function reservationStock(lines:Line[]) {
  return lines.map(line => {
    const available=typeof line.available==='number'&&Number.isFinite(line.available)?Math.max(0,line.available):null;
    return {...line,available,missing:available===null?null:Math.max(0,line.quantity-available)};
  });
}

export default function OrderReservationStock({lines,busy,onRefresh,onReceive}:{lines:Line[];busy:boolean;onRefresh:()=>void;onReceive?:()=>void}) {
  const rows=reservationStock(lines),missing=rows.some(row=>(row.missing??0)>0),unknown=rows.some(row=>row.available===null);
  return <section className="reservation-stock" aria-label="Disponibilidad para reservar">
    <header><h3>{missing?'En espera de mercadería':unknown?'Consultar disponibilidad':'Stock completo para reservar'}</h3>
      <button type="button" className="text-button" disabled={busy} onClick={onRefresh}>Actualizar disponibilidad</button></header>
    {missing&&<p>El pedido espera completo. Recibí los faltantes antes de reservar.</p>}
    <div className="table-wrap"><table>
      <thead><tr><th>Producto / SKU</th><th>Pedido</th><th>Disponible</th><th>Falta</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.productId} className={(row.missing??0)>0?'reservation-stock-missing':undefined}>
        <td><strong>{row.productName||row.name||row.sku||'Producto'}</strong><small>SKU: {row.sku||'No informado'}</small></td>
        <td>{row.quantity}</td><td>{row.available??'—'}</td><td><strong>{row.missing??'—'}</strong></td>
      </tr>)}</tbody>
    </table></div>
    {missing&&onReceive&&<button type="button" className="button button-secondary" disabled={busy} onClick={onReceive}>Recibir mercadería de este cliente</button>}
  </section>;
}
