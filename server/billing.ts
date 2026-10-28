import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Express,Request} from 'express';
import type {Database,Row} from './database.ts';
import {authorize,type Actor} from './auth.ts';
import {Logistics} from './domain.ts';
import {ensure} from './errors.ts';

const text=(max:number)=>z.string().trim().max(max);
const date=z.iso.date();
const ruc=text(20).refine(v=>v===''||/^\d{1,8}-\d$/.test(v),'Ingresá el RUC con guion y dígito verificador.');
export const issuerSchema=z.object({legalName:text(500),taxId:ruc,address:text(500),email:z.union([z.literal(''),z.email()]),
 phone:text(80),activityCode:text(20),activityName:text(300),establishment:z.string().regex(/^\d{3}$/),point:z.string().regex(/^\d{3}$/),
 timbrado:z.union([z.literal(''),z.string().regex(/^\d{8}$/)]),timbradoDate:z.union([z.literal(''),date]),
 route:z.enum(['UNDECIDED','SIFEN','PROVIDER','EKUATIAI']),providerName:text(200)}).strict();
export const emptyIssuer={legalName:'',taxId:'',address:'',email:'',phone:'',activityCode:'',activityName:'',establishment:'001',point:'001',timbrado:'',timbradoDate:'',route:'UNDECIDED' as const,providerName:''};
const lineSchema=z.object({description:text(500).min(1),quantity:z.number().int().min(1).max(1000000),unitPrice:z.number().int().min(1).max(10000000000),vatRate:z.union([z.literal(0),z.literal(5),z.literal(10)]),shipmentId:z.uuid().nullable().default(null)}).strict();
export const documentSchema=z.object({clientId:z.uuid(),serviceDate:date,dueDate:date.nullable(),condition:z.enum(['CASH','CREDIT']),notes:text(2000),lines:z.array(lineSchema).min(1).max(100)}).strict();
export type BillingInput=z.infer<typeof documentSchema>;
const command=z.object({commandId:z.uuid()});
const revision=z.number().int().min(1).max(1000000000);
// Internal PYG proformas: integer prices include IVA, rounded half-up per tax bucket.
// The fiscal adapter must reconcile these totals against the active SIFEN rules before issuance.
export function calculateBilling(input:unknown){
 const lines=z.array(lineSchema).min(1).max(100).parse(input);
 const buckets=new Map<number,bigint>([[0,0n],[5,0n],[10,0n]]);
 const computed=lines.map(line=>{const total=BigInt(line.quantity)*BigInt(line.unitPrice);buckets.set(line.vatRate,buckets.get(line.vatRate)!+total);return {...line,total:Number(total)};});
 const gross=[...buckets.values()].reduce((a,b)=>a+b,0n);
 ensure(gross<=999999999999n,'VALIDATION_ERROR','El total supera el límite de 999.999.999.999 Gs.',400);
 const vat5=(buckets.get(5)!+10n)/21n,vat10=(buckets.get(10)!+5n)/11n;
 return {lines:computed,total:Number(gross),vat5:Number(vat5),vat10:Number(vat10),exempt:Number(buckets.get(0)!),taxable5:Number(buckets.get(5)!-vat5),taxable10:Number(buckets.get(10)!-vat10)};
}
function decode(row:Row){return {id:row.id,clientId:row.client_id,reference:row.reference,state:row.state,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,...JSON.parse(row.data)};}
export class Billing {
 private store:Database;
 constructor(store:Database){this.store=store;}
 async issuer(actor:Actor){authorize(actor,['ADMIN']);const row=await this.store.one('SELECT data,revision FROM billing_issuers WHERE org_id=?',actor.orgId);return {data:row?JSON.parse(row.data):emptyIssuer,revision:row?.revision??0};}
 async saveIssuer(actor:Actor,input:unknown){
  const body=command.extend({revision:z.number().int().min(0),data:issuerSchema}).strict().parse(input);
  return new Logistics(this.store).command(actor,'billing.issuer.save',body,['ADMIN'],async()=>{
   const old=await this.issuer(actor);ensure(old.revision===body.revision,'VERSION_CONFLICT','Los datos del emisor cambiaron. Actualizá antes de guardar.');
   await this.store.run('INSERT INTO billing_issuers(org_id,data,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at',actor.orgId,JSON.stringify(body.data),old.revision+1,new Date().toISOString());
   return {id:actor.orgId,revision:old.revision+1};
  });
 }
 async list(actor:Actor,offset=0){authorize(actor,['ADMIN']);ensure(Number.isInteger(offset)&&offset>=0&&offset<=1000000,'VALIDATION_ERROR','Paginación inválida.',400);return {items:(await this.store.all('SELECT * FROM billing_documents WHERE org_id=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?',actor.orgId,offset)).map(decode)};}
 async read(actor:Actor,id:string){authorize(actor,['ADMIN']);const row=await this.store.one('SELECT * FROM billing_documents WHERE org_id=? AND id=?',actor.orgId,id);ensure(row,'NOT_FOUND','Proforma no encontrada.',404);return decode(row);}
 async candidates(actor:Actor,clientId:string){
  authorize(actor,['ADMIN']);z.uuid().parse(clientId);
  return this.store.all(`SELECT s.id,s.reference,s.destination_text FROM shipments s WHERE s.org_id=? AND s.client_id=?
   AND EXISTS(SELECT 1 FROM parcels p WHERE p.shipment_id=s.id AND p.org_id=s.org_id AND NOT EXISTS(SELECT 1 FROM inventory_movements m WHERE m.org_id=p.org_id AND m.parcel_id=p.id AND m.action='RELEASE' AND m.from_status='RESERVED'))
   AND NOT EXISTS(SELECT 1 FROM parcels p WHERE p.shipment_id=s.id AND p.org_id=s.org_id AND p.state<>'DELIVERED' AND NOT EXISTS(SELECT 1 FROM inventory_movements m WHERE m.org_id=p.org_id AND m.parcel_id=p.id AND m.action='RELEASE' AND m.from_status='RESERVED'))
   AND NOT EXISTS(SELECT 1 FROM billing_shipment_links b WHERE b.org_id=s.org_id AND b.shipment_id=s.id AND b.active=1)
   ORDER BY s.created_at DESC,s.id LIMIT 200`,actor.orgId,clientId);
 }
 async snapshots(actor:Actor,b:BillingInput,requireIssuer=false){
  ensure(b.condition!=='CREDIT'||!!b.dueDate,'VALIDATION_ERROR','Indicá vencimiento para ventas a crédito.',400);
  ensure(!b.dueDate||b.dueDate>=b.serviceDate,'VALIDATION_ERROR','El vencimiento no puede ser anterior al servicio.',400);
  const client=await this.store.one('SELECT c.name,p.legal_name,p.tax_id,p.address,p.email FROM clients c LEFT JOIN client_profiles p ON p.org_id=c.org_id AND p.client_id=c.id WHERE c.org_id=? AND c.id=?',actor.orgId,b.clientId);
  ensure(client,'NOT_FOUND','Cliente no encontrado.',404);
  ensure(client.legal_name&&/^\d{1,8}-\d$/.test(client.tax_id??'')&&client.address,'VALIDATION_ERROR','Completá razón social, RUC con dígito verificador y dirección en la ficha del cliente.',400);
  const issuer=await this.issuer(actor);
  if(requireIssuer)ensure(issuer.data.legalName&&issuer.data.taxId&&issuer.data.address,'VALIDATION_ERROR','Completá razón social, RUC y dirección de Nexora en Datos del emisor.',400);
  return {customer:{name:client.name,legalName:client.legal_name,taxId:client.tax_id,address:client.address,email:client.email??''},issuer:issuer.data};
 }
 async reserve(actor:Actor,id:string,b:BillingInput){
  const ids=b.lines.flatMap(l=>l.shipmentId?[l.shipmentId]:[]);
  ensure(new Set(ids).size===ids.length,'VALIDATION_ERROR','Un envío solo puede aparecer una vez en la proforma.',400);
  await this.store.run('DELETE FROM billing_shipment_links WHERE org_id=? AND document_id=?',actor.orgId,id);
  for(const shipmentId of ids){
   const shipment=await this.store.one('SELECT id FROM shipments WHERE id=? AND org_id=? AND client_id=?',shipmentId,actor.orgId,b.clientId);
   ensure(shipment,'VALIDATION_ERROR','El envío no pertenece al cliente elegido.',400);
   ensure(await this.store.one("SELECT p.id FROM parcels p WHERE p.org_id=? AND p.shipment_id=? AND NOT EXISTS(SELECT 1 FROM inventory_movements m WHERE m.org_id=p.org_id AND m.parcel_id=p.id AND m.action='RELEASE' AND m.from_status='RESERVED')",actor.orgId,shipmentId)&&!await this.store.one("SELECT p.id FROM parcels p WHERE p.org_id=? AND p.shipment_id=? AND p.state<>'DELIVERED' AND NOT EXISTS(SELECT 1 FROM inventory_movements m WHERE m.org_id=p.org_id AND m.parcel_id=p.id AND m.action='RELEASE' AND m.from_status='RESERVED')",actor.orgId,shipmentId),'INVALID_TRANSITION','Solo podés incluir envíos entregados por completo.');
   ensure(!await this.store.one('SELECT document_id FROM billing_shipment_links WHERE org_id=? AND shipment_id=? AND active=1',actor.orgId,shipmentId),'INVALID_TRANSITION','Ese envío ya está incluido en otra proforma vigente.');
   await this.store.run('INSERT INTO billing_shipment_links(org_id,document_id,shipment_id,active) VALUES(?,?,?,1)',actor.orgId,id,shipmentId);
  }
 }
 async save(actor:Actor,id:string|null,input:unknown){
  const body=command.extend({revision:z.number().int().min(0),data:documentSchema}).strict().parse(input),b=body.data;
  return new Logistics(this.store).command(actor,`billing.${id??'new'}.save`,body,['ADMIN'],async()=>{
   const old=id?await this.read(actor,id):null;
   ensure(old?old.state==='DRAFT'&&old.revision===body.revision:body.revision===0,'VERSION_CONFLICT','La proforma cambió o ya fue confirmada. Actualizá la lista.');
   const data={...b,...calculateBilling(b.lines),...await this.snapshots(actor,b)},documentId=id??randomUUID(),now=new Date().toISOString();
   if(old)await this.store.run('UPDATE billing_documents SET client_id=?,data=?,total=?,revision=revision+1,updated_at=? WHERE org_id=? AND id=?',b.clientId,JSON.stringify(data),data.total,now,actor.orgId,id!);
   else {
    const count=await this.store.one('SELECT COUNT(*) AS n FROM billing_documents WHERE org_id=?',actor.orgId);
    await this.store.run("INSERT INTO billing_documents(id,org_id,client_id,reference,state,revision,data,total,created_at,updated_at) VALUES(?,?,?,?,'DRAFT',1,?,?,?,?)",documentId,actor.orgId,b.clientId,'PF-'+String(Number(count!.n)+1).padStart(6,'0'),JSON.stringify(data),data.total,now,now);
   }
   await this.reserve(actor,documentId,b);
   return {id:documentId,state:'DRAFT',revision:(old?.revision??0)+1};
  });
 }
 async transition(actor:Actor,id:string,input:unknown){
  const body=command.extend({revision,state:z.enum(['READY','VOID'])}).strict().parse(input);
  return new Logistics(this.store).command(actor,`billing.${id}.state`,body,['ADMIN'],async()=>{
   const old=await this.read(actor,id);ensure(old.revision===body.revision&&old.state!=='VOID'&&(body.state==='VOID'||old.state==='DRAFT'),'VERSION_CONFLICT','La proforma cambió. Actualizá la lista.');
   let data:unknown;
   if(body.state==='READY'){
    const b=documentSchema.parse({clientId:old.clientId,serviceDate:old.serviceDate,dueDate:old.dueDate,condition:old.condition,notes:old.notes,lines:old.lines.map(({total,...l}:Row)=>l)});
    data={...b,...calculateBilling(b.lines),...await this.snapshots(actor,b,true)};
    await this.reserve(actor,id,b);
   }else data=JSON.parse((await this.store.one('SELECT data FROM billing_documents WHERE org_id=? AND id=?',actor.orgId,id))!.data);
   await this.store.run('UPDATE billing_documents SET state=?,data=?,revision=revision+1,updated_at=? WHERE org_id=? AND id=?',body.state,JSON.stringify(data),new Date().toISOString(),actor.orgId,id);
   if(body.state==='VOID')await this.store.run('UPDATE billing_shipment_links SET active=0 WHERE org_id=? AND document_id=?',actor.orgId,id);
   return {id,state:body.state,revision:old.revision+1};
  });
 }
 readiness(){return {canIssue:false,stage:'PREPARATION',blockers:['Habilitación de Nexora como emisor electrónico y timbrado en Marangatu.','Certificado de firma electrónica y CSC, según la modalidad elegida.','Elegir e-Kuatia directo, un proveedor o e-Kuatia’i y completar su implementación.','Validar XML, firma, recepción y consulta, KuDE y eventos en pruebas antes de activar producción.']};}
}
export function installBillingRoutes(app:Express,store:Database,auth:(req:Request)=>Promise<Actor>){
 const billing=new Billing(store);
 app.get('/api/billing',async(req,res)=>{const actor=await auth(req);res.json({...await billing.list(actor,Number(req.query.offset??0)),issuer:await billing.issuer(actor),electronic:billing.readiness()});});
 app.get('/api/billing/candidates',async(req,res)=>res.json(await billing.candidates(await auth(req),String(req.query.clientId??''))));
 app.post('/api/billing/issuer',async(req,res)=>res.json(await billing.saveIssuer(await auth(req),req.body)));
 app.post('/api/billing/documents',async(req,res)=>res.status(201).json(await billing.save(await auth(req),null,req.body)));
 app.get('/api/billing/documents/:id',async(req,res)=>res.json(await billing.read(await auth(req),String(req.params.id))));
 app.post('/api/billing/documents/:id',async(req,res)=>res.json(await billing.save(await auth(req),String(req.params.id),req.body)));
 app.post('/api/billing/documents/:id/state',async(req,res)=>res.json(await billing.transition(await auth(req),String(req.params.id),req.body)));
 app.post('/api/billing/documents/:id/issue',async(req,res)=>{await billing.read(await auth(req),String(req.params.id));ensure(false,'INVALID_TRANSITION','La emisión electrónica todavía no está habilitada. La proforma no es un comprobante fiscal.',409);});
}
