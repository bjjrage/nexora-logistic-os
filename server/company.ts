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
      team:await this.store.all('SELECT id,name,username,role FROM users WHERE org_id=? ORDER BY name',actor.orgId)};
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
