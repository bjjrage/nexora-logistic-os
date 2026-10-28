import type {Database,Row} from './database.ts';
import {ensure} from './errors.ts';

export async function verifyVehicleCapacity(store:Database,orgId:string,vehicleId:string,additional:Row[]=[]){
 const vehicle=await store.one('SELECT * FROM vehicles WHERE id=? AND org_id=?',vehicleId,orgId);
 ensure(vehicle,'NOT_FOUND','Vehículo no encontrado.',404);
 const actual=await store.all("SELECT * FROM parcels WHERE org_id=? AND custody_type='VEHICLE' AND custody_id=?",orgId,vehicleId);
 const load=[...new Map([...actual,...additional].map(parcel=>[parcel.id,parcel])).values()];
 ensure(load.reduce((sum,p)=>sum+(p.weight_grams ?? 0),0)<=vehicle.capacity_weight_grams&&load.reduce((sum,p)=>sum+(p.volume_cm3 ?? 0),0)<=vehicle.capacity_volume_cm3,'CAPACITY_EXCEEDED','La carga real excede la capacidad, incluidos bultos de otras rutas y entregas fallidas a bordo.');
}
