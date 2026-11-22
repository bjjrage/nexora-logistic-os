import {createHash,randomUUID} from 'node:crypto';
import {Router,type Express,type Request} from 'express';
import {z} from 'zod';
import {actorFromRequest,authorize,type Actor} from './auth.ts';
import {camel} from './db.ts';
import type {Database,Row} from './database.ts';
import {DomainError,ensure} from './errors.ts';
import {Inventory,inventorySchemas} from './inventory.ts';

const uuid=z.uuid();
const nonEmpty=z.string().trim().min(1).max(500);
const submitSchema=z.object({
  commandId:uuid, externalId:nonEmpty.max(160),orderDate:z.iso.date(),
  destination:nonEmpty,recipientName:nonEmpty,
  recipientPhone:z.string().trim().max(80).default(''),
  restrictions:z.string().trim().max(1000).default(''),
  lines:z.array(z.object({productId:uuid,quantity:z.number().int().positive().max(200)}).strict()).min(1).max(200),
}).strict();
const commandSchema=z.object({commandId:uuid}).strict();
const rejectSchema=commandSchema.extend({reason:nonEmpty.max(500)}).strict();
const listSchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),
  offset:z.coerce.number().int().min(0).max(1000000).default(0)}).strict();
const opsListSchema=listSchema.extend({status:z.enum(['PENDING','ACCEPTED','REJECTED']).default('PENDING')}).strict();
const timestamp=()=>new Date().toISOString();
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>
  item&&typeof item==='object'&&!Array.isArray(item)
    ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const bodyHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');

export async function miniosReady(db:Database):Promise<boolean> {
  try {
    if(db.kind==='sqlite') {
      const row=await db.one("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type='table' AND name='customer_order_requests' AND EXISTS(SELECT 1 FROM schema_migrations WHERE version=27)");
      return Number(row?.total)===1;
    }
    const row=await db.one("SELECT COUNT(*) AS total FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND t.relname='customer_order_requests' AND t.relkind='r' AND row_security_active(t.oid) AND EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=t.oid AND p.polname='minios_organization') AND has_table_privilege(t.oid,'SELECT,INSERT,UPDATE')");
    return Number(row?.total)===1;
  } catch{return false;}
}

export class CustomerOrderIntake {
  private db:Database;
  private inventory:Inventory;
  constructor(db:Database){this.db=db;this.inventory=new Inventory(db);}

