import { useEffect, useState } from 'react';

type Parcel = {id:string;code:string;shipmentId:string;state:string;custodyType:string;custodyId:string|null;product?:{name:string;sku:string;serial?:string|null}|null};
type Shipment = {id:string;reference:string;recipientName:string};
type Props = {
  route:{id:string;vehicleId:string;version:number;state:string};
  parcels:Parcel[];
  shipments:Shipment[];
  busy:boolean;
  action:(path:string,payload:Record<string,unknown>,message:string)=>Promise<boolean>;
};

export default function RouteLoadPanel({route,parcels,shipments,busy,action}:Props){
  const [selected,setSelected]=useState<string[]>([]);
  const pending=parcels.filter(p=>['RECEIVED','RETURNED_TO_DEPOT'].includes(p.state)&&p.custodyType==='DEPOT');
  const loaded=parcels.filter(p=>p.state==='LOADED'&&p.custodyType==='VEHICLE'&&p.custodyId===route.vehicleId);
  const selectedPending=pending.filter(p=>selected.includes(p.id));
  useEffect(()=>setSelected([]),[route.id]);
  const confirm=async()=>{
    if(!selectedPending.length)return;
    if(await action('/api/routes/'+route.id+'/load-selected',{expectedVersion:route.version,parcelIds:selectedPending.map(p=>p.id)},'Carga registrada en la ruta. El pedido y el stock se actualizaron.'))setSelected([]);
  };
  return <section className="stack" aria-label="Carga del vehículo">
    <h3>Carga del vehículo</h3>
    <p role="status"><strong>Cargados {loaded.length} de {parcels.length} bultos.</strong>{pending.length>0?' Falta cargar '+pending.length+'.':''}</p>
    {pending.length>0&&<>
      <p>Marcá cada artículo cuando lo subas al vehículo y confirmá la carga aquí.</p>
      <button type="button" className="text-button" disabled={busy} onClick={()=>setSelected(selectedPending.length===Math.min(pending.length,200)?[]:pending.slice(0,200).map(p=>p.id))}>{selectedPending.length===Math.min(pending.length,200)?'Quitar selección':'Seleccionar pendientes'}</button>
    </>}
    <div className="parcel-picker">{pending.map(parcel=>{
      const shipment=shipments.find(s=>s.id===parcel.shipmentId);
      const isLoaded=loaded.some(p=>p.id===parcel.id),canLoad=pending.some(p=>p.id===parcel.id);
      const unit=parcels.filter(p=>p.shipmentId===parcel.shipmentId).findIndex(p=>p.id===parcel.id)+1;
      return <label className="parcel-row" key={parcel.id}><input type="checkbox" disabled={busy||!canLoad||!selected.includes(parcel.id)&&selectedPending.length>=200} checked={isLoaded||selected.includes(parcel.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,parcel.id]:ids.filter(id=>id!==parcel.id))}/><span><strong>{parcel.product?.name||'Bulto'} · unidad {unit}</strong><small>{shipment?.recipientName||'Destinatario no informado'} · {shipment?.reference||'Envío'}</small>{parcel.product?.serial&&<small>Serie: {parcel.product.serial}</small>}<small>{isLoaded?'Cargado en este vehículo':canLoad?'En depósito · pendiente de carga':'No disponible para cargar'} · Código: {parcel.code}</small></span></label>;
    })}</div>
    {pending.length>200&&<p className="muted">Podés confirmar hasta 200 bultos por operación.</p>}
    {pending.length>0&&<button type="button" className="button button-primary" disabled={busy||!selectedPending.length} onClick={()=>void confirm()}>Confirmar carga</button>}
    {parcels.length>0&&loaded.length===parcels.length&&<p className="notice success">{route.state==='DRAFT'?'Carga completa. Revisá las paradas y confirmá la ruta con el botón de arriba.':'Carga completa y ruta confirmada. Continuá con el control de salida.'} Para bajar un artículo, abrí Bajar artículos.</p>}
    {!parcels.length&&<p className="muted">Esta ruta no tiene bultos que deban cargarse en depósito.</p>}
  </section>;
}
