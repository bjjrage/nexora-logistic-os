import {Router, type Express, type Request} from 'express';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {authorize, type Actor} from './auth.ts';
import type {Database, Row} from './database.ts';
import {camel} from './db.ts';
import {ensure} from './errors.ts';
import {crmRoles, Prospecting} from './crm.ts';
import {Outreach, outreachAvailable} from './crm-outreach.ts';
import {crmSchemas, crmCommand} from './crm-contract.ts';
import {commercialFit, configuredProvider, prepareSuggestion, promptVersion, replyTopics, suggestion, type AgentProvider} from './crm-agent-provider.ts';

const uuid = z.uuid();
const csv = crmSchemas.import.extend({
  sourceRef: z.string().trim().min(5).max(500),
  authorization: z.string().trim().min(8).max(500),
  authorized: z.literal(true),
}).strict();
const requestSchema = crmCommand.extend({replyTopic:z.enum(replyTopics).default('SIN_RESPUESTA')}).strict();
const draftSchema = crmCommand.extend({kind:z.enum(['OUTREACH','REPLY'])}).strict();
const taskSchema = crmCommand.extend({dueAt:z.iso.datetime({offset:true}).optional()}).strict();
const page = crmSchemas.timeline;
const tables = "'crm_research_sources','crm_agent_runs'";
const now = () => new Date().toISOString();

async function agentAvailable(db:Database) {
  try {
    const row = db.kind === 'sqlite'
      ? await db.one(`SELECT COUNT(*) AS total FROM sqlite_schema WHERE type='table' AND name IN (${tables})
          AND EXISTS(SELECT 1 FROM schema_migrations WHERE version=29)`)
      : await db.one(`SELECT COUNT(*) AS total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=current_schema() AND c.relname IN (${tables}) AND c.relkind='r' AND row_security_active(c.oid)
          AND has_table_privilege(c.oid,'SELECT') AND has_table_privilege(c.oid,'INSERT')
          AND (c.relname='crm_research_sources' OR has_table_privilege(c.oid,'UPDATE'))
          AND EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='crm_organization')`);
    return Number(row?.total) === 2;
  } catch { return false; }
}

export class CrmAgent {
  private db: Database;
  private provider?: AgentProvider;
  private outreach: Outreach;
  private crm: Prospecting;
  constructor(db: Database, provider?: AgentProvider) {
    this.db=db; this.provider=provider; this.outreach=new Outreach(db); this.crm=new Prospecting(db);
  }

  private scope<T>(actor:Actor, work:()=>Promise<T>, readOnly=false) {
    authorize(actor, crmRoles);
    return this.db.transaction(work,{crmOrgId:actor.orgId,readOnly});
  }

  private async thread(actor:Actor, id:string, forContact=false) {
    const row=await this.db.one(`SELECT t.state,t.channel,t.prospect_id,t.contact_id,p.name,p.sector,p.city,
      p.website AS web,p.facebook,p.instagram,c.no_contact
      FROM crm_outreach_threads t
      JOIN crm_prospects p ON p.org_id=t.org_id AND p.id=t.prospect_id
      JOIN crm_contacts c ON c.org_id=t.org_id AND c.prospect_id=t.prospect_id AND c.id=t.contact_id
      WHERE t.org_id=? AND t.id=?`,actor.orgId,id);
    ensure(row,'NOT_FOUND','Conversación no encontrada.',404);
    if (forContact) {
      ensure(row.state==='OPEN','INVALID_TRANSITION','La conversación está cerrada.',409);
      ensure(!row.no_contact,'CRM_DO_NOT_CONTACT','El contacto pidió no ser contactado.',409);
    }
    return row;
  }

  private sources(actor:Actor, prospectId:string) {
    return this.db.all(`SELECT batch_id,source_row,source_ref,authorization_basis,captured_at
      FROM crm_research_sources WHERE org_id=? AND prospect_id=? ORDER BY captured_at DESC,batch_id LIMIT 25`,
      actor.orgId,prospectId);
  }

