import type {Database,Row} from './database.ts';
import {DomainError} from './errors.ts';
/** The same resource booking rules apply to preparation, confirmation and departure. */
export async function routeConflicts(db:Database,orgId:string,route:Row,immediate=false){
 return db.all(`SELECT r.id,r.name,r.state,r.start_at,r.end_at,r.driver_id,r.vehicle_id,d.name AS driver_name,v.plate FROM routes r JOIN drivers d ON d.id=r.driver_id AND d.org_id=r.org_id JOIN vehicles v ON v.id=r.vehicle_id AND v.org_id=r.org_id WHERE r.org_id=? AND r.id<>? AND (r.state IN('READY','IN_PROGRESS') OR(r.state='DRAFT' AND EXISTS(SELECT 1 FROM route_assignments a WHERE a.org_id=r.org_id AND a.route_id=r.id AND a.active=1))) AND (r.driver_id=? OR r.vehicle_id=?) AND ((?=1 AND r.state='IN_PROGRESS') OR(r.start_at<? AND r.end_at>?)) ORDER BY r.start_at,r.id`,orgId,route.id,route.driver_id,route.vehicle_id,immediate?1:0,route.end_at,route.start_at);
}
export async function assertRouteAvailable(db:Database,orgId:string,route:Row,immediate=false){
 const conflicts=await routeConflicts(db,orgId,route,immediate);
 if(!conflicts.length)return;
 const message=conflicts.map(c=>{const driver=c.driver_id===route.driver_id,vehicle=c.vehicle_id===route.vehicle_id,subject=driver&&vehicle?`El chofer ${c.driver_name} y el vehículo ${c.plate}`:driver?`El chofer ${c.driver_name}`:`El vehículo ${c.plate}`;return `${subject} ya ${driver&&vehicle?'están asignados':'está asignado'} a la ruta «${c.name}»${c.state==='IN_PROGRESS'&&immediate?', que debe finalizar antes de esta salida':c.state==='DRAFT'?' en ese horario; ese reparto ya tiene bultos asignados':' en ese horario'}.`;}).join(' ');
 throw new DomainError('VERSION_CONFLICT',message,409,{conflicts:conflicts.map(c=>({id:c.id,name:c.name,state:c.state,startAt:c.start_at,endAt:c.end_at}))});
}
