import {z} from 'zod';
import type {Database} from './database.ts';
import {authorize,passwordHash,type Actor} from './auth.ts';
import {randomUUID} from 'node:crypto';
import {Logistics} from './domain.ts';
import {ensure} from './errors.ts';

const DELETED_HASH='!deleted';
export class CompanyAdministration {
  private store:Database;
  constructor(store:Database){this.store=store;}
  async setTestMode(actor:Actor,input:unknown){
    const body=z.object({commandId:z.uuid(),enabled:z.boolean()}).strict().parse(input);
    return new Logistics(this.store).command(actor,'organization.test-mode',body,['ADMIN'],async()=>{
      await this.store.run('INSERT INTO organization_test_mode(org_id,enabled) VALUES(?,?) ON CONFLICT(org_id) DO UPDATE SET enabled=excluded.enabled',actor.orgId,body.enabled?1:0);
      return {id:actor.orgId,testMode:body.enabled};
    });
  }
  async read(actor:Actor){
    authorize(actor,['ADMIN']);
    return {organization:await this.store.one('SELECT id,name,timezone FROM organizations WHERE id=?',actor.orgId),
      team:(await this.store.all('SELECT u.id,u.name,u.username,u.role,u.enabled,u.driver_id,CASE WHEN EXISTS(SELECT 1 FROM org_owners o WHERE o.org_id=u.org_id AND o.user_id=u.id) THEN 1 ELSE 0 END AS is_super_admin FROM users u WHERE u.org_id=? AND u.password_hash<>? ORDER BY u.name',actor.orgId,DELETED_HASH)).map(user=>({id:String(user.id),name:String(user.name),username:String(user.username),role:String(user.role),enabled:user.enabled,driverId:user.driver_id,isSuperAdmin:!!user.is_super_admin}))};
  }
  async createDriverAccess(actor:Actor,driverId:string,input:unknown){
    const body=z.object({commandId:z.uuid(),username:z.string().trim().min(3).max(100),password:z.string().min(6).max(200)}).strict().parse(input);
    return new Logistics(this.store).command(actor,`drivers.${driverId}.access.create`,body,['ADMIN'],async()=>{
      const driver=await this.store.one('SELECT id,name FROM drivers WHERE id=? AND org_id=?',driverId,actor.orgId);
      ensure(driver,'NOT_FOUND','Chofer no encontrado.',404);
      ensure(!await this.store.one('SELECT id FROM users WHERE org_id=? AND driver_id=? AND password_hash<>?',actor.orgId,driverId,DELETED_HASH),'INVALID_TRANSITION','El chofer ya tiene una cuenta. Activala o restablecé su acceso.');
      ensure(!await this.store.one('SELECT id FROM users WHERE lower(username)=lower(?)',body.username)&&!await this.store.one('SELECT id FROM customer_accounts WHERE lower(username)=lower(?)',body.username),'VALIDATION_ERROR','El nombre de usuario ya existe.',409);
      const id=randomUUID();
      await this.store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,?)',id,actor.orgId,body.username,driver.name,passwordHash(body.password),'DRIVER',driverId);
      return {id,driverId};
    });
  }
  // Deleted accounts stay as inert tombstones: audit, custody and evidence rows keep a valid actor reference.
  async remove(actor:Actor,id:string,input:unknown){
    const body=z.object({commandId:z.uuid()}).strict().parse(input);
    return new Logistics(this.store).command(actor,`users.${id}.delete`,body,['ADMIN'],async()=>{
      const target=await this.store.one('SELECT id,role,name FROM users WHERE id=? AND org_id=? AND password_hash<>?',id,actor.orgId,DELETED_HASH);
      ensure(target,'NOT_FOUND','Cuenta no encontrada.',404);
      ensure(!await this.store.one('SELECT user_id FROM org_owners WHERE org_id=? AND user_id=?',actor.orgId,id),'FORBIDDEN','La cuenta Super Admin está protegida.',403);
      ensure(id!==actor.id,'INVALID_TRANSITION','No podés eliminar tu propia cuenta.');
      if(target.role==='ADMIN')ensure(await this.store.one("SELECT id FROM users WHERE org_id=? AND role='ADMIN' AND enabled=1 AND id<>?",actor.orgId,id),'INVALID_TRANSITION','Debe quedar una cuenta de Administración activa.');
      await this.store.run('DELETE FROM sessions WHERE user_id=?',id);
      await this.store.run('DELETE FROM password_recovery WHERE user_id=? OR issuer_id=?',id,id);
      await this.store.run('UPDATE users SET enabled=0,password_hash=?,username=?,name=? WHERE id=? AND org_id=?',DELETED_HASH,'eliminado-'+id,target.name+' (eliminado)',id,actor.orgId);
      return {id,deleted:true};
    });
  }
  async setAccess(actor:Actor,id:string,input:unknown){
    const body=z.object({commandId:z.uuid(),enabled:z.boolean()}).strict().parse(input);
    return new Logistics(this.store).command(actor,`users.${id}.access`,body,['ADMIN'],async()=>{
      const target=await this.store.one('SELECT id,role FROM users WHERE id=? AND org_id=? AND password_hash<>?',id,actor.orgId,DELETED_HASH);
      ensure(target,'NOT_FOUND','Cuenta no encontrada.',404);
      if(!body.enabled)ensure(!await this.store.one('SELECT user_id FROM org_owners WHERE org_id=? AND user_id=?',actor.orgId,id),'FORBIDDEN','La cuenta Super Admin está protegida.',403);
      if(!body.enabled){
        ensure(id!==actor.id,'INVALID_TRANSITION','No podés suspender tu propia cuenta.');
        if(target.role==='ADMIN')ensure(await this.store.one("SELECT id FROM users WHERE org_id=? AND role='ADMIN' AND enabled=1 AND id<>?",actor.orgId,id),'INVALID_TRANSITION','Debe quedar una cuenta de Administración activa.');
        await this.store.run('DELETE FROM sessions WHERE user_id=?',id);
        await this.store.run('DELETE FROM password_recovery WHERE user_id=? OR issuer_id=?',id,id);
      }
      await this.store.run('UPDATE users SET enabled=? WHERE id=? AND org_id=?',body.enabled?1:0,id,actor.orgId);
      return {id,enabled:body.enabled};
    });
  }
  async update(actor:Actor,input:unknown){
    const body=z.object({commandId:z.uuid(),name:z.string().trim().min(1).max(500),timezone:z.string().trim().min(1).max(100)}).parse(input);
    return new Logistics(this.store).command(actor,'organization.update',body,['ADMIN'],async()=>{
      try{new Intl.DateTimeFormat('es',{timeZone:body.timezone});}catch{ensure(false,'VALIDATION_ERROR','Elegí una zona horaria válida.',400);}
      await this.store.run('UPDATE organizations SET name=?,timezone=? WHERE id=?',body.name,body.timezone,actor.orgId);
      return {id:actor.orgId,name:body.name,timezone:body.timezone};
    });
  }
}
