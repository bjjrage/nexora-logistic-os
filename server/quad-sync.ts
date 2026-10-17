import type { Database } from './database.ts';
import type { Actor } from './auth.ts';
import { QuadOperations } from './quad-operations.ts';
import { DomainError, ensure } from './errors.ts';

export async function synchronizeQuadMinds(store:Database,quad=new QuadOperations(store)) {
  ensure(quad.config,'INTEGRATION_NOT_CONFIGURED','La sincronización requiere la cuenta de QuadMinds.',503);
  const user=await store.one("SELECT id,org_id,name FROM users WHERE org_id=? AND role='ADMIN' ORDER BY username LIMIT 1",quad.config.orgId);
  ensure(user,'INTEGRATION_NOT_CONFIGURED','Creá el administrador de la operación antes de activar la sincronización.',503);
  const actor:Actor={id:user.id,orgId:user.org_id,name:user.name,role:'ADMIN',driverId:null};
  const queue=await quad.process(actor,2),routes=await store.all("SELECT q.route_id FROM quad_route_links q JOIN routes r ON r.id=q.route_id AND r.org_id=q.org_id WHERE q.org_id=? AND r.state<>'OPERATIONALLY_CLOSED' ORDER BY COALESCE(q.synced_at,'') LIMIT 2",actor.orgId),results=[];
  for(const route of routes){try{results.push(await quad.syncRoute(actor,route.route_id));}catch(error){results.push({id:route.route_id,error:error instanceof DomainError?error.code:'QUADMINDS_PROVIDER_ERROR'});}}
  return {queue,routes:results};
}
