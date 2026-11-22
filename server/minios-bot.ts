import {Router,type Express,type Request} from 'express';
import {z} from 'zod';
import {actorFromRequest,type Actor} from './auth.ts';
import {CustomerOrderIntake,customerOrderSubmitSchema,miniosReady} from './customer-order-intake.ts';
import type {Database,Row} from './database.ts';
import {ensure} from './errors.ts';
import {Inventory,inventorySchemas} from './inventory.ts';

const id = z.uuid();
const channelStatus = {FACEBOOK:'NOT_CONNECTED',INSTAGRAM:'NOT_CONNECTED',WHATSAPP:'NOT_CONNECTED'} as const;
const quoteSchema = z.object({commandId:id, order:customerOrderSubmitSchema.omit({commandId:true})}).strict();
const confirmSchema = z.object({commandId:id,expectedVersion:z.number().int().positive()}).strict();

async function botReady(db:Database) {
  if (!await miniosReady(db)) return false;
  try {
    const row=db.kind==='sqlite'
      ? await db.one("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type='table' AND name='customer_bot_simulations' AND EXISTS(SELECT 1 FROM schema_migrations WHERE version=30)")
      : await db.one(`SELECT COUNT(*) AS total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=current_schema() AND c.relname='customer_bot_simulations' AND c.relkind='r' AND row_security_active(c.oid)
          AND has_table_privilege(c.oid,'SELECT') AND has_table_privilege(c.oid,'INSERT') AND has_table_privilege(c.oid,'UPDATE')
          AND EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='minios_organization')`);
    return Number(row?.total)===1;
  } catch { return false; }
}

export class MerchantBotSimulator {
  private db:Database;
  private inventory:Inventory;
  private intake:CustomerOrderIntake;
  constructor(db:Database) { this.db=db; this.inventory=new Inventory(db); this.intake=new CustomerOrderIntake(db); }

  private async scope<T>(actor:Actor, work:(clientId:string)=>Promise<T>) {
    const clientId=actor.clientId;
    ensure(actor.role==='CUSTOMER'&&clientId,'FORBIDDEN','Ingresá como comerciante.',403);
    return this.db.transaction(async()=>{
      if(this.db.kind==='postgres')
        await this.db.one("SELECT set_config('nexora.minios_org_id',?,true) AS tenant",actor.orgId);
      const account=await this.db.one(`SELECT a.id FROM customer_accounts a
        JOIN clients c ON c.org_id=a.org_id AND c.id=a.client_id
        WHERE a.org_id=? AND a.client_id=? AND a.id=? AND a.enabled=1 AND c.archived_at IS NULL`,actor.orgId,clientId,actor.id);
      ensure(account,'FORBIDDEN','La cuenta comercial no está activa.',403);
      return work(clientId);
    });
  }

  private record(actor:Actor,clientId:string,simulationId:string) {
    return this.db.one('SELECT * FROM customer_bot_simulations WHERE org_id=? AND client_id=? AND account_id=? AND id=?',
      actor.orgId,clientId,actor.id,simulationId);
  }

  private view(row:Row) {
    return {id:row.id,requestId:row.request_id,version:row.version,order:JSON.parse(row.order_json),
      stock:JSON.parse(row.stock_json),observedAt:row.observed_at,expiresAt:row.expires_at,
      status:row.request_id?'SUBMITTED':row.expires_at<=new Date().toISOString()?'EXPIRED':'REVIEW',
      mode:'SIMULATOR',channels:channelStatus};
  }

  private async stock(actor:Actor,lines:{productId:string;quantity:number}[]) {
    const rows=await this.inventory.availableProducts(actor,lines.map(line=>line.productId));
    return lines.map(line=>{
      const row=rows.find(item=>item.id===line.productId);
      ensure(row,'FORBIDDEN','Producto sin autorización o inactivo.',403);
      return {...line,sku:row.sku,available:Number(row.available)};
    });
  }

