import type {Database} from './database.ts';
import {authorize,type Actor} from './auth.ts';

// Rebuild quantity stock independently from the append-only ledger. A balance is a projection, not the source of truth.
export async function reconcileInventory(store:Database,actor:Actor){
 authorize(actor,['ADMIN']);
 return store.transaction(async()=>{
 const issues=await store.all(`WITH legs AS (
 SELECT m.client_id,m.product_id,m.to_location_id AS location_id,m.to_status AS status,
 COALESCE(m.to_custody_id,'') AS custody_id,CASE WHEN m.to_status='AVAILABLE' THEN '' ELSE COALESCE(m.order_id,'') END AS order_id,m.quantity AS expected,0 AS actual
 FROM inventory_movements m JOIN inventory_products p ON p.id=m.product_id AND p.org_id=m.org_id
 WHERE m.org_id=? AND p.tracking='QUANTITY' AND m.to_status IN('AVAILABLE','RESERVED','VEHICLE','QUARANTINE')
 UNION ALL
 SELECT m.client_id,m.product_id,m.from_location_id,m.from_status,COALESCE(m.from_custody_id,''),
 CASE WHEN m.from_status='AVAILABLE' THEN '' ELSE COALESCE(m.order_id,'') END,-m.quantity,0
 FROM inventory_movements m JOIN inventory_products p ON p.id=m.product_id AND p.org_id=m.org_id
 WHERE m.org_id=? AND p.tracking='QUANTITY' AND m.from_status IN('AVAILABLE','RESERVED','VEHICLE','QUARANTINE')
 UNION ALL
 SELECT client_id,product_id,location_id,status,custody_id,order_id,0,quantity FROM inventory_balances WHERE org_id=?
 ) SELECT client_id,product_id,location_id,status,custody_id,order_id,SUM(expected) AS expected,SUM(actual) AS actual
 FROM legs GROUP BY client_id,product_id,location_id,status,custody_id,order_id HAVING SUM(expected)<>SUM(actual) ORDER BY product_id,location_id LIMIT 201`,actor.orgId,actor.orgId,actor.orgId);
 const serialIssues=await store.all(`SELECT u.id,u.product_id,u.status,COALESCE(SUM(CASE WHEN m.to_status=u.status AND m.to_location_id=u.location_id THEN m.quantity ELSE 0 END),0)-COALESCE(SUM(CASE WHEN m.from_status=u.status AND m.from_location_id=u.location_id THEN m.quantity ELSE 0 END),0) AS ledger_quantity
 FROM inventory_units u LEFT JOIN inventory_movements m ON m.serial_id=u.id AND m.org_id=u.org_id
 WHERE u.org_id=? AND u.status<>'ADJUSTED' GROUP BY u.id,u.product_id,u.status,u.location_id
 HAVING COALESCE(SUM(CASE WHEN m.to_status=u.status AND m.to_location_id=u.location_id THEN m.quantity ELSE 0 END),0)-COALESCE(SUM(CASE WHEN m.from_status=u.status AND m.from_location_id=u.location_id THEN m.quantity ELSE 0 END),0)<>1 LIMIT 201`,actor.orgId);
 return {ok:issues.length===0&&serialIssues.length===0,checkedAt:new Date().toISOString(),quantityIssues:issues.slice(0,200),serialIssues:serialIssues.slice(0,200),truncated:issues.length>200||serialIssues.length>200};
 });
}
