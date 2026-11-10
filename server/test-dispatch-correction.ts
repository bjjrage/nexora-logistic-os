import {z} from 'zod';
import type {Database,Row} from './database.ts';
import type {Actor} from './auth.ts';
import {Logistics} from './domain.ts';
import {ensure} from './errors.ts';
const schema=z.object({commandId:z.uuid(),expectedVersion:z.number().int().positive(),didNotDepart:z.literal(true),reason:z.string().trim().min(10).max(1000)}).strict();
/** Correct a test-only departure that the human explicitly says never happened. */
export async function correctTestDispatch(db:Database,actor:Actor,id:string,input:unknown){
 const body=schema.parse(input),domain=new Logistics(db);
 return domain.command(actor,`routes.${id}.correct-test-dispatch`,body,['ADMIN'],async()=>{
  ensure((await db.one('SELECT enabled FROM organization_test_mode WHERE org_id=?',actor.orgId))?.enabled===1,'FORBIDDEN','Esta corrección está disponible únicamente en modo de prueba.',403);
  const route=await domain.route(id,actor,body.expectedVersion);ensure(route.state==='IN_PROGRESS','INVALID_TRANSITION','La ruta no tiene una salida de prueba en curso.');
  ensure(route.is_test===1,'FORBIDDEN','Solo se puede corregir el despacho de una ruta marcada como prueba.',403);
  ensure(!await db.one("SELECT id FROM stops WHERE org_id=? AND route_id=? AND state<>'PENDING'",actor.orgId,id)&&!await db.one('SELECT t.id FROM attempts t JOIN stops s ON s.id=t.stop_id AND s.org_id=t.org_id WHERE s.org_id=? AND s.route_id=? LIMIT 1',actor.orgId,id),'INVALID_TRANSITION','Hay visitas o entregas registradas. No se puede deshacer esta salida.');
  const events=await db.all('SELECT i.response FROM idempotency i JOIN audit a ON a.org_id=i.org_id AND a.command_id=i.command_id WHERE i.org_id=? AND i.operation=? ORDER BY a.created_at DESC,a.rowid DESC',actor.orgId,`routes.${id}.dispatch`),source=events.map(e=>JSON.parse(e.response)).find((r:Row)=>r.version===route.version);
  ensure(source,'VERSION_CONFLICT','La ruta cambió después de salir. Revisá su historial antes de corregirla.');
  const parcels=await db.all('SELECT p.*,a.pickup FROM route_assignments a JOIN parcels p ON p.id=a.parcel_id AND p.org_id=a.org_id WHERE a.org_id=? AND a.route_id=? AND a.active=1',actor.orgId,id);
  ensure(parcels.length&&parcels.every(p=>!p.pickup&&p.state==='IN_TRANSIT'&&p.custody_type==='VEHICLE'&&p.custody_id===route.vehicle_id),'INVALID_TRANSITION','La custodia cambió o hay retiros; no se puede deshacer esta salida automáticamente.');
  for(const parcel of parcels)await domain.move(parcel,actor,'LOADED','VEHICLE',route.vehicle_id,'TEST_DISPATCH_CORRECTED',body.commandId);
  const orders=await db.all('SELECT DISTINCT op.order_id FROM inventory_order_parcels op JOIN route_assignments a ON a.parcel_id=op.parcel_id AND a.org_id=op.org_id WHERE a.org_id=? AND a.route_id=? AND a.active=1',actor.orgId,id);
  for(const order of orders){ensure(!await db.one("SELECT p.id FROM inventory_order_parcels op JOIN parcels p ON p.id=op.parcel_id AND p.org_id=op.org_id WHERE op.org_id=? AND op.order_id=? AND p.state<>'LOADED'",actor.orgId,order.order_id),'INVALID_TRANSITION','Un pedido tiene bultos fuera de esta corrección.');await db.run("UPDATE inventory_orders SET status='LOADED',updated_at=? WHERE org_id=? AND id=?",new Date().toISOString(),actor.orgId,order.order_id);}
  const startAt=source.previousStartAt??route.start_at,endAt=source.previousEndAt??route.end_at;
  await db.run("UPDATE routes SET state='DRAFT',start_at=?,end_at=?,version=version+1 WHERE org_id=? AND id=?",startAt,endAt,actor.orgId,id);
  return {id,state:'DRAFT',version:route.version+1,startAt,endAt,loadedPreserved:parcels.length,reason:body.reason};
 });
}