  research(actor:Actor, id:string) {
    return this.scope(actor,async()=>{
      const row=await this.db.one('SELECT website AS web,sector,facebook,instagram FROM crm_prospects WHERE org_id=? AND id=?',actor.orgId,id);
      ensure(row,'NOT_FOUND','Prospecto no encontrado.',404);
      const sources=await this.sources(actor,id);
      return {...commercialFit({sector:row.sector,web:row.web,facebook:row.facebook,instagram:row.instagram}),sources:sources.map(camel)};
    },true);
  }

  private view(row:Row) {
    return {id:row.id, state:row.state, model:row.model, promptVersion:row.prompt_version,
      startedAt:row.started_at, result:row.result_json?JSON.parse(row.result_json):null};
  }

  history(actor:Actor, threadId:string, query:z.output<typeof page>) {
    return this.scope(actor,async()=>{
      const thread=await this.thread(actor,threadId);
      const rows=await this.db.all('SELECT * FROM crm_agent_runs WHERE org_id=? AND thread_id=? ORDER BY started_at DESC,id LIMIT ? OFFSET ?',
        actor.orgId,threadId,query.limit,query.offset);
      const count=await this.db.one('SELECT COUNT(*) AS total FROM crm_agent_runs WHERE org_id=? AND thread_id=?',actor.orgId,threadId);
      return {rows:rows.map(row=>this.view(row)), total:Number(count?.total??0), configured:!!this.provider,
        contactAllowed:!thread.no_contact&&thread.state==='OPEN',...query};
    },true);
  }

  async generate(actor:Actor, threadId:string, input:z.output<typeof requestSchema>) {
    const signature=createHash('sha256').update(JSON.stringify([threadId,input.replyTopic])).digest('hex');
    const provider=this.provider;
    const reservation=await this.scope(actor,async()=>{
      const thread=await this.thread(actor,threadId,true);
      const existing=await this.db.one('SELECT * FROM crm_agent_runs WHERE org_id=? AND id=?',actor.orgId,input.commandId);
      if(existing) {
        ensure(existing.actor_id===actor.id&&existing.request_hash===signature,'DUPLICATE_COMMAND','La clave de ejecución ya fue usada.',409);
        return {existing};
      }
      ensure(provider,'CRM_AGENT_DISABLED','Proveedor de IA sin configurar.',503);
      ensure((await this.sources(actor,thread.prospect_id)).length,'CRM_SOURCE_REQUIRED','Registrá una fuente autorizada para este prospecto.',409);
      const start=now();
      const count=await this.db.one('SELECT COUNT(*) AS total FROM crm_agent_runs WHERE org_id=? AND started_at>=?',
        actor.orgId,start.slice(0,10)+'T00:00:00.000Z');
      ensure(Number(count?.total??0)<provider.dailyCallLimit,'CRM_AGENT_BUDGET','Presupuesto diario de ejecuciones agotado.',429);
      await this.db.run(`INSERT INTO crm_agent_runs
        (org_id,id,thread_id,actor_id,request_hash,state,prompt_version,model,started_at)
        VALUES(?,?,?,?,?,'PENDING',?,?,?)`,actor.orgId,input.commandId,threadId,actor.id,signature,promptVersion,provider.model,start);
      await this.db.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)',input.commandId,actor.orgId,actor.id,
        'crm.agent.generate',threadId,input.commandId,JSON.stringify({promptVersion,model:provider.model}),start);
      return {start,facts:{
        name:String(thread.name),sector:String(thread.sector),city:String(thread.city),channel:String(thread.channel),replyTopic:input.replyTopic,
      }};
    });
    if ('existing' in reservation && reservation.existing) {
      return this.view(reservation.existing);
    }
    ensure(provider&&reservation.facts&&reservation.start,'CRM_AGENT_DISABLED','Proveedor de IA sin configurar.',503);
    let result: ReturnType<typeof prepareSuggestion>;
    try {
      const selected=suggestion.parse(await provider.suggest(reservation.facts));
      result=prepareSuggestion(reservation.facts,selected,reservation.start);
      await this.scope(actor,async()=>{
        await this.thread(actor,threadId,true);
        await this.db.run("UPDATE crm_agent_runs SET state='READY',result_json=?,finished_at=? WHERE org_id=? AND id=? AND state='PENDING'",
          JSON.stringify(result),now(),actor.orgId,input.commandId);
      });
    } catch {
      await this.scope(actor,()=>this.db.run("UPDATE crm_agent_runs SET state='FAILED',finished_at=? WHERE org_id=? AND id=? AND state='PENDING'",
        now(),actor.orgId,input.commandId));
      return {id:input.commandId,state:'FAILED'};
    }
    return {id:input.commandId,state:'READY',result};
  }

  private async approvedInput(actor:Actor, runId:string) {
    return this.scope(actor,async()=>{
      const row=await this.db.one("SELECT thread_id,result_json FROM crm_agent_runs WHERE org_id=? AND id=? AND state='READY'",actor.orgId,runId);
      ensure(row,'NOT_FOUND','Sugerencia no disponible.',404);
      const context=await this.thread(actor,row.thread_id,true);
      return {threadId:row.thread_id,prospectId:context.prospect_id,contactId:context.contact_id,
        result:JSON.parse(row.result_json) as ReturnType<typeof prepareSuggestion>};
    },true);
  }

  async draft(actor:Actor, id:string, body:z.output<typeof draftSchema>) {
    const {threadId,result}=await this.approvedInput(actor,id);
    return this.outreach.draft(actor,threadId,{commandId:body.commandId,body:body.kind==='REPLY'?result.replyDraft:result.outreachDraft},id);
  }

  async followUp(actor:Actor, id:string, body:z.output<typeof taskSchema>) {
    const {prospectId,contactId,result}=await this.approvedInput(actor,id);
    return this.crm.createTask(actor,prospectId,{commandId:body.commandId,title:result.nextAction,dueAt:body.dueAt??result.nextAt},{contactId,runId:id});
  }
}

