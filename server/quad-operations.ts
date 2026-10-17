import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { downloadQuadProof, type DownloadedProof } from './proof-download.ts';
import { z } from 'zod';
import type { Database, Row } from './database.ts';
import { authorize, hash, type Actor } from './auth.ts';
import { Logistics } from './domain.ts';
import { DomainError, ensure } from './errors.ts';
import { camel } from './db.ts';

const text=z.string().trim().min(1).max(128),day=z.iso.date(),command={commandId:z.uuid()};
const timestamp=z.iso.datetime({offset:true});
const now=()=>new Date().toISOString();
const externalId=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)?value:null;
export type OperationsConfig={orgId:string;apiKey:string;webhookSecret:string|null;proofHosts:string[];deliveredCodes:number[];failedCodes:number[];constraints:{id:number;source:'WEIGHT_KG'|'VOLUME_M3'|'UNITS';value?:number}[]};
export function loadOperationsConfig(env:NodeJS.ProcessEnv=process.env):OperationsConfig|null {
  if(env.QUADMINDS_OPERATIONS_ENABLED!=='true')return null;
  try {
    const codes=(raw:string|undefined)=>z.array(z.number().int()).parse(JSON.parse(raw??'[]'));
    return {orgId:z.uuid().parse(env.QUADMINDS_ORG_ID),apiKey:z.string().min(1).max(4096).regex(/^[^\r\n]+$/).parse(env.QUADMINDS_API_KEY),
      webhookSecret:env.QUADMINDS_WEBHOOK_SECRET||null,proofHosts:(env.QUADMINDS_PROOF_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(s=>/^[a-z0-9.-]+$/.test(s)),
      deliveredCodes:codes(env.QUADMINDS_DELIVERED_CODES),failedCodes:codes(env.QUADMINDS_FAILED_CODES),
      constraints:z.array(z.object({id:z.number().int().positive(),source:z.enum(['WEIGHT_KG','VOLUME_M3','UNITS'])})).parse(JSON.parse(env.QUADMINDS_CONSTRAINTS??'[]'))};
  }catch{return null;}
}
export function verifyQuadSignature(body:Buffer,signature:unknown,secret:string) {
  if(typeof signature!=='string'||!secret)return false;
  const expected=createHmac('sha256',secret).update(body).digest();
  const received=Buffer.from(signature,'base64');
  return expected.length===received.length&&timingSafeEqual(expected,received);
}
export async function limitedBody(response:Response,max:number) {
  ensure(response.body,'QUADMINDS_INVALID_RESPONSE','El proveedor devolvió una respuesta vacía.',502);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;ensure(size<=max,'QUADMINDS_INVALID_RESPONSE','La respuesta del proveedor excede el límite.',502);chunks.push(part.value);}}
  finally {await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
export class QuadOperations {
  readonly domain:Logistics;
  readonly store:Database;
  readonly config:OperationsConfig|null;
  readonly request:typeof fetch;
  readonly proofDownload:(url:string,hosts:string[])=>Promise<DownloadedProof>;
  constructor(store:Database,config:OperationsConfig|null=loadOperationsConfig(),request:typeof fetch=fetch,proofDownload=downloadQuadProof){this.store=store;this.config=config;this.request=request;this.proofDownload=proofDownload;this.domain=new Logistics(store);}
  private configured(actor:Actor){ensure(this.config&&this.config.orgId===actor.orgId,'INTEGRATION_NOT_CONFIGURED','Falta habilitar la cuenta y las credenciales de QuadMinds.',503);return this.config;}
  async status(actor:Actor){authorize(actor,['ADMIN','OPERATIONS']);return {provider:'QUADMINDS',configured:!!this.config&&this.config.orgId===actor.orgId,
    message:'Las órdenes se planifican y publican en QuadMinds. La app del chofer registra GPS, foto y firma.',
    proofDownloadsConfigured:!!this.config?.proofHosts.length,statusMappingConfigured:!!this.config?.deliveredCodes.length&&!!this.config?.failedCodes.length,
    parcels:(await this.store.all('SELECT q.*,p.code AS parcel_code,s.reference FROM quad_parcel_links q JOIN parcels p ON p.id=q.parcel_id JOIN shipments s ON s.id=p.shipment_id WHERE q.org_id=? ORDER BY q.updated_at DESC LIMIT 500',actor.orgId)).map(({payload:_payload,...row})=>camel(row)),
    routes:(await this.store.all('SELECT org_id,route_id,external_route_id,synced_at,error_code FROM quad_route_links WHERE org_id=?',actor.orgId)).map(camel),
    events:(await this.store.all('SELECT id,event_type,external_code,received_at,processed_at,state FROM quad_webhook_events WHERE org_id=? ORDER BY received_at DESC LIMIT 100',actor.orgId)).map(camel)};}
  async queue(actor:Actor,shipmentId:string,input:unknown){
    const b=z.object({...command,poiId:z.number().int().positive(),date:day}).parse(input);
    return this.domain.command(actor,`quad.shipments.${shipmentId}.queue`,b,['ADMIN','OPERATIONS'],async()=>{
      await this.domain.record('shipments',shipmentId,actor);
      const inventoryOrder=await this.store.one('SELECT * FROM inventory_orders WHERE org_id=? AND shipment_id=?',actor.orgId,shipmentId);
      if(inventoryOrder)ensure(inventoryOrder.order_date===b.date,'VALIDATION_ERROR','La fecha de QuadMinds debe coincidir con la fecha del pedido.',400);
      const parcels=await this.store.all('SELECT * FROM parcels WHERE shipment_id=? AND org_id=? ORDER BY code',shipmentId,actor.orgId);
      ensure(parcels.length,'VALIDATION_ERROR','El pedido todavía no tiene unidades preparadas.',400);
      for(const p of parcels){
        ensure(['RECEIVED','RETURNED_TO_DEPOT'].includes(p.state),'INVALID_TRANSITION','Reservá y prepará las unidades antes de enviar el pedido.');
        const previous=await this.store.one('SELECT * FROM quad_parcel_links WHERE org_id=? AND parcel_id=?',actor.orgId,p.id);
        if(previous){ensure(previous.poi_id===b.poiId&&previous.delivery_date===b.date,'INVALID_TRANSITION','La orden ya está vinculada a otro destino o fecha.');continue;}
        const code='NX-'+p.id.replaceAll('-','');
        const measures=(this.config?.constraints??[]).map(c=>({constraintId:c.id,value:c.source==='UNITS'?1:c.source==='WEIGHT_KG'?p.weight_grams/1000:p.volume_cm3/1_000_000}));
        ensure(!measures.length||p.weight_grams&&p.volume_cm3,'VALIDATION_ERROR','Completá peso y volumen antes de planificar.',400);
        const payload={poiId:b.poiId,code,date:b.date,operation:'PEDIDO',...(inventoryOrder?.window_start&&inventoryOrder.window_end?{timeWindow:[{from:inventoryOrder.window_start,to:inventoryOrder.window_end}]}:{}),...(measures.length?{orderMeasures:measures}:{})};
        await this.store.run('INSERT INTO quad_parcel_links(org_id,parcel_id,external_code,poi_id,delivery_date,payload,state,updated_at) VALUES(?,?,?,?,?,?,?,?)',actor.orgId,p.id,code,b.poiId,b.date,JSON.stringify(payload),'QUEUED',now());
      }
      return {id:shipmentId,queued:parcels.length};
    });
  }
  async bindParcel(actor:Actor,parcelId:string,input:unknown){
    const b=z.object({...command,externalCode:z.string().trim().min(1).max(40),externalOrderId:text,poiId:z.number().int().positive(),date:day}).parse(input);
    return this.domain.command(actor,`quad.parcels.${parcelId}.bind`,b,['ADMIN','OPERATIONS'],async()=>{
      const p=await this.domain.parcel(parcelId,actor);
      ensure(!['DELIVERED','RETURNED_TO_SENDER'].includes(p.state),'INVALID_TRANSITION','La unidad ya está cerrada.');
      const prior=await this.store.one('SELECT * FROM quad_parcel_links WHERE org_id=? AND parcel_id=?',actor.orgId,parcelId);
      ensure(!prior||prior.external_code===b.externalCode&&prior.external_order_id===b.externalOrderId,'INVALID_TRANSITION','La vinculación externa ya existe.');
      if(!prior)await this.store.run("INSERT INTO quad_parcel_links(org_id,parcel_id,external_code,external_order_id,poi_id,delivery_date,payload,state,updated_at) VALUES(?,?,?,?,?,?,?,'EXPORTED',?)",actor.orgId,parcelId,b.externalCode,b.externalOrderId,b.poiId,b.date,'{}',now());
      return {id:parcelId};
    });
  }
  private async api(config:OperationsConfig,path:string,body?:unknown){
    const response=await this.request('https://saas.quadminds.com/api/v2'+path,{method:body?'POST':'GET',headers:{'x-saas-apikey':config.apiKey,'Accept':'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
    ensure(response.ok,'QUADMINDS_PROVIDER_ERROR','QuadMinds no aceptó la operación. Revisá la cuenta y reintentá.',502);
    let result:any;try{result=JSON.parse((await limitedBody(response,4_000_000)).toString('utf8'));}catch{throw new DomainError('QUADMINDS_INVALID_RESPONSE','La respuesta de QuadMinds no es válida.',502);}
    const errors=result.meta?.errors??result.meta?.error;
    ensure(errors==null||Array.isArray(errors)&&errors.length===0,'QUADMINDS_PROVIDER_ERROR','QuadMinds informó errores de validación.',502);return result;
  }
  async process(actor:Actor,limit=10){
    authorize(actor,['ADMIN','OPERATIONS']);const config=this.configured(actor);const results:Row[]=[];
    for(let n=0;n<Math.min(20,Math.max(1,limit));n++){
      const job=await this.store.transaction(async()=>{
        const j=await this.store.one("SELECT * FROM quad_parcel_links WHERE org_id=? AND (state IN('QUEUED','ERROR') OR (state='PROCESSING' AND lease_until<?)) ORDER BY attempts,updated_at LIMIT 1",actor.orgId,now());
        if(!j||results.some(r=>r.id===j.parcel_id))return null;
        await this.store.run("UPDATE quad_parcel_links SET state='PROCESSING',attempts=attempts+1,lease_until=?,error_code=NULL WHERE org_id=? AND parcel_id=?",new Date(Date.now()+60000).toISOString(),actor.orgId,j.parcel_id);return j;
      });
      if(!job)break;
      try{
        const found=await this.api(config,'/orders/search?code='+encodeURIComponent(job.external_code)+'&limit=2&offset=0');
        ensure(Array.isArray(found.data),'QUADMINDS_INVALID_RESPONSE','Formato de órdenes no reconocido.',502);
        let entries=found.data.filter((r:Row)=>r.code===job.external_code);
        if(!entries.length){
          const parcel=await this.store.one('SELECT * FROM parcels WHERE id=? AND org_id=?',job.parcel_id,actor.orgId);
          ensure(parcel&&['RECEIVED','RETURNED_TO_DEPOT','LOADED','IN_TRANSIT'].includes(parcel.state),'INVALID_TRANSITION','La unidad ya no está disponible para enviar a QuadMinds.');
          const payload=JSON.parse(job.payload);
          if(config.constraints.length){
            ensure(parcel.weight_grams&&parcel.volume_cm3,'VALIDATION_ERROR','Completá peso y volumen antes de planificar.',400);
            payload.orderMeasures=config.constraints.map(c=>({constraintId:c.id,value:c.source==='UNITS'?1:c.source==='WEIGHT_KG'?parcel.weight_grams/1000:parcel.volume_cm3/1_000_000}));
          }
          const created=await this.api(config,'/orders',[payload]);ensure(Array.isArray(created.data),'QUADMINDS_INVALID_RESPONSE','QuadMinds no confirmó las órdenes.',502);entries=created.data.filter((r:Row)=>r.code===job.external_code);
        }
        ensure(entries.length===1&&externalId(entries[0]._id??entries[0].id),'QUADMINDS_INVALID_RESPONSE','No se recibió un identificador único de la orden.',502);
        ensure(entries[0].poiId===job.poi_id&&String(entries[0].date).slice(0,10)===job.delivery_date,'QUADMINDS_INVALID_RESPONSE','La orden encontrada no coincide con el destino y fecha.',502);
        const saved=await this.store.transaction(()=>this.store.run("UPDATE quad_parcel_links SET state='EXPORTED',external_order_id=?,lease_until=NULL,error_code=NULL,updated_at=? WHERE org_id=? AND parcel_id=? AND state='PROCESSING' AND attempts=?",externalId(entries[0]._id??entries[0].id),now(),actor.orgId,job.parcel_id,job.attempts+1));results.push({id:job.parcel_id,state:Number(saved.changes)?'EXPORTED':'CLAIM_EXPIRED'});
      }catch(error){const code=error instanceof DomainError?error.code:'QUADMINDS_PROVIDER_ERROR';const saved=await this.store.transaction(()=>this.store.run("UPDATE quad_parcel_links SET state='ERROR',lease_until=NULL,error_code=?,updated_at=? WHERE org_id=? AND parcel_id=? AND state='PROCESSING' AND attempts=?",code,now(),actor.orgId,job.parcel_id,job.attempts+1));results.push({id:job.parcel_id,state:Number(saved.changes)?'ERROR':'CLAIM_EXPIRED',code});}
    }return {results};
  }
  async bindRoute(actor:Actor,routeId:string,input:unknown){
    const b=z.object({...command,externalRouteId:text}).parse(input);
    return this.domain.command(actor,`quad.routes.${routeId}.bind`,b,['ADMIN','OPERATIONS'],async()=>{
      await this.domain.route(routeId,actor);const old=await this.store.one('SELECT * FROM quad_route_links WHERE org_id=? AND route_id=?',actor.orgId,routeId);
      ensure(!old||old.external_route_id===b.externalRouteId,'INVALID_TRANSITION','La ruta ya está vinculada a otra ruta externa.');
      if(!old)await this.store.run('INSERT INTO quad_route_links(org_id,route_id,external_route_id) VALUES(?,?,?)',actor.orgId,routeId,b.externalRouteId);
      return {id:routeId};
    });
  }
  async webhook(raw:Buffer,signature:unknown){
    const config=this.config;ensure(config?.webhookSecret,'INTEGRATION_NOT_CONFIGURED','La recepción de eventos no está habilitada.',503);
    ensure(verifyQuadSignature(raw,signature,config.webhookSecret),'FORBIDDEN','Firma de evento inválida.',401);
    let parsed:unknown;try{parsed=JSON.parse(raw.toString('utf8'));}catch{throw new DomainError('VALIDATION_ERROR','El evento JSON no es válido.',400);}
    const event=z.object({event:z.enum(['tracking.routestarted','tracking.encamino','tracking.cerca','tracking.entregado','tracking.fallido']),code:z.string().min(1).max(40),route:z.object({id:z.union([z.string(),z.number()])}).optional()}).passthrough().parse(parsed);
    return this.store.transaction(async()=>{
      const bodyHash=hash(raw),prior=await this.store.one('SELECT id,state FROM quad_webhook_events WHERE org_id=? AND body_hash=?',config.orgId,bodyHash);if(prior)return {id:prior.id,duplicate:true,state:prior.state};
      const id=randomUUID(),link=await this.store.one('SELECT * FROM quad_parcel_links WHERE org_id=? AND external_code=?',config.orgId,event.code);
      await this.store.run('INSERT INTO quad_webhook_events(id,org_id,body_hash,event_type,external_code,payload,received_at,state) VALUES(?,?,?,?,?,?,?,?)',id,config.orgId,bodyHash,event.event,event.code,JSON.stringify(event),now(),link?'REPORTED':'UNMATCHED');
      // Event payload has no photo/signature. It informs an outcome; it cannot certify an inventory delivery.
      if(link&&['tracking.entregado','tracking.fallido'].includes(event.event)){
        const result=event.event==='tracking.entregado'?'DELIVERED':'FAILED';
        ensure(link.provider_result==='PENDING'||link.provider_result===result,'INVALID_TRANSITION','El evento contradice un resultado previo; requiere conciliación.');
        await this.store.run('UPDATE quad_parcel_links SET provider_result=?,evidence_state=?,updated_at=? WHERE org_id=? AND parcel_id=?',result,result==='DELIVERED'&&link.evidence_state!=='COMPLETE'?'MISSING':link.evidence_state,now(),config.orgId,link.parcel_id);
      }return {id,state:link?'REPORTED':'UNMATCHED'};
    });
  }
  private async downloadProof(config:OperationsConfig,url:string){
    return this.proofDownload(url,config.proofHosts);
  }
  async saveProof(actor:Actor,parcelId:string,kind:'PHOTO'|'SIGNATURE',url:string){
    const config=this.configured(actor),sourceHash=hash(url);
    const old=await this.store.one('SELECT evidence_id FROM quad_proofs WHERE org_id=? AND parcel_id=? AND kind=? AND source_hash=?',actor.orgId,parcelId,kind,sourceHash);if(old)return old.evidence_id as string;
    const image=await this.downloadProof(config,url);
    return this.store.transaction(async()=>{
      const duplicate=await this.store.one('SELECT evidence_id FROM quad_proofs WHERE org_id=? AND parcel_id=? AND kind=? AND source_hash=?',actor.orgId,parcelId,kind,sourceHash);if(duplicate)return duplicate.evidence_id as string;
      const evidence=await this.domain.upload(actor,{commandId:randomUUID(),parcelId,filename:kind==='PHOTO'?'quadminds-foto':'quadminds-firma',...image});
      await this.store.run('INSERT INTO quad_proofs(id,org_id,parcel_id,kind,evidence_id,source_hash,created_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),actor.orgId,parcelId,kind,evidence.id,sourceHash,now());return evidence.id as string;
    });
  }
  async proofs(actor:Actor,shipmentId:string){
    authorize(actor,['ADMIN','OPERATIONS','DEPOT','CUSTOMER']);const s=await this.domain.record('shipments',shipmentId,actor);
    if(actor.role==='CUSTOMER')ensure(actor.clientId===s.client_id,'NOT_FOUND','Pedido no encontrado.',404);
    return {items:(await this.store.all('SELECT p.id AS parcel_id,q.provider_result,q.evidence_state,q.reported_at,q.receiver_name,e.kind,e.evidence_id FROM parcels p LEFT JOIN quad_parcel_links q ON q.parcel_id=p.id AND q.org_id=p.org_id LEFT JOIN quad_proofs e ON e.parcel_id=p.id AND e.org_id=p.org_id WHERE p.org_id=? AND p.shipment_id=? ORDER BY p.code',actor.orgId,shipmentId)).map(camel)};
  }
  async syncRoute(actor:Actor,routeId:string,applySequence=false){
    authorize(actor,['ADMIN','OPERATIONS']);const config=this.configured(actor),binding=await this.store.one('SELECT * FROM quad_route_links WHERE org_id=? AND route_id=?',actor.orgId,routeId);
    ensure(binding,'VALIDATION_ERROR','Vinculá primero la ruta publicada en QuadMinds.',400);
    if(applySequence){const route=await this.domain.route(routeId,actor);ensure(route.state==='DRAFT','INVALID_TRANSITION','Aplicá la secuencia antes de confirmar la carga.');ensure(!await this.store.one("SELECT id FROM stops WHERE route_id=? AND kind='PICKUP'",routeId),'INVALID_TRANSITION','La importación de secuencia corresponde a rutas de entrega desde depósito. Los retiros requieren revisar su precedencia.');}
    try{
      const response=await this.api(config,'/consolidated-routes/'+encodeURIComponent(binding.external_route_id));const data=response.data;
      ensure(data&&Array.isArray(data.waypoints),'QUADMINDS_INVALID_RESPONSE','La ruta no contiene paradas reconocidas.',502);
      const waypoints=z.array(z.object({visitOrder:z.number().int(),activities:z.object({orders:z.array(z.object({_id:z.union([z.string(),z.number()])}).passthrough()).optional()}).passthrough().optional(),status:z.object({code:z.number().optional(),certifiedAt:z.string().optional(),signature:z.object({fullUrl:z.string().optional(),signatureName:z.string().optional()}).optional(),photos:z.array(z.object({fullUrl:z.string().optional()})).optional()}).passthrough().optional()}).passthrough()).max(2000).parse(data.waypoints).sort((a,b)=>a.visitOrder-b.visitOrder);
      const linked=await this.store.all('SELECT q.*,p.shipment_id FROM quad_parcel_links q JOIN parcels p ON p.id=q.parcel_id JOIN route_assignments a ON a.parcel_id=p.id AND a.active=1 WHERE q.org_id=? AND a.route_id=?',actor.orgId,routeId);
      const planned:string[]=[],outcomes:Row[]=[];const unknown:string[]=[];
      for(const w of waypoints){for(const order of w.activities?.orders??[]){const link=linked.find(l=>l.external_order_id===String(order._id));if(!link){unknown.push(String(order._id));continue;}
        planned.push(link.shipment_id);const status=w.status;
        const result=status?.code!==undefined&&config.deliveredCodes.includes(status.code)?'DELIVERED':status?.code!==undefined&&config.failedCodes.includes(status.code)?'FAILED':link.provider_result;
        if(result==='PENDING')continue;
        if(link.provider_result!=='PENDING'&&link.provider_result!==result){outcomes.push({parcelId:link.parcel_id,error:'QUADMINDS_RESULT_CONFLICT'});continue;}
        const when=status?.certifiedAt?timestamp.safeParse(status.certifiedAt):null;
        const outcome:Row={parcelId:link.parcel_id,result,evidenceState:'MISSING'};
        const certifiedAt=when?.success&&Date.parse(when.data)<=Date.now()+60000?new Date(when.data).toISOString():null;
        await this.store.transaction(()=>this.store.run('UPDATE quad_parcel_links SET provider_result=?,reported_at=COALESCE(?,reported_at),updated_at=? WHERE org_id=? AND parcel_id=?',result,certifiedAt,now(),actor.orgId,link.parcel_id));
        if(result==='DELIVERED'){
          try{const photo=status?.photos?.find(p=>p.fullUrl)?.fullUrl,signature=status?.signature?.fullUrl;
            ensure(photo&&signature,'QUADMINDS_PROOF_UNAVAILABLE','Faltan foto y firma de la entrega.',502);
            const photoId=await this.saveProof(actor,link.parcel_id,'PHOTO',photo),signatureId=await this.saveProof(actor,link.parcel_id,'SIGNATURE',signature);
            const photoFile=await this.store.one('SELECT sha256 FROM evidence WHERE id=? AND org_id=?',photoId,actor.orgId),signatureFile=await this.store.one('SELECT sha256 FROM evidence WHERE id=? AND org_id=?',signatureId,actor.orgId);
            ensure(photoFile?.sha256!==signatureFile?.sha256&&status?.signature?.signatureName?.trim(),'QUADMINDS_PROOF_UNAVAILABLE','Falta identificar al receptor o la foto y firma son iguales.',502);
            await this.store.transaction(()=>this.store.run("UPDATE quad_parcel_links SET evidence_state='COMPLETE',receiver_name=? WHERE org_id=? AND parcel_id=?",status?.signature?.signatureName??'',actor.orgId,link.parcel_id));outcome.evidenceState='COMPLETE';
          }catch(error){outcome.error=error instanceof DomainError?error.code:'QUADMINDS_PROOF_UNAVAILABLE';await this.store.transaction(()=>this.store.run("UPDATE quad_parcel_links SET evidence_state='MISSING' WHERE org_id=? AND parcel_id=?",actor.orgId,link.parcel_id));}
        }
        outcomes.push(outcome);
      }}
      if(applySequence){await this.store.transaction(async()=>{
        ensure(!unknown.length,'VALIDATION_ERROR','Hay órdenes externas sin vincular; revisá la ruta antes de aplicar el orden.',400);
        const route=await this.domain.route(routeId,actor),stops=await this.store.all("SELECT * FROM stops WHERE route_id=? AND kind='DELIVERY' ORDER BY sequence",routeId);
        ensure(stops.length>0&&stops.every(s=>planned.includes(s.shipment_id)),'VALIDATION_ERROR','La ruta externa no cubre todas las paradas locales.',400);
        const ids=[...new Set(planned)].map(shipmentId=>stops.find(s=>s.shipment_id===shipmentId)?.id).filter(Boolean);
        await this.domain.reorder(actor,routeId,{commandId:randomUUID(),expectedVersion:route.version,stopIds:ids});
      });}
      await this.store.transaction(()=>this.store.run('UPDATE quad_route_links SET snapshot=?,synced_at=?,error_code=NULL WHERE org_id=? AND route_id=?',JSON.stringify({code:data.code,status:data.status,optimized:data.optimized,unknown,planned}),now(),actor.orgId,routeId));
      const reconciled=await this.reconcile(actor,routeId);return {id:routeId,outcomes,unknown,reconciled,sequenceApplied:applySequence};
    }catch(error){await this.store.transaction(()=>this.store.run('UPDATE quad_route_links SET error_code=? WHERE org_id=? AND route_id=?',error instanceof DomainError?error.code:'QUADMINDS_INVALID_RESPONSE',actor.orgId,routeId));throw error;}
  }
  async reconcile(actor:Actor,routeId:string){
    const route=await this.domain.route(routeId,actor);const applied:Row[]=[];if(route.state!=='IN_PROGRESS')return {applied,pending:'La ruta local debe estar despachada para aplicar resultados.'};
    for(const stop of await this.store.all("SELECT * FROM stops WHERE route_id=? AND kind='DELIVERY' ORDER BY sequence",routeId)){
      const rows=await this.store.all("SELECT q.*,p.state FROM quad_parcel_links q JOIN parcels p ON p.id=q.parcel_id JOIN route_assignments a ON a.parcel_id=p.id AND a.active=1 WHERE q.org_id=? AND a.route_id=? AND p.shipment_id=? AND p.state='IN_TRANSIT'",actor.orgId,routeId,stop.shipment_id);
      for(const row of rows){
        if(row.provider_result==='PENDING'||row.provider_result==='DELIVERED'&&row.evidence_state!=='COMPLETE')continue;
        const proofs=await this.store.all('SELECT evidence_id FROM quad_proofs WHERE org_id=? AND parcel_id=?',actor.orgId,row.parcel_id);
        const current=await this.domain.route(routeId,actor);
        try{
          const result=await this.domain.attempt(actor,stop.id,{commandId:randomUUID(),expectedVersion:current.version,deliveredParcelIds:row.provider_result==='DELIVERED'?[row.parcel_id]:[],failedParcelIds:row.provider_result==='FAILED'?[row.parcel_id]:[],receiverName:row.receiver_name,evidenceIds:proofs.map(p=>p.evidence_id),reasonCode:row.provider_result==='FAILED'?'OTHER':'',nextAction:row.provider_result==='FAILED'?'Conciliar el motivo registrado en QuadMinds y autorizar el retorno.':''});applied.push(result);
        }catch(error){if(error instanceof DomainError){applied.push({parcelId:row.parcel_id,pending:true,code:error.code});}else throw error;}
      }
    }return {applied};
  }
}