  private async scoped<T>(actor:Actor,work:()=>Promise<T>) {
    return this.db.transaction(async()=>{
      if(this.db.kind==='postgres')
        await this.db.one("SELECT set_config('nexora.minios_org_id', ?, true) AS tenant",actor.orgId);
      return work();
    });
  }
  private async request(actor:Actor,id:string) {
    const row=await this.db.one('SELECT * FROM customer_order_requests WHERE org_id=? AND id=?',actor.orgId,id);
    ensure(row,'NOT_FOUND','Solicitud no encontrada.',404);
    return row;
  }
  private customer(actor:Actor):string {
    ensure(actor.role==='CUSTOMER'&&actor.clientId,'FORBIDDEN','Se requiere una cuenta de comerciante activa.',403);
    return actor.clientId!;
  }
  private ops(actor:Actor) {authorize(actor,['ADMIN','OPERATIONS']);}
  private dto(row:Row) {
    const {payload_json:_data,body_hash:_hash,...visible}=row;
    return {...camel(visible),order:JSON.parse(row.payload_json)};
  }
  async submit(actor:Actor,input:z.output<typeof submitSchema>) {
    const clientId=this.customer(actor);
    return this.scoped(actor,async()=>{
      const account=await this.db.one('SELECT client_id FROM customer_accounts WHERE org_id=? AND id=? AND enabled=1',actor.orgId,actor.id);
      ensure(account?.client_id===clientId,'FORBIDDEN','La cuenta no pertenece al cliente autorizado.',403);
      const client=await this.db.one('SELECT archived_at FROM clients WHERE org_id=? AND id=?',actor.orgId,clientId);
      ensure(client&&!client.archived_at,'INVALID_TRANSITION','La cuenta comercial no está activa.',409);
      // Reutilizar el contrato de pedidos existente, sin permitir que el cliente elija clientId.
      const order=inventorySchemas.order.parse({...input,clientId,proofPolicy:'RECEIVER_PHOTO'});
      const payload={externalId:order.externalId,orderDate:order.orderDate,destination:order.destination,
        recipientName:order.recipientName,recipientPhone:order.recipientPhone,originText:order.originText,
        proofPolicy:order.proofPolicy,windowStart:order.windowStart,windowEnd:order.windowEnd,
        serviceMinutes:order.serviceMinutes,restrictions:order.restrictions,lines:order.lines};
      const digest=bodyHash(payload);
      const existing=await this.db.one('SELECT * FROM customer_order_requests WHERE org_id=? AND id=?',actor.orgId,input.commandId);
      if(existing) {
        ensure(existing.client_id===clientId&&existing.account_id===actor.id&&existing.body_hash===digest,
          'DUPLICATE_COMMAND','La clave ya fue usada con otros datos.',409);
        return {id:existing.id,status:existing.status,orderId:existing.order_id??null};
      }
      for(const line of order.lines) {
        const product=await this.db.one('SELECT id FROM inventory_products WHERE org_id=? AND client_id=? AND id=? AND active=1',
          actor.orgId,clientId,line.productId);
        ensure(product,'FORBIDDEN','El producto no está autorizado o no está activo.',403);
      }
      const duplicate=await this.db.one('SELECT id FROM customer_order_requests WHERE org_id=? AND client_id=? AND external_id=?',actor.orgId,clientId,order.externalId);
      ensure(!duplicate,'DUPLICATE_ORDER','Ya existe una solicitud con esa referencia.',409);
      const liveOrder=await this.db.one('SELECT id FROM inventory_orders WHERE org_id=? AND client_id=? AND external_id=?',actor.orgId,clientId,order.externalId);
      ensure(!liveOrder,'DUPLICATE_ORDER','Ya existe un pedido con esa referencia.',409);
      const time=timestamp();
      await this.db.run('INSERT INTO customer_order_requests (org_id,id,client_id,account_id,external_id,payload_json,body_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,\'PENDING\',?,?)',
        actor.orgId,input.commandId,clientId,actor.id,order.externalId,JSON.stringify(payload),digest,time,time);
      return {id:input.commandId,status:'PENDING',orderId:null};
    });
  }
  async mine(actor:Actor,query:z.output<typeof listSchema>) {
    const clientId=this.customer(actor);
    return this.scoped(actor,async()=>{
      const rows=await this.db.all('SELECT * FROM customer_order_requests WHERE org_id=? AND client_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?',
        actor.orgId,clientId,query.limit,query.offset);
      const count=await this.db.one('SELECT COUNT(*) AS total FROM customer_order_requests WHERE org_id=? AND client_id=?',actor.orgId,clientId);
      return {rows:rows.map(row=>this.dto(row)),total:Number(count?.total??0),...query};
    });
  }
  async queue(actor:Actor,query:z.output<typeof opsListSchema>) {
    this.ops(actor);
    return this.scoped(actor,async()=>{
      const rows=await this.db.all('SELECT r.*,c.name AS client_name FROM customer_order_requests r JOIN clients c ON c.id=r.client_id AND c.org_id=r.org_id WHERE r.org_id=? AND r.status=? ORDER BY r.created_at,r.id LIMIT ? OFFSET ?',
        actor.orgId,query.status,query.limit,query.offset);
      const count=await this.db.one('SELECT COUNT(*) AS total FROM customer_order_requests WHERE org_id=? AND status=?',actor.orgId,query.status);
      return {rows:rows.map(row=>this.dto(row)),total:Number(count?.total??0),...query};
    });
  }
  async accept(actor:Actor,id:string,_command:z.output<typeof commandSchema>) {
    this.ops(actor);
    return this.scoped(actor,async()=>{
      const source=await this.request(actor,id);
      if(source.status==='ACCEPTED')return {id,status:'ACCEPTED',orderId:source.order_id};
      ensure(source.status==='PENDING','INVALID_TRANSITION','La solicitud ya fue rechazada.',409);
      const order=JSON.parse(source.payload_json);
      // Crear el pedido con el servicio central de operaciones. No reservar, cargar ni despachar.
      const result=await this.inventory.createOrder(actor,{...order,clientId:source.client_id,commandId:source.id});
      const time=timestamp();
      const updated=await this.db.run("UPDATE customer_order_requests SET status='ACCEPTED',order_id=?,decided_by=?,decided_at=?,updated_at=? WHERE org_id=? AND id=? AND status='PENDING'",
        result.id,actor.id,time,time,actor.orgId,id);
      ensure(Number(updated.changes)===1,'VERSION_CONFLICT','La solicitud cambió mientras se aprobaba.',409);
      await this.db.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)',randomUUID(),actor.orgId,actor.id,'minios.order.accept',id,_command.commandId,JSON.stringify({orderId:result.id}),time);
      return {id,status:'ACCEPTED',orderId:result.id};
    });
  }
  async reject(actor:Actor,id:string,body:z.output<typeof rejectSchema>) {
    this.ops(actor);
    return this.scoped(actor,async()=>{
      const source=await this.request(actor,id);
      if(source.status==='REJECTED')return {id,status:'REJECTED'};
      ensure(source.status==='PENDING','INVALID_TRANSITION','La solicitud ya fue aceptada.',409);
      const time=timestamp();
      const updated=await this.db.run("UPDATE customer_order_requests SET status='REJECTED',rejection_reason=?,decided_by=?,decided_at=?,updated_at=? WHERE org_id=? AND id=? AND status='PENDING'",
        body.reason,actor.id,time,time,actor.orgId,id);
      ensure(Number(updated.changes)===1,'VERSION_CONFLICT','La solicitud cambió mientras se rechazaba.',409);
      await this.db.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)',randomUUID(),actor.orgId,actor.id,'minios.order.reject',id,body.commandId,JSON.stringify({reason:body.reason}),time);
      return {id,status:'REJECTED'};
    });
  }
}

