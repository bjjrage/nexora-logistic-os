import type {Database,Row} from './database.ts';
import type {Actor} from './auth.ts';
import {latestParcelAssignment} from './driver-access.ts';

/** Relations for one already-authorized route. Global listing limits must never truncate its operation. */
export async function routeCollections(db:Database,actor:Actor,route:Row):Promise<Record<string,Row[]>>{
 const own=actor.role==='DRIVER'?` AND ${latestParcelAssignment}`:'';
 const parcelScope=`SELECT a.parcel_id FROM route_assignments a WHERE a.org_id=? AND a.route_id=?${own}`;
 const parcels=await db.all(`SELECT p.* FROM parcels p WHERE p.org_id=? AND p.id IN(${parcelScope}) ORDER BY p.rowid DESC`,actor.orgId,actor.orgId,route.id);
 const shipmentScope=`SELECT p.shipment_id FROM parcels p WHERE p.org_id=? AND p.id IN(${parcelScope})`;
 const related=(table:string,field:string)=>db.all(`SELECT * FROM ${table} WHERE org_id=? AND ${field}=? ORDER BY rowid DESC`,actor.orgId,route.id);
 const vehicle=(table:string)=>db.all(`SELECT * FROM ${table} WHERE org_id=? AND vehicle_id=? ORDER BY rowid DESC`,actor.orgId,route.vehicle_id);
 const values=await Promise.all([
  db.all(`SELECT * FROM shipments WHERE org_id=? AND id IN(${shipmentScope}) ORDER BY rowid DESC`,actor.orgId,actor.orgId,actor.orgId,route.id),
  db.all(`SELECT * FROM clients WHERE org_id=? AND id IN(SELECT client_id FROM shipments WHERE org_id=? AND id IN(${shipmentScope})) ORDER BY rowid DESC`,actor.orgId,actor.orgId,actor.orgId,actor.orgId,route.id),
  db.all('SELECT * FROM drivers WHERE org_id=? AND id=?',actor.orgId,route.driver_id),
  db.all('SELECT * FROM vehicles WHERE org_id=? AND id=?',actor.orgId,route.vehicle_id),
  related('stops','route_id'),db.all(`SELECT a.* FROM route_assignments a WHERE a.org_id=? AND a.route_id=?${own} ORDER BY a.rowid DESC`,actor.orgId,route.id),related('incidents','route_id'),related('returns','route_id'),
  vehicle('defects'),vehicle('vehicle_documents'),vehicle('inspections'),vehicle('maintenance'),
  db.all('SELECT * FROM driver_documents WHERE org_id=? AND driver_id=? ORDER BY rowid DESC',actor.orgId,route.driver_id),
  db.all('SELECT * FROM attempts WHERE org_id=? AND stop_id IN(SELECT id FROM stops WHERE org_id=? AND route_id=?) ORDER BY rowid DESC',actor.orgId,actor.orgId,route.id),
  db.all(`SELECT * FROM custody_events WHERE org_id=? AND parcel_id IN(${parcelScope}) ORDER BY rowid DESC`,actor.orgId,actor.orgId,route.id),
  db.all('SELECT * FROM audit WHERE org_id=? AND entity_id=? ORDER BY rowid DESC LIMIT 500',actor.orgId,route.id)
 ]);
 const keys=['shipments','clients','drivers','vehicles','stops','route_assignments','incidents','returns','defects','vehicle_documents','inspections','maintenance','driver_documents','attempts','custody_events','audit'];
 return {...Object.fromEntries(keys.map((key,index)=>[key,values[index]])),routes:[route],parcels};
}
