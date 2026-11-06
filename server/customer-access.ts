import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from './database.ts';
import { authorize, passwordHash, type Actor } from './auth.ts';
import { Logistics } from './domain.ts';
import { ensure } from './errors.ts';
import { camel } from './db.ts';
import { accountCredentialFields } from './credential-contract.ts';

const createSchema=z.object({commandId:z.uuid(),clientId:z.uuid(),name:z.string().trim().min(1).max(200),...accountCredentialFields});
export function installCustomerAccess(app:Express,store:Database,auth:(req:Request)=>Promise<Actor>) {
  const domain=new Logistics(store);
  app.get('/api/customer-access',async(req,res)=>{
    const actor=await auth(req);authorize(actor,['ADMIN']);
    const {clientId}=z.object({clientId:z.uuid().optional()}).parse(req.query);
    if(clientId)await domain.record('clients',clientId,actor);
    const items=await store.all(`SELECT a.id,a.client_id,a.name,a.username,a.enabled,a.created_at,c.name AS client_name FROM customer_accounts a JOIN clients c ON c.id=a.client_id AND c.org_id=a.org_id WHERE a.org_id=? ${clientId?'AND a.client_id=?':''} ORDER BY a.created_at DESC,a.id`,actor.orgId,...(clientId?[clientId]:[]));
    res.json({items:items.map(row=>({...camel(row),enabled:!!row.enabled}))});
  });
  app.post('/api/customer-access',async(req,res)=>{
    const actor=await auth(req),body=createSchema.parse(req.body);
    res.json(await domain.command(actor,'customer-access.create',body,['ADMIN'],async()=>{
      await domain.record('clients',body.clientId,actor);
      ensure(!await store.one('SELECT id FROM users WHERE lower(username)=lower(?)',body.username)&&!await store.one('SELECT id FROM customer_accounts WHERE lower(username)=lower(?)',body.username),'VALIDATION_ERROR','El nombre de usuario ya existe, aunque cambien las mayúsculas.',409);
      const id=randomUUID();
      await store.run('INSERT INTO customer_accounts(id,org_id,client_id,name,username,password_hash,enabled,created_at) VALUES(?,?,?,?,?,?,1,?)',id,actor.orgId,body.clientId,body.name,body.username,passwordHash(body.password),new Date().toISOString());
      return {id};
    }));
  });
  app.post('/api/customer-access/:id/revoke',async(req,res)=>{
    const actor=await auth(req),body=z.object({commandId:z.uuid()}).parse(req.body),id=z.uuid().parse(req.params.id);
    res.json(await domain.command(actor,`customer-access.${id}.revoke`,body,['ADMIN'],async()=>{
      await domain.record('customer_accounts',id,actor);
      await store.run('UPDATE customer_accounts SET enabled=0 WHERE id=? AND org_id=?',id,actor.orgId);
      await store.run('DELETE FROM customer_sessions WHERE account_id=?',id);
      return {id,enabled:false};
    }));
  });
  app.post('/api/customer-access/:id/enable',async(req,res)=>{
    const actor=await auth(req),body=z.object({commandId:z.uuid()}).parse(req.body),id=z.uuid().parse(req.params.id);
    res.json(await domain.command(actor,`customer-access.${id}.enable`,body,['ADMIN'],async()=>{
      const account=await domain.record('customer_accounts',id,actor);
      if(!account.enabled){
        // Reactivation requires a new login; previously revoked sessions stay invalid.
        await store.run('DELETE FROM customer_sessions WHERE account_id=?',id);
        await store.run('UPDATE customer_accounts SET enabled=1 WHERE id=? AND org_id=?',id,actor.orgId);
      }
      return {id,enabled:true};
    }));
  });
}
