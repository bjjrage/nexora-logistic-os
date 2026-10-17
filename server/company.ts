import {z} from 'zod';
import type {Database} from './database.ts';
import {authorize,type Actor} from './auth.ts';
import {Logistics} from './domain.ts';
import {ensure} from './errors.ts';

export class CompanyAdministration {
  private store:Database;
  constructor(store:Database){this.store=store;}
  async read(actor:Actor){
    authorize(actor,['ADMIN']);
    return {organization:await this.store.one('SELECT id,name,timezone FROM organizations WHERE id=?',actor.orgId),
      team:await this.store.all('SELECT id,name,username,role,enabled FROM users WHERE org_id=? ORDER BY name',actor.orgId)};
  }
  async setAccess(actor:Actor,id:string,input:unknown){
    const body=z.object({commandId:z.uuid(),enabled:z.boolean()}).strict().parse(input);
    return new Logistics(this.store).command(actor,`users.${id}.access`,body,['ADMIN'],async()=>{
      const target=await this.store.one('SELECT id,role FROM users WHERE id=? AND org_id=?',id,actor.orgId);
      ensure(target,'NOT_FOUND','Cuenta no encontrada.',404);
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
