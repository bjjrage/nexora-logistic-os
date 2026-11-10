import {z} from 'zod';
import {authorize,type Actor} from './auth.ts';
import type {Database} from './database.ts';
import {Logistics} from './domain.ts';
import {ensure} from './errors.ts';

const totals=z.object({products:z.number().int().nonnegative(),orders:z.number().int().nonnegative(),shipments:z.number().int().nonnegative(),stockUnits:z.number().int().nonnegative()}).strict();
const confirmation=z.object({commandId:z.uuid(),expectedName:z.string().min(1).max(500),expectedTotals:totals}).strict();

export async function clientRemovalPreview(store:Database,actor:Actor,clientId:string){
 authorize(actor,['ADMIN']);
 const row=await store.one(`
  SELECT c.id,c.name,
   (SELECT COUNT(*) FROM inventory_products p WHERE p.org_id=c.org_id AND p.client_id=c.id) AS products,
   (SELECT COUNT(*) FROM inventory_orders o WHERE o.org_id=c.org_id AND o.client_id=c.id) AS orders,
   (SELECT COUNT(*) FROM shipments s WHERE s.org_id=c.org_id AND s.client_id=c.id) AS shipments,
   (SELECT COALESCE(SUM(b.quantity),0) FROM inventory_balances b WHERE b.org_id=c.org_id AND b.client_id=c.id)
   + (SELECT COUNT(*) FROM inventory_units u WHERE u.org_id=c.org_id AND u.client_id=c.id
      AND u.status IN ('AVAILABLE','RESERVED','QUARANTINE','VEHICLE')) AS stock_units,
   (SELECT COUNT(*) FROM parcels p JOIN shipments s ON s.org_id=p.org_id AND s.id=p.shipment_id
    WHERE s.org_id=c.org_id AND s.client_id=c.id AND (
     p.custody_type='VEHICLE' OR p.state IN ('LOADED','IN_TRANSIT','RETURN_PENDING') OR EXISTS (
      SELECT 1 FROM route_assignments a JOIN routes r ON r.org_id=a.org_id AND r.id=a.route_id
      WHERE a.org_id=p.org_id AND a.parcel_id=p.id AND a.active=1 AND r.state='IN_PROGRESS'
     )
    )) AS road_parcels,
   EXISTS (
    SELECT 1 FROM shipments s JOIN stops t ON t.org_id=s.org_id AND t.shipment_id=s.id
    JOIN routes r ON r.org_id=t.org_id AND r.id=t.route_id
    WHERE s.org_id=c.org_id AND s.client_id=c.id AND r.state='IN_PROGRESS' AND t.state IN ('PENDING','PARTIAL')
   ) AS pending_stop,
   (EXISTS (
    SELECT 1 FROM inventory_balances b WHERE b.org_id=c.org_id AND b.client_id=c.id AND b.status='VEHICLE' AND b.quantity>0
   ) OR EXISTS (
    SELECT 1 FROM inventory_units u WHERE u.org_id=c.org_id AND u.client_id=c.id AND u.status='VEHICLE'
   )) AS vehicle_stock
  FROM clients c WHERE c.org_id=? AND c.id=?
 `,actor.orgId,z.uuid().parse(clientId));
 ensure(row,'NOT_FOUND','Cliente no encontrado.',404);
 return {
  id:String(row.id),name:String(row.name),
  totals:{products:Number(row.products),orders:Number(row.orders),shipments:Number(row.shipments),stockUnits:Number(row.stock_units)},
  roadParcels:Number(row.road_parcels),blocked:Boolean(Number(row.road_parcels)||row.pending_stop||row.vehicle_stock),
 };
}

const inTransit='El cliente tiene mercadería cargada o en reparto. Terminá el reparto o devolvé la mercadería al depósito para eliminarlo.';

export async function removeClient(store:Database,actor:Actor,clientId:string,input:unknown){
 const id=z.uuid().parse(clientId),body=confirmation.parse(input);
 return new Logistics(store).command(actor,`clients.${id}.delete`,body,['ADMIN'],async()=>{
  const client=await clientRemovalPreview(store,actor,id);
  ensure(!client.blocked,'INVALID_TRANSITION',inTransit,409);
  const sameTotals=Object.entries(client.totals).every(([key,count])=>body.expectedTotals[key as keyof typeof body.expectedTotals]===count);
  ensure(client.name===body.expectedName&&sameTotals,'VERSION_CONFLICT','Los datos del cliente cambiaron. Volvé a revisar antes de eliminarlo.',409);
  if(store.kind==='postgres'){
   const result=await store.one('SELECT purge_client(?,?,?,?) AS result',actor.orgId,id,actor.id,body.expectedName);
   ensure(result?.result!=='FORBIDDEN','FORBIDDEN','Solo Administración puede eliminar clientes.',403);
   ensure(result?.result!=='IN_TRANSIT','INVALID_TRANSITION',inTransit,409);
   ensure(result?.result==='DELETED','VERSION_CONFLICT','El cliente cambió. Volvé a revisar antes de eliminarlo.',409);
  }else{
   await store.run('INSERT INTO client_purge_scope(org_id,client_id,actor_id) VALUES(?,?,?)',actor.orgId,id,actor.id);
  }
  return {id,deleted:true};
 });
}
