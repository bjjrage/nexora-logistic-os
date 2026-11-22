import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Router, type Express, type Request } from 'express';
import { authorize, type Actor } from './auth.ts';
import { Logistics } from './domain.ts';
import type { Database } from './database.ts';
import { camel } from './db.ts';
import { ensure } from './errors.ts';
import { crmRoles } from './crm.ts';

const idSchema = z.uuid();
const command = z.object({commandId:idSchema});
const listSchema = z.object({
  limit:z.coerce.number().int().min(1).max(100).default(25),
  offset:z.coerce.number().int().min(0).max(1000000).default(0),
}).strict();
const threadSchema = command.extend({
  prospectId:idSchema,contactId:idSchema,
  channel:z.enum(['EMAIL','WHATSAPP','FACEBOOK','INSTAGRAM']),
}).strict();
const draftSchema = command.extend({body:z.string().trim().min(1).max(3000)}).strict();
const stateSchema = command.strict();
const now = () => new Date().toISOString();

export async function outreachAvailable(db:Database, actor:Actor) {
  if (!crmRoles.includes(actor.role)) return false;
  try {
    if (db.kind==='sqlite') {
      const row=await db.one("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type='table' AND name IN ('crm_outreach_threads','crm_outreach_messages') AND EXISTS (SELECT 1 FROM schema_migrations WHERE version=25)");
      return Number(row?.total)===2;
    }
    const row=await db.one("SELECT COUNT(*) AS total FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND t.relname IN ('crm_outreach_threads','crm_outreach_messages') AND t.relkind='r' AND row_security_active(t.oid) AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=t.oid AND p.polname='crm_organization') AND has_table_privilege(t.oid,'SELECT,INSERT,UPDATE')");
    return Number(row?.total)===2;
  } catch { return false; }
}

