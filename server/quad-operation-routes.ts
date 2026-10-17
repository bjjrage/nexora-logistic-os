import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Database } from './database.ts';
import { authorize, type Actor } from './auth.ts';
import { ensure } from './errors.ts';
import { QuadOperations } from './quad-operations.ts';

export function installQuadOperationRoutes(app:Express,store:Database,auth:(req:Request)=>Promise<Actor>,quad:QuadOperations){
  app.get('/api/quadminds/operations',async(req,res)=>res.json(await quad.status(await auth(req))));
  app.post('/api/quadminds/shipments/:id/queue',async(req,res)=>res.json(await quad.queue(await auth(req),z.uuid().parse(req.params.id),req.body)));
  app.post('/api/quadminds/parcels/:id/bind',async(req,res)=>res.json(await quad.bindParcel(await auth(req),z.uuid().parse(req.params.id),req.body)));
  app.post('/api/quadminds/routes/:id/bind',async(req,res)=>res.json(await quad.bindRoute(await auth(req),z.uuid().parse(req.params.id),req.body)));
  app.post('/api/quadminds/process',async(req,res)=>{const b=z.object({commandId:z.uuid(),limit:z.number().int().min(1).max(20).default(10)}).parse(req.body);res.json(await quad.process(await auth(req),b.limit));});
  app.post('/api/quadminds/routes/:id/sync',async(req,res)=>{const b=z.object({commandId:z.uuid(),applySequence:z.boolean().default(false)}).parse(req.body);res.json(await quad.syncRoute(await auth(req),z.uuid().parse(req.params.id),b.applySequence));});
  app.get('/api/quadminds/shipments/:id/proofs',async(req,res)=>res.json(await quad.proofs(await auth(req),z.uuid().parse(req.params.id))));
  app.get('/api/customer-evidence/:id',async(req,res)=>{
    const actor=await auth(req);authorize(actor,['CUSTOMER','ADMIN','OPERATIONS','DEPOT']);
    const e=await store.one('SELECT e.*,s.client_id FROM evidence e JOIN quad_proofs q ON q.evidence_id=e.id AND q.org_id=e.org_id JOIN parcels p ON p.id=e.parcel_id AND p.org_id=e.org_id JOIN shipments s ON s.id=p.shipment_id AND s.org_id=p.org_id WHERE e.id=? AND e.org_id=?',z.uuid().parse(req.params.id),actor.orgId);
    ensure(e&&(actor.role!=='CUSTOMER'||e.client_id===actor.clientId),'NOT_FOUND','Comprobante no encontrado.',404);
    res.set({'Content-Type':e.mime_type,'Content-Disposition':'inline','Content-Security-Policy':"default-src 'none'; sandbox"}).send(Buffer.from(e.data));
  });
}
