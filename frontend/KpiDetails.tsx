import { ArrowUpRight, X } from 'lucide-react';

export type KpiKind = 'shipments' | 'parcels' | 'routes' | 'incidents';
type Item = { id: string };
type DetailData = {
  shipments: (Item & {reference:string;clientId:string;counts:{expected:number;pending:number}})[];
  clients: (Item & {name:string})[];
  parcels: (Item & {code:string;shipmentId:string;state:string;custodyType:string})[];
  routes: (Item & {name:string;state:string;driverId:string})[];
  drivers: (Item & {name:string})[];
  incidents: (Item & {parcelId:string;routeId:string;state:string;reasonCode:string;nextAction:string})[];
};
const titles:Record<KpiKind,string> = {shipments:'Envíos registrados',parcels:'Bultos en operación',routes:'Rutas abiertas',incidents:'Incidencias abiertas'};

export default function KpiDetails({kind,data,onClose,go,stateLabel,isFinalParcel,isClosed}: {
  kind:KpiKind; data:DetailData; onClose:()=>void;
  go:(page:'shipments'|'routes',recordId?:string)=>void;
  stateLabel:(value:string)=>string; isFinalParcel:(state:string)=>boolean; isClosed:(state:string)=>boolean;
}) {
  const parcels=data.parcels.filter(parcel=>!isFinalParcel(parcel.state));
  const routes=data.routes.filter(route=>!isClosed(route.state));
  const incidents=data.incidents.filter(incident=>!isClosed(incident.state));
  const count={shipments:data.shipments.length,parcels:parcels.length,routes:routes.length,incidents:incidents.length}[kind];
  const open=(page:'shipments'|'routes',id:string)=><button className="text-button" onClick={()=>go(page,id)}>Abrir {page==='shipments'?'envío':'ruta'}<ArrowUpRight aria-hidden="true" /></button>;
  return <section className="kpi-details card" id="kpi-details" aria-labelledby="kpi-details-title">
    <div className="card-header"><div><h2 id="kpi-details-title">{titles[kind]} <span className="badge badge-neutral">{count}</span></h2><p>Registros que componen este indicador en la vista cargada.</p></div><button className="text-button" onClick={onClose}><X aria-hidden="true" />Cerrar detalle</button></div>
    {count===0 ? <div className="empty-state">No hay {titles[kind].toLowerCase()} en esta vista.</div> : <div className="table-wrap"><table>
      {kind==='shipments' && <><thead><tr><th>Referencia</th><th>Cliente</th><th>Bultos</th><th>Pendientes</th><th>Acción</th></tr></thead><tbody>{data.shipments.map(shipment=><tr key={shipment.id}><td><strong>{shipment.reference}</strong></td><td>{data.clients.find(client=>client.id===shipment.clientId)?.name??'Cliente'}</td><td>{shipment.counts.expected}</td><td>{shipment.counts.pending}</td><td>{open('shipments',shipment.id)}</td></tr>)}</tbody></>}
      {kind==='parcels' && <><thead><tr><th>Bulto</th><th>Envío</th><th>Estado</th><th>Custodia</th><th>Acción</th></tr></thead><tbody>{parcels.map(parcel=><tr key={parcel.id}><td><strong>{parcel.code}</strong></td><td>{data.shipments.find(shipment=>shipment.id===parcel.shipmentId)?.reference??'Envío'}</td><td>{stateLabel(parcel.state)}</td><td>{stateLabel(parcel.custodyType)}</td><td>{open('shipments',parcel.shipmentId)}</td></tr>)}</tbody></>}
      {kind==='routes' && <><thead><tr><th>Ruta</th><th>Chofer</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{routes.map(route=><tr key={route.id}><td><strong>{route.name}</strong></td><td>{data.drivers.find(driver=>driver.id===route.driverId)?.name??'Chofer'}</td><td>{stateLabel(route.state)}</td><td>{open('routes',route.id)}</td></tr>)}</tbody></>}
      {kind==='incidents' && <><thead><tr><th>Bulto</th><th>Motivo</th><th>Próxima acción</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{incidents.map(incident=><tr key={incident.id}><td><strong>{data.parcels.find(parcel=>parcel.id===incident.parcelId)?.code??'Bulto'}</strong></td><td>{stateLabel(incident.reasonCode)}</td><td>{incident.nextAction}</td><td>{stateLabel(incident.state)}</td><td>{open('routes',incident.routeId)}</td></tr>)}</tbody></>}
    </table></div>}
  </section>;
}