export class Outreach {
  private commands:Logistics;
  private db:Database;
  constructor(db:Database) { this.db=db; this.commands=new Logistics(db); }
  private read<T>(actor:Actor, work:()=>Promise<T>) {
    authorize(actor,crmRoles);
    return this.db.transaction(work,{crmOrgId:actor.orgId,readOnly:true});
  }
  private write<T extends Record<string,unknown>>(actor:Actor,kind:string,body:Record<string,unknown>,work:()=>Promise<T>) {
    authorize(actor,crmRoles);
    return this.db.transaction(()=>this.commands.command(actor,'crm.outreach.'+kind,body,crmRoles,work) as Promise<T>,{crmOrgId:actor.orgId});
  }
  private async thread(actor:Actor,id:string) {
    const row=await this.db.one('SELECT * FROM crm_outreach_threads WHERE org_id=? AND id=?',actor.orgId,id);
    ensure(row,'NOT_FOUND','Conversación no encontrada.',404);
    return row;
  }
  private async contactAllowed(actor:Actor,thread:Record<string,any>) {
    const contact=await this.db.one('SELECT no_contact,email,phone,facebook,instagram FROM crm_contacts WHERE org_id=? AND prospect_id=? AND id=?',actor.orgId,thread.prospect_id,thread.contact_id);
    ensure(contact,'NOT_FOUND','Contacto no encontrado.',404);
    ensure(!contact.no_contact,'CRM_DO_NOT_CONTACT','El contacto pidió no ser contactado.',409);
    return contact;
  }
  async threads(actor:Actor,query:z.output<typeof listSchema>) {
    return this.read(actor,async()=>{
      const rows=await this.db.all("SELECT t.*,p.name AS prospect_name,c.name AS contact_name,c.no_contact FROM crm_outreach_threads t JOIN crm_prospects p ON p.org_id=t.org_id AND p.id=t.prospect_id JOIN crm_contacts c ON c.org_id=t.org_id AND c.prospect_id=t.prospect_id AND c.id=t.contact_id WHERE t.org_id=? ORDER BY t.updated_at DESC,t.id LIMIT ? OFFSET ?",actor.orgId,query.limit,query.offset);
      const total=await this.db.one('SELECT COUNT(*) AS total FROM crm_outreach_threads WHERE org_id=?',actor.orgId);
      return {rows:rows.map(row=>({...camel(row),noContact:Boolean(row.no_contact)})),total:Number(total?.total||0),...query};
    });
  }
  async messages(actor:Actor,id:string,query:z.output<typeof listSchema>) {
    return this.read(actor,async()=>{
      await this.thread(actor,id);
      const rows=await this.db.all('SELECT * FROM crm_outreach_messages WHERE org_id=? AND thread_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?',actor.orgId,id,query.limit,query.offset);
      const total=await this.db.one('SELECT COUNT(*) AS total FROM crm_outreach_messages WHERE org_id=? AND thread_id=?',actor.orgId,id);
      return {rows:rows.map(camel),total:Number(total?.total||0),...query};
    });
  }
  open(actor:Actor,body:z.output<typeof threadSchema>) {
    return this.write(actor,'open',body,async()=>{
      const prospect=await this.db.one('SELECT id FROM crm_prospects WHERE org_id=? AND id=?',actor.orgId,body.prospectId);
      ensure(prospect,'NOT_FOUND','Prospecto no encontrado.',404);
      const contact=await this.contactAllowed(actor,{prospect_id:body.prospectId,contact_id:body.contactId});
      const field={EMAIL:'email',WHATSAPP:'phone',FACEBOOK:'facebook',INSTAGRAM:'instagram'}[body.channel] as keyof typeof contact;
      ensure(Boolean(contact[field]),'VALIDATION_ERROR','El contacto no tiene un canal válido para esa conversación.',400);
      const existing=await this.db.one('SELECT id FROM crm_outreach_threads WHERE org_id=? AND prospect_id=? AND contact_id=? AND channel=?',actor.orgId,body.prospectId,body.contactId,body.channel);
      if(existing)return {id:existing.id,state:'EXISTING'};
      const id=randomUUID(),timestamp=now();
      await this.db.run('INSERT INTO crm_outreach_threads (org_id,id,prospect_id,contact_id,channel,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',actor.orgId,id,body.prospectId,body.contactId,body.channel,actor.id,timestamp,timestamp);
      return {id,state:'OPEN'};
    });
  }
  draft(actor:Actor,id:string,body:z.output<typeof draftSchema>,agentRunId?:string) {
    return this.write(actor,'draft.'+id,{...body,agentRunId},async()=>{
      const thread=await this.thread(actor,id);
      ensure(thread.state==='OPEN','INVALID_TRANSITION','La conversación está cerrada.',409);
      await this.contactAllowed(actor,thread);
      const messageId=randomUUID(),timestamp=now();
      await this.db.run("INSERT INTO crm_outreach_messages (org_id,thread_id,id,direction,state,body,created_by,created_at) VALUES (?,?,?,'OUTBOUND','DRAFT',?,?,?)",actor.orgId,id,messageId,body.body,actor.id,timestamp);
      await this.db.run('UPDATE crm_outreach_threads SET updated_at=? WHERE org_id=? AND id=?',timestamp,actor.orgId,id);
      return {id:messageId,state:'DRAFT'};
    });
  }
  private change(actor:Actor,id:string,body:z.output<typeof stateSchema>,from:string,to:string) {
    return this.write(actor,to.toLowerCase()+'.'+id,body,async()=>{
      const message=await this.db.one('SELECT * FROM crm_outreach_messages WHERE org_id=? AND id=?',actor.orgId,id);
      ensure(message,'NOT_FOUND','Mensaje no encontrado.',404);
      const thread=await this.thread(actor,message.thread_id);
      ensure(thread.state==='OPEN','INVALID_TRANSITION','La conversación está cerrada.',409);
      await this.contactAllowed(actor,thread);
      ensure(message.state===from,'INVALID_TRANSITION','El mensaje ya cambió de estado.',409);
      const timestamp=now();
      await this.db.run('UPDATE crm_outreach_messages SET state=?,reviewed_by=?,reviewed_at=? WHERE org_id=? AND id=?',
        to,to==='APPROVED'?actor.id:null,to==='APPROVED'?timestamp:null,actor.orgId,id);
      await this.db.run('UPDATE crm_outreach_threads SET updated_at=? WHERE org_id=? AND id=?',timestamp,actor.orgId,thread.id);
      return {id,state:to};
    });
  }
  requestApproval(actor:Actor,id:string,body:z.output<typeof stateSchema>) {
    return this.change(actor,id,body,'DRAFT','PENDING_APPROVAL');
  }
  approve(actor:Actor,id:string,body:z.output<typeof stateSchema>) {
    return this.change(actor,id,body,'PENDING_APPROVAL','APPROVED');
  }
}

export function installOutreachRoutes(app:Express,db:Database,auth:(req:Request)=>Promise<Actor>) {
  const router=Router(),service=new Outreach(db);
  const a=(res:{locals:Record<string,unknown>})=>res.locals.crmActor as Actor;
  router.use(async(req,res,next)=>{
    const actor=await auth(req);
    authorize(actor,crmRoles);
    ensure(await outreachAvailable(db,actor),'CRM_OUTREACH_NOT_READY','La bandeja necesita verificar su migración.',503);
    res.locals.crmActor=actor;
    next();
  });
  router.get('/threads',async(req,res)=>res.json(await service.threads(a(res),listSchema.parse(req.query))));
  router.get('/threads/:id/messages',async(req,res)=>res.json(await service.messages(a(res),idSchema.parse(req.params.id),listSchema.parse(req.query))));
  router.post('/threads',async(req,res)=>res.status(201).json(await service.open(a(res),threadSchema.parse(req.body))));
  router.post('/threads/:id/drafts',async(req,res)=>res.status(201).json(await service.draft(a(res),idSchema.parse(req.params.id),draftSchema.parse(req.body))));
  router.post('/messages/:id/request-approval',async(req,res)=>res.json(await service.requestApproval(a(res),idSchema.parse(req.params.id),stateSchema.parse(req.body))));
  router.post('/messages/:id/approve',async(req,res)=>res.json(await service.approve(a(res),idSchema.parse(req.params.id),stateSchema.parse(req.body))));
  app.use('/api/crm/outreach',router);
}