export function installCustomerOrderIntake(app:Express,db:Database,auth:(req:Request)=>Promise<Actor>) {
  const customer=Router(),ops=Router(),service=new CustomerOrderIntake(db);
  const getCustomer=async(req:Request)=>{
    const actor=await actorFromRequest(db,req,'CUSTOMER');
    ensure(actor&&actor.role==='CUSTOMER'&&actor.clientId,'FORBIDDEN','Ingresá como comerciante.',401);
    return actor;
  };
  const ready=async()=>ensure(await miniosReady(db),'MINIOS_NOT_READY','Las solicitudes comerciales requieren migración verificada.',503);
  customer.get('/',async(req,res)=>{const a=await getCustomer(req);await ready();res.json(await service.mine(a,listSchema.parse(req.query)));});
  customer.post('/',async(req,res)=>{const a=await getCustomer(req);await ready();res.status(201).json(await service.submit(a,submitSchema.parse(req.body)));});
  ops.use(async(req,res,next)=>{const a=await auth(req);authorize(a,['ADMIN','OPERATIONS']);await ready();res.locals.actor=a;next();});
  const staff=(res:{locals:Record<string,unknown>})=>res.locals.actor as Actor;
  ops.get('/',async(req,res)=>res.json(await service.queue(staff(res),opsListSchema.parse(req.query))));
  ops.post('/:id/accept',async(req,res)=>res.json(await service.accept(staff(res),uuid.parse(req.params.id),commandSchema.parse(req.body))));
  ops.post('/:id/reject',async(req,res)=>res.json(await service.reject(staff(res),uuid.parse(req.params.id),rejectSchema.parse(req.body))));
  app.use('/api/customer/order-requests',customer);
  app.use('/api/minios/order-requests',ops);
}