export function installCrmAgent(app:Express, db:Database, auth:(req:Request)=>Promise<Actor>) {
  const router=Router(), crm=new Prospecting(db), agent=new CrmAgent(db,configuredProvider());
  const actor=(res:{locals:Record<string,unknown>})=>res.locals.crmActor as Actor;
  const id=(req:Request)=>uuid.parse(req.params.id);
  router.use(async(req,res,next)=>{
    const user=await auth(req);
    authorize(user,crmRoles);
    ensure(await outreachAvailable(db,user)&&await agentAvailable(db),'CRM_AGENT_NOT_READY','La investigación comercial requiere migración verificada.',503);
    res.locals.crmActor=user;
    next();
  });
  router.post('/import/preview',async(req,res)=>res.json(await crm.preview(actor(res),crmSchemas.csv.parse(req.body).csv)));
  router.post('/import',async(req,res)=>{
    const {sourceRef,authorization,authorized:_authorized,...body}=csv.parse(req.body);
    res.status(201).json(await crm.import(actor(res),body,{reference:sourceRef,authorization}));
  });
  router.get('/prospects/:id',async(req,res)=>res.json(await agent.research(actor(res),id(req))));
  router.get('/threads/:id',async(req,res)=>res.json(await agent.history(actor(res),id(req),page.parse(req.query))));
  router.post('/threads/:id',async(req,res)=>res.json(await agent.generate(actor(res),id(req),requestSchema.parse(req.body))));
  router.post('/suggestions/:id/draft',async(req,res)=>res.status(201).json(await agent.draft(actor(res),id(req),draftSchema.parse(req.body))));
  router.post('/suggestions/:id/follow-up',async(req,res)=>res.status(201).json(await agent.followUp(actor(res),id(req),taskSchema.parse(req.body))));
  app.use('/api/crm/agent',router);
}
