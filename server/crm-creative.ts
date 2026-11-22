import {randomUUID} from 'node:crypto';
import {Router,type Express,type Request} from 'express';
import {z} from 'zod';
import {authorize,type Actor} from './auth.ts';
import {Logistics} from './domain.ts';
import type {Database} from './database.ts';
import {camel} from './db.ts';
import {ensure} from './errors.ts';
import {crmRoles} from './crm.ts';

const uuid=z.uuid();
const command=z.object({commandId:uuid});
const createSchema=command.extend({
  campaign:z.string().trim().max(150).default(''),
  objective:z.string().trim().max(150).default(''),
  audience:z.string().trim().max(300).default(''),
  idea:z.string().trim().min(15).max(2000),
  durationSeconds:z.number().int().min(15).max(30).default(20),
  aspectRatio:z.enum(['9:16','1:1','16:9']).default('9:16'),
}).strict();
const versionSchema=command.extend({expectedVersion:z.number().int().positive()}).strict();
const pageSchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),
  offset:z.coerce.number().int().min(0).max(1000000).default(0)}).strict();
const now=()=>new Date().toISOString();

type Brief={id:string;idea:string;audience:string;objective:string;campaign:string;duration_seconds:number;aspect_ratio:string;version:number;state:string};
const style='Original friendly stylized 3D cartoon, tactile shapes, soft cinematic light, clean readable composition, bright but controlled palette, consistent recurring small-business owner and logistics team. Never copy existing cartoon intellectual property. No embedded lettering, no invented logos, no misleading maps.';
const risks=['La cobertura y disponibilidad de storage/delivery requieren validación operativa.','No prometer plazos, precios, escrow, cobros ni clientes actuales sin evidencia comercial aprobada.','Aplicar el logo y el texto final como overlays verificados, nunca dentro del render generativo.'];

function concept(brief:Brief,angle:string,hook:string,visual:string,copy:string,index:number) {
  const length=4,seconds=Array.from({length},(_,i)=>Math.floor(brief.duration_seconds/length)+(i<brief.duration_seconds%length?1:0));
  const visualSteps=[
    'Small seller in a compact shop, visibly busy with several packages',
    'Friendly 3D NEXORA-inspired warehouse team organizing clearly labeled generic boxes',
    'Operations flow from verified inventory to packing and dispatch, without literal UI screenshots',
    'Seller focused on customers while a generic delivery completes the narrative',
  ];
  const voice=[
    hook,
    'Cuando crecen los pedidos, organizar la mercadería también importa.',
    'NEXORA combina almacenamiento y logística en una experiencia conectada.',
    copy,
  ];
  return {id:'angle-'+index,angle,hook,cta:'Conocé cómo funciona NEXORA',scenes:visualSteps.map((step,i)=>({
    scene:i+1,seconds:seconds[i],
    voiceOver:voice[i],
    overlay:i===3?'Conocé NEXORA':'',
    imagePrompt:`${style} Scene ${i+1} of 4. ${step}. Core marketing idea: ${brief.idea.slice(0,500)}. Audience: ${brief.audience||'small online merchants'}. Visual treatment: ${visual}. 9:16-safe title space. Maintain identical original character wardrobe and face as approved character reference across scenes.`,
    motionPrompt:'Animate this approved illustration for '+seconds[i]+' seconds, keep original character identity and scene composition; gentle camera dolly, natural hand movements, stable object geometry; no new text, no logo, no invented UI.',
  }))};
}

/** Editorial fallback, not an LLM result. Never present this as an AI render or as verified claims. */
export function editorialStoryboard(brief:Brief) {
  return {
    engine:'EDITORIAL_TEMPLATE_NO_AI',
    generatedAt:now(),styleBible:style,
    campaign:brief.campaign,audience:brief.audience,objective:brief.objective,
    ratio:brief.aspect_ratio,durationSeconds:brief.duration_seconds,
    modelSelection:'PENDING_FAL_SCHEMA_VERIFICATION',
    concepts:[
      concept(brief,'Problema → solución','¿Tu negocio crece, pero los paquetes también?','Warm humorous character-driven explainer','Consultá las zonas y servicios disponibles.',1),
      concept(brief,'Antes y después','Vendé con más foco y menos tareas operativas.','Clear before/after visual sequence, same character in every scene','Preguntanos cómo simplificar tu operación.',2),
      concept(brief,'Un pedido, un recorrido','Cada pedido necesita una operación detrás.','Follow one generic box, from inventory to preparation to delivery','Descubrí qué puede hacer NEXORA por tu negocio.',3),
    ],
    claimChecks:risks,
    notes:'Propuesta editorial inicial: NO generada por IA y NO enviada a fal.ai. Revisar datos comerciales, personajes, prompts y claims antes de cualquier gasto.',
  };
}

