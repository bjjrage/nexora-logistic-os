import {useState} from 'react';

type Parcel={id:string;code:string;shipmentId:string;product?:{name:string;sku:string;serial?:string|null}|null};
type Props={
  route:{id:string;version:number};
  parcels:Parcel[];
  shipments:{id:string;reference:string;recipientName:string}[];
  mode:'unload'|'unassign';
  busy:boolean;
  action:(path:string,payload:Record<string,unknown>,message:string)=>Promise<boolean>;
};

export default function RouteParcelActions({route,parcels,shipments,mode,busy,action}:Props){
  const [selected,setSelected]=useState<string[]>([]);
  const ids=new Set(parcels.map(parcel=>parcel.id));
  const selectedIds=selected.filter(id=>ids.has(id));
  const unloading=mode==='unload';
  const toggle=(items:string[])=>setSelected(current=>items.every(id=>current.includes(id))?current.filter(id=>ids.has(id)&&!items.includes(id)):[...new Set([...current.filter(id=>ids.has(id)),...items])].slice(0,200));
  const confirm=async(parcelIds:string[])=>{
    const question=unloading?`¿Confirmás que bajaste estos ${parcelIds.length} bultos del vehículo al depósito? Siguen reservados para el pedido y asignados a esta ruta.`:`¿Quitar estos ${parcelIds.length} bultos de la ruta? Siguen reservados para el pedido y podés asignarlos a otra ruta.`;
    if(!window.confirm(question))return;
    if(await action('/api/routes/'+encodeURIComponent(route.id)+'/'+mode+'-selected',{expectedVersion:route.version,parcelIds},unloading?'Artículos bajados al depósito. Siguen reservados; revisá la carga antes de confirmar la ruta.':'Artículos quitados de la ruta. La reserva del pedido se mantiene.'))setSelected(current=>current.filter(id=>!parcelIds.includes(id)));
  };
  const groups=new Map<string,Parcel[]>();
  for(const parcel of parcels){const group=groups.get(parcel.shipmentId)??[];group.push(parcel);groups.set(parcel.shipmentId,group);}
  return <section className="stack" aria-label={unloading?'Artículos en el vehículo':'Artículos asignados sin cargar'}>
    <h3>{unloading?'Bajar artículos al depósito':'Quitar artículos sin cargar'}</h3>
    <p>{unloading?'Esta lista muestra únicamente los artículos que están cargados en este vehículo. Marcá los que bajaste físicamente.':'Quitar de la ruta cambia la asignación. El artículo sigue en depósito y reservado para su pedido.'}</p>
    {parcels.length>0?<>
      <div className="route-bulk-actions" role="region" aria-label="Gestionar varios bultos">
        <div className="button-row"><button type="button" className="button button-secondary" disabled={busy} onClick={()=>toggle(parcels.slice(0,200).map(parcel=>parcel.id))}>{parcels.slice(0,200).every(parcel=>selectedIds.includes(parcel.id))?'Quitar selección':'Seleccionar todos'}</button><span role="status">{selectedIds.length} seleccionados</span></div>
        <button type="button" className="button button-primary" disabled={busy||!selectedIds.length} onClick={()=>void confirm(selectedIds)}>{unloading?'Bajar al depósito':'Quitar de la ruta'} ({selectedIds.length})</button>
        {parcels.length>200&&<small>Podés procesar hasta 200 bultos por operación.</small>}
      </div>
      {[...groups].map(([shipmentId,items])=>{
        const shipment=shipments.find(item=>item.id===shipmentId);
        return <div className="route-cargo-group" key={shipmentId}>
          <strong>{shipment?.reference??'Envío'} · {shipment?.recipientName??'Destinatario no informado'}</strong>
          {items.length>1&&<button type="button" className="text-button" disabled={busy} onClick={()=>toggle(items.map(parcel=>parcel.id))}>{items.every(parcel=>selectedIds.includes(parcel.id))?'Quitar selección del pedido':'Seleccionar este pedido'}</button>}
          {items.map((parcel,index)=><div className="row route-correction-row" key={parcel.id}>
            <label className="checkbox-field"><input type="checkbox" checked={selectedIds.includes(parcel.id)} disabled={busy||!selectedIds.includes(parcel.id)&&selectedIds.length>=200} onChange={()=>toggle([parcel.id])}/><span>{parcel.product?.name??'Bulto'} · unidad {index+1}{parcel.product?.serial?` · Serie: ${parcel.product.serial}`:''}<small>Código: {parcel.code}</small></span></label>
            <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void confirm([parcel.id])}>{unloading?'Bajar al depósito':'Quitar de la ruta'}</button>
          </div>)}
        </div>;
      })}
    </>:<p className="muted">{unloading?'No hay artículos cargados en este vehículo. Los artículos reservados en depósito aparecen en Cargar artículos.':'No hay artículos sin cargar para quitar de esta ruta.'}</p>}
  </section>;
}
