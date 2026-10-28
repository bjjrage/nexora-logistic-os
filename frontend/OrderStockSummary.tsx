type Line = {productId:string;productName?:string;name?:string;sku?:string;quantity:number;available?:number;reserved?:number;loaded?:number;delivered?:number;returned?:number};
type Parcel = {productId:string;state:string};
type Props = {lines:Line[];parcels?:Parcel[];productName:(productId:string)=>string|undefined};

export default function OrderStockSummary({lines,parcels,productName}:Props){
  return <div className="order-stock-summary" aria-label="Artículos y cantidades del pedido">{lines.map(line=>{
    const units=parcels?.filter(parcel=>parcel.productId===line.productId);
    const count=(state:string)=>units?.filter(parcel=>parcel.state===state).length;
    const reserved=count('RESERVED')??(line.reserved===undefined?undefined:Math.max(0,line.reserved-(line.loaded??0)));
    const vehicle=count('VEHICLE')??(line.loaded===undefined?undefined:Math.max(0,line.loaded-(line.delivered??0)-(line.returned??0)));
    const delivered=count('DELIVERED')??line.delivered;
    const returned=units?.filter(parcel=>['QUARANTINE','RELEASED'].includes(parcel.state)).length??line.returned;
    const metrics:[string,number|undefined,string][]=[
      ['Pedido',line.quantity,'requested'],['Disponible para reservar',line.available,'available'],
      ['Reservado en depósito',reserved,'reserved'],['Cargado en vehículo',vehicle,'vehicle'],
    ];
    if(delivered)metrics.push(['Entregado',delivered,'delivered']);
    if(returned)metrics.push(['Retornado',returned,'returned']);
    return <section className="order-stock-product" key={line.productId} aria-label={line.productName||line.name||productName(line.productId)||line.sku||'Producto'}>
      <h4>{line.productName||line.name||productName(line.productId)||line.sku||'Producto'}</h4>
      <dl className="order-stock-quantities">{metrics.map(([label,value,kind])=><div key={kind} className={'order-stock-metric order-stock-metric--'+kind}><dt>{label}</dt><dd>{value??'—'}<small>{value===1?'unidad':'unidades'}</small></dd></div>)}</dl>
    </section>;
  })}</div>;
}