export async function creativeAvailable(db:Database,actor:Actor) {
  if(!crmRoles.includes(actor.role))return false;
  try {
    if(db.kind==='sqlite') {
      const r=await db.one("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type='table' AND name='crm_creative_briefs' AND EXISTS(SELECT 1 FROM schema_migrations WHERE version=26)");
      return Number(r?.total)===1;
    }
    const r=await db.one("SELECT COUNT(*) AS total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname='crm_creative_briefs' AND c.relkind='r' AND row_security_active(c.oid) AND EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='crm_organization') AND has_table_privilege(c.oid,'SELECT,INSERT,UPDATE')");
    return Number(r?.total)===1;
  } catch{return false;}
}
class CreativeStudio {
  private db:Database;
  private commands:Logistics;
  constructor(db:Database){this.db=db;this.commands=new Logistics(db);}
  private read<T>(actor:Actor,work:()=>Promise<T>){authorize(actor,crmRoles);return this.db.transaction(work,{crmOrgId:actor.orgId,readOnly:true});}
  private write<T extends Record<string,unknown>>(actor:Actor,kind:string,input:Record<string,unknown>,work:()=>Promise<T>){
    authorize(actor,crmRoles);return this.db.transaction(()=>this.commands.command(actor,'crm.creative.'+kind,input,crmRoles,work) as Promise<T>,{crmOrgId:actor.orgId});
  }
  private async brief(actor:Actor,id:string){
    const b=await this.db.one('SELECT * FROM crm_creative_briefs WHERE org_id=? AND id=?',actor.orgId,id);
    ensure(b,'NOT_FOUND','Brief no encontrado.',404);return b;
  }
  list(actor:Actor,q:z.output<typeof pageSchema>){return this.read(actor,async()=>{
    const rows=await this.db.all('SELECT id,campaign,idea,state,duration_seconds,aspect_ratio,version,updated_at FROM crm_creative_briefs WHERE org_id=? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?',actor.orgId,q.limit,q.offset);
    const total=await this.db.one('SELECT COUNT(*) AS total FROM crm_creative_briefs WHERE org_id=?',actor.orgId);
    return {rows:rows.map(camel),total:Number(total?.total||0),...q};
  });}
  detail(actor:Actor,id:string){return this.read(actor,async()=>{
    const b=await this.brief(actor,id);
    return {...camel(b),plan:b.plan_json?JSON.parse(b.plan_json):null};
  });}
  create(actor:Actor,input:z.output<typeof createSchema>){return this.write(actor,'create',input,async()=>{
    const id=randomUUID(),t=now();
    await this.db.run('INSERT INTO crm_creative_briefs (org_id,id,campaign,objective,audience,idea,duration_seconds,aspect_ratio,author_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',actor.orgId,id,input.campaign,input.objective,input.audience,input.idea,input.durationSeconds,input.aspectRatio,actor.id,t,t);
    return {id,state:'DRAFT'};
  });}
  plan(actor:Actor,id:string,input:z.output<typeof versionSchema>){return this.write(actor,'plan.'+id,input,async()=>{
    const b=await this.brief(actor,id);
    ensure(b.version===input.expectedVersion,'VERSION_CONFLICT','El brief cambió. Actualizá antes de generar.',409);
    ensure(b.state!=='APPROVED','INVALID_TRANSITION','El brief ya fue aprobado.',409);
    const plan=editorialStoryboard(b as Brief);
    await this.db.run("UPDATE crm_creative_briefs SET plan_json=?,state='PLANNED',version=version+1,updated_at=? WHERE org_id=? AND id=?",JSON.stringify(plan),now(),actor.orgId,id);
    return {id,state:'PLANNED',engine:plan.engine};
  });}
  approve(actor:Actor,id:string,input:z.output<typeof versionSchema>){return this.write(actor,'approve.'+id,input,async()=>{
    const b=await this.brief(actor,id);
    ensure(b.version===input.expectedVersion,'VERSION_CONFLICT','El brief cambió. Actualizá antes de aprobar.',409);
    ensure(b.state==='PLANNED'&&Boolean(b.plan_json),'INVALID_TRANSITION','Generá un storyboard antes de aprobar.',409);
    const t=now();
    await this.db.run("UPDATE crm_creative_briefs SET state='APPROVED',version=version+1,reviewed_by=?,reviewed_at=?,updated_at=? WHERE org_id=? AND id=?",actor.id,t,t,actor.orgId,id);
    return {id,state:'APPROVED'};
  });}
}

export function installCreativeRoutes(app:Express,db:Database,auth:(req:Request)=>Promise<Actor>) {
  const router=Router(),svc=new CreativeStudio(db);
  const actor=(res:{locals:Record<string,unknown>})=>res.locals.crmActor as Actor;
  router.use(async(req,res,next)=>{const a=await auth(req);authorize(a,crmRoles);
    ensure(await creativeAvailable(db,a),'CRM_CREATIVE_NOT_READY','Studio pendiente de validación de esquema.',503);
    res.locals.crmActor=a;next();
  });
  router.get('/status',async(_req,res)=>res.json({planning:'EDITORIAL_TEMPLATE_NO_AI',llm:'NOT_CONNECTED',fal:'NOT_CONNECTED',paidRendering:false}));
  router.get('/briefs',async(req,res)=>res.json(await svc.list(actor(res),pageSchema.parse(req.query))));
  router.get('/briefs/:id',async(req,res)=>res.json(await svc.detail(actor(res),uuid.parse(req.params.id))));
  router.post('/briefs',async(req,res)=>res.status(201).json(await svc.create(actor(res),createSchema.parse(req.body))));
  router.post('/briefs/:id/plan',async(req,res)=>res.json(await svc.plan(actor(res),uuid.parse(req.params.id),versionSchema.parse(req.body))));
  router.post('/briefs/:id/approve',async(req,res)=>res.json(await svc.approve(actor(res),uuid.parse(req.params.id),versionSchema.parse(req.body))));
  app.use('/api/crm/creative',router);
}
