import {MIN_PASSWORD} from './validation.ts';
import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from './database.ts';
import { authorize, passwordHash, type Actor } from './auth.ts';
import { Logistics } from './domain.ts';
import { ensure } from './errors.ts';
import { camel } from './db.ts';

const createSchema=z.object({commandId:z.uuid(),clientId:z.uuid(),name:z.string().trim().min(1).max(200),username:z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9_.@-]+$/),password:z.string().min(MIN_PASSWORD).max(128)});
export function installCustomerAccess(app:Express,store:Database,auth:(req:Request)=>Promise<Actor>) {
  const domain=new Logistics(store);
  app.get('/api/customer-access',async(req,res)=>{
    const actor=await auth(req);authorize(actor,['ADMIN']);
    const items=await store.all('SELECT a.id,a.client_id,a.name,a.username,a.enabled,a.created_at,c.name AS client_name FROM customer_accounts a JOIN clients c ON c.id=a.client_id AND c.org_id=a.org_id WHERE a.org_id=? ORDER BY a.created_at DESC',actor.orgId);
    res.json({items:items.map(row=>({...camel(row),enabled:!!row.enabled}))});
  });
  app.post('/api/customer-access',async(req,res)=>{
    const actor=await auth(req),body=createSchema.parse(req.body);
    res.json(await domain.command(actor,'customer-access.create',body,['ADMIN'],async()=>{
      await domain.record('clients',body.clientId,actor);
      ensure(!await store.one('SELECT id FROM users WHERE username=?',body.username),'VALIDATION_ERROR','El nombre de usuario ya existe.',409);
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
}
