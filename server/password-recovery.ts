import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Database} from './database.ts';
import {authorize,hash,passwordHash,type Actor} from './auth.ts';
import {ensure} from './errors.ts';
export class PasswordRecovery {
 private store:Database;
 constructor(store:Database){this.store=store;}
 async issue(actor:Actor,input:unknown){
  authorize(actor,['ADMIN']);const body=z.object({kind:z.enum(['USER','CUSTOMER']),id:z.uuid()}).strict().parse(input);
  return this.store.transaction(async()=>{
   const table=body.kind==='USER'?'users':'customer_accounts',column=body.kind==='USER'?'user_id':'account_id';
   const target=await this.store.one(`SELECT id FROM ${table} WHERE id=? AND org_id=? AND enabled=1`,body.id,actor.orgId);
   ensure(target,'NOT_FOUND','Cuenta no encontrada.',404);
   const token=randomBytes(32).toString('hex'),createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+15*60000).toISOString();
   await this.store.run(`DELETE FROM password_recovery WHERE ${column}=? AND org_id=?`,body.id,actor.orgId);
   await this.store.run('DELETE FROM password_recovery WHERE expires_at<=?',createdAt);
   await this.store.run('INSERT INTO password_recovery(token_hash,org_id,user_id,account_id,expires_at,used_at,created_at,issuer_id) VALUES(?,?,?,?,?,NULL,?,?)',hash(token),actor.orgId,body.kind==='USER'?body.id:null,body.kind==='CUSTOMER'?body.id:null,expiresAt,createdAt,actor.id);
   await this.store.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)',randomUUID(),actor.orgId,actor.id,'account.recovery.issue',body.id,randomUUID(),JSON.stringify({kind:body.kind}),createdAt);
   return {token,expiresAt};
  });
 }
 async redeem(input:unknown){
  const body=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password:z.string().min(6).max(128)}).strict().parse(input);
  return this.store.transaction(async()=>{
   const row=await this.store.one('SELECT * FROM password_recovery WHERE token_hash=? AND used_at IS NULL AND expires_at>?',hash(body.token),new Date().toISOString());
   ensure(row?.issuer_id,'FORBIDDEN','El enlace no es válido o venció. Solicitá uno nuevo a Administración.',401);
   const customer=Boolean(row.account_id),table=customer?'customer_accounts':'users',id=row.account_id??row.user_id;
   ensure(await this.store.one(`SELECT id FROM ${table} WHERE id=? AND org_id=? AND enabled=1`,id,row.org_id),'FORBIDDEN','La cuenta está suspendida.',401);
   await this.store.run(`UPDATE ${table} SET password_hash=? WHERE id=? AND org_id=?`,passwordHash(body.password),id,row.org_id);
   await this.store.run('UPDATE password_recovery SET used_at=? WHERE token_hash=?',new Date().toISOString(),hash(body.token));
   await this.store.run(`DELETE FROM ${customer?'customer_sessions':'sessions'} WHERE ${customer?'account_id':'user_id'}=?`,id);
   await this.store.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)',randomUUID(),row.org_id,row.issuer_id,'account.recovery.redeemed',id,randomUUID(),JSON.stringify({kind:customer?'CUSTOMER':'USER',authorizedBy:row.issuer_id}),new Date().toISOString());
   return {reset:true};
  });
 }
}