  quote(actor:Actor,input:z.output<typeof quoteSchema>) {
    return this.scope(actor,async clientId=>{
      inventorySchemas.order.parse({...input.order,clientId,commandId:input.commandId});
      const order=JSON.stringify(input.order);
      const prior=await this.record(actor,clientId,input.commandId);
      if(prior) {
        ensure(prior.order_json===order,'DUPLICATE_COMMAND','La simulación ya contiene otros datos.',409);
        return this.view(prior);
      }
      const now=new Date();
      const stock=await this.stock(actor,input.order.lines);
      const row={id:input.commandId,order_json:order,stock_json:JSON.stringify(stock),version:1,request_id:null,
        observed_at:now.toISOString(),expires_at:new Date(now.getTime()+900_000).toISOString()};
      const created=await this.db.run(`INSERT INTO customer_bot_simulations
        (org_id,id,client_id,account_id,order_json,stock_json,observed_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,actor.orgId,row.id,clientId,actor.id,order,row.stock_json,row.observed_at,row.expires_at);
      ensure(Number(created.changes)===1,'DUPLICATE_COMMAND','La clave de simulación ya fue usada.',409);
      return this.view(row);
    });
  }

  get(actor:Actor,simulationId:string) {
    return this.scope(actor,async clientId=>{
      const row=await this.record(actor,clientId,simulationId);
      ensure(row,'NOT_FOUND','Simulación no encontrada.',404);
      return this.view(row);
    });
  }

  confirm(actor:Actor,simulationId:string,input:z.output<typeof confirmSchema>) {
    return this.scope(actor,async clientId=>{
      const row=await this.record(actor,clientId,simulationId);
      ensure(row,'NOT_FOUND','Simulación no encontrada.',404);
      if(row.confirmation_id===input.commandId) {
        ensure(input.expectedVersion===1,'DUPLICATE_COMMAND','La confirmación ya usó otra versión.',409);
        return this.view(row);
      }
      ensure(row.version===input.expectedVersion&&!row.request_id,'VERSION_CONFLICT','La simulación ya cambió.',409);
      const now=new Date().toISOString();
      ensure(row.expires_at>now,'INVALID_TRANSITION','Volvé a consultar el stock de la simulación.',409);
      const order=customerOrderSubmitSchema.parse({...JSON.parse(row.order_json),commandId:input.commandId});
      const stock=await this.stock(actor,order.lines);
      ensure(stock.every(line=>line.quantity<=line.available),'INSUFFICIENT_STOCK','Stock insuficiente al confirmar. Revisá las líneas.',409);
      const request=await this.intake.submit(actor,order);
      ensure(request.status==='PENDING','INVALID_TRANSITION','La solicitud ya salió de revisión inicial.',409);
      const stockJson=JSON.stringify(stock);
      await this.db.run(`UPDATE customer_bot_simulations SET request_id=?,confirmation_id=?,stock_json=?,observed_at=?,version=2
        WHERE org_id=? AND id=?`,request.id,input.commandId,stockJson,now,actor.orgId,simulationId);
      return this.view({...row,request_id:request.id,stock_json:stockJson,observed_at:now,version:2});
    });
  }
}

export function installMerchantBot(app:Express,db:Database) {
  const router=Router(),bot=new MerchantBotSimulator(db);
  const actor=(res:{locals:Record<string,unknown>})=>res.locals.actor as Actor;
  const simulationId=(req:Request)=>id.parse(req.params.id);
  router.use(async(req,res,next)=>{
    const user=await actorFromRequest(db,req,'CUSTOMER');
    ensure(user?.role==='CUSTOMER'&&user.clientId,'FORBIDDEN','Ingresá como comerciante.',401);
    ensure(await botReady(db),'MINIOS_BOT_NOT_READY','El simulador requiere migración verificada.',503);
    res.locals.actor=user;
    next();
  });
  router.get('/status',(_req,res)=>res.json({mode:'SIMULATOR',channels:channelStatus}));
  router.post('/simulations',async(req,res)=>res.status(201).json(await bot.quote(actor(res),quoteSchema.parse(req.body))));
  router.get('/simulations/:id',async(req,res)=>res.json(await bot.get(actor(res),simulationId(req))));
  router.post('/simulations/:id/confirm',async(req,res)=>res.json(await bot.confirm(actor(res),simulationId(req),confirmSchema.parse(req.body))));
  app.use('/api/customer/merchant-bot',router);
}
