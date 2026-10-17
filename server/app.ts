import express, { type Request, type Response, type NextFunction } from 'express';
import { z,ZodError, type ZodType } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { camel } from './db.ts';
import type { Database } from './database.ts';
import { Logistics } from './domain.ts';
import { actorFromRequest, checkPassword, createSession, hash, setup, type Actor } from './auth.ts';
import { DomainError, ensure } from './errors.ts';
import { schemas } from './validation.ts';
import { createDriverDocument, renewDriverDocument } from './driver-documents.ts';
import { QuadMindsTracking } from './quadminds.ts';
import { TraccarTracking } from './traccar.ts';
import { CompanyAdministration } from './company.ts';
import { installCustomerAccess } from './customer-access.ts';
import { installLivePortal } from './live-portal.ts';
import { QuadOperations } from './quad-operations.ts';
import { installQuadOperationRoutes } from './quad-operation-routes.ts';
import { installInventoryRoutes } from './inventory-routes.ts';
import { synchronizeQuadMinds } from './quad-sync.ts';
import {Diagnostics,requestContext,WindowLimiter} from './observability.ts';
import {reconcileInventory} from './reconciliation.ts';
import {PasswordRecovery} from './password-recovery.ts';
export function createApp(store: Database, tracking = new QuadMindsTracking(store), quad = new QuadOperations(store),diagnostics=new Diagnostics()) {
    const app = express(), domain = new Logistics(store);
    const traccar = new TraccarTracking(store);
    app.disable('x-powered-by');
    const proxyHops=Number(process.env.TRUST_PROXY_HOPS??0);
    if(!Number.isInteger(proxyHops)||proxyHops<0||proxyHops>5)throw new Error('TRUST_PROXY_HOPS inválido.');
    if(proxyHops)app.set('trust proxy',proxyHops);
    app.use(diagnostics.middleware);
    app.use((_req,res,next)=>{if(process.env.NODE_ENV==='production')res.set({'Strict-Transport-Security':'max-age=31536000; includeSubDomains','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src https://www.openstreetmap.org; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});next();});
    app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'geolocation=()', 'Cache-Control': 'no-store' }); next(); });
    app.post('/api/quadminds/webhook',express.raw({type:'application/json',limit:'512kb'}),async(req,res)=>{ensure(Buffer.isBuffer(req.body),'VALIDATION_ERROR','Se requiere un evento JSON.',400);res.json(await quad.webhook(req.body,req.headers['quadminds-signature']));});
    app.get('/api/jobs/quadminds-sync',async(req,res)=>{
        const secret=process.env.CRON_SECRET;
        ensure(secret&&secret.length>=32&&req.headers.authorization&&hash(req.headers.authorization)===hash(`Bearer ${secret}`),'FORBIDDEN','Acceso no autorizado.',401);
        res.json(await synchronizeQuadMinds(store,quad));
    });
    app.use('/api', (req, res, next) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            const production=process.env.NODE_ENV==='production'||process.env.VERCEL==='1';
            const allowed = new Set([...(production?[]:['http://127.0.0.1:5173','http://localhost:5173']), `${production?'https':'http'}://${req.headers.host}`, ...(process.env.ALLOWED_ORIGINS ?? '').split(',').map(s=>s.trim()).filter(Boolean)]);
            if (req.headers['x-requested-with'] !== 'logistics-os' || (req.headers.origin && !allowed.has(req.headers.origin)))
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Origen de solicitud no autorizado.' } });
        }
        next();
    });
    app.use(express.json({ limit: '8mb' }));
    const auth = async (req: Request): Promise<Actor> => { const actor = await actorFromRequest(store, req); ensure(actor, 'FORBIDDEN', 'Iniciá sesión para continuar.', 401); const context=requestContext.getStore();if(context){context.userId=actor.id;context.orgId=actor.orgId;} return actor; };
    installLivePortal(app,store,auth);
    const loginAttempts = new WindowLimiter(20,60000);
    const recovery=new PasswordRecovery(store),recoveryIssues=new WindowLimiter(20,3600000);
    const loginLimit = (req: Request) => {
        ensure(loginAttempts.allow(req.ip??req.socket.remoteAddress??'local'),'FORBIDDEN','Demasiados intentos. Esperá un minuto.',429);
    };
    app.get('/api/health', async (_req, res) => { await store.one('SELECT 1 AS connected'); res.json({ application: 'logistics-os-local', status: 'ok', database: store.kind, tracking: tracking.status().status, providers: { quadminds: tracking.status().status, traccar: await traccar.health() }, previewInstanceId: process.env.PREVIEW_INSTANCE_ID ?? null }); });
    app.get('/api/version',(_req,res)=>res.json({release:process.env.RELEASE_SHA??'local'}));
    app.get('/api/ready',async(_req,res)=>{
      await store.one('SELECT 1 AS connected');
      const gps=await traccar.health();const ready=process.env.TRACCAR_ENABLED!=='true'||gps.configured&&gps.connected;
      res.status(ready?200:503).json({status:ready?'ready':'degraded',database:'connected',gps:process.env.TRACCAR_ENABLED==='true'?(gps.connected?'connected':'unavailable'):'disabled'});
    });
    app.post('/api/password-recovery/redeem',async(req,res)=>{loginLimit(req);res.json(await recovery.redeem(req.body));});
    app.post('/api/password-recovery/issue',async(req,res)=>{const actor=await auth(req);ensure(recoveryIssues.allow(actor.id),'FORBIDDEN','Demasiados enlaces. Esperá antes de emitir otro.',429);res.json(await recovery.issue(actor,req.body));});
    app.get('/api/preview-identity',(_req,res)=>{if(process.env.NODE_ENV==='production'||!process.env.PREVIEW_INSTANCE_ID)return res.status(404).json({error:{code:'NOT_FOUND',message:'Endpoint no encontrado.'}});res.json({application:'logistics-os-local',previewInstanceId:process.env.PREVIEW_INSTANCE_ID});});
    const telemetryLimit=new WindowLimiter(20,60000);
    app.post('/api/diagnostics/events',async(req,res)=>{const actor=await auth(req);ensure(telemetryLimit.allow(actor.id),'FORBIDDEN','Demasiados eventos.',429);const body=z.object({kind:z.enum(['UI_ERROR','UNHANDLED_REJECTION','API_ERROR']),component:z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/),requestId:z.uuid().optional()}).strict().parse(req.body);diagnostics.emit('client.error',body);res.status(202).json({accepted:true});});
    app.get('/api/diagnostics',async(req,res)=>{const actor=await auth(req);ensure(actor.role==='ADMIN','FORBIDDEN','Acceso no autorizado.',403);res.json({release:process.env.RELEASE_SHA??'local',events:diagnostics.recent.filter(entry=>entry.orgId===actor.orgId)});});
    app.get('/api/inventory/reconciliation',async(req,res)=>{const actor=await auth(req);const result=await reconcileInventory(store,actor);if(!result.ok)diagnostics.emit('inventory.mismatch',{quantityIssues:result.quantityIssues.length,serialIssues:result.serialIssues.length});res.json(result);});
    app.get('/api/session', async (req, res) => res.json({ user: await actorFromRequest(store, req), setupRequired: !await store.one('SELECT id FROM users LIMIT 1') }));
    app.post('/api/setup', async (req, res) => {
        loginLimit(req);
        if(process.env.NODE_ENV==='production')ensure(process.env.INITIAL_SETUP_TOKEN&&process.env.INITIAL_SETUP_TOKEN.length>=32&&typeof req.headers['x-setup-token']==='string'&&hash(req.headers['x-setup-token'])===hash(process.env.INITIAL_SETUP_TOKEN),'FORBIDDEN','El alta inicial se realiza desde la instalación privada de Nexora.',403);
        const input = schemas.setup.parse(req.body); const result = await setup(store, input); await createSession(store, result.userId, res); res.status(201).json({ id: result.userId });
    });
    app.post('/api/login', async (req, res) => {
        loginLimit(req);
        const b = schemas.login.parse(req.body);
        let user = await store.one('SELECT id,password_hash FROM users WHERE username=?', b.username);
        const customer=!user;
        if(customer) user=await store.one('SELECT id,password_hash FROM customer_accounts WHERE username=? AND enabled=1',b.username);
        ensure(user && checkPassword(b.password, user.password_hash), 'FORBIDDEN', 'Usuario o contraseña incorrectos.', 401);
        await createSession(store, user.id, res,customer);
        res.json({ id: user.id });
    });
    app.post('/api/logout', async (req, res) => {
        const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('logistics_session='))?.split('=')[1];
        if (token) {
            await store.run('DELETE FROM sessions WHERE token_hash=?', hash(token));
            await store.run('DELETE FROM customer_sessions WHERE token_hash=?',hash(token));
        }
        res.clearCookie('logistics_session', { path: '/' });
        res.json({ ok: true });
    });
    installCustomerAccess(app,store,auth);
    installInventoryRoutes(app,store,auth);
    installQuadOperationRoutes(app,store,auth,quad);
    // Inventory/customer read routes are registered above the internal-operation boundary.
    app.use('/api',async(req,_res,next)=>{const actor=await auth(req);ensure(actor.role!=='CUSTOMER','FORBIDDEN','Este recurso es interno de operaciones.',403);next();});
    app.get('/api/bootstrap', async (req, res) => { const actor = await auth(req); res.json({ ...await domain.bootstrap(actor), tracking: { ...tracking.status(actor.orgId), traccar: await traccar.health() } }); });
    app.get('/api/company',async(req,res)=>res.json(await new CompanyAdministration(store).read(await auth(req))));
    app.post('/api/company',async(req,res)=>res.json(await new CompanyAdministration(store).update(await auth(req),req.body)));
    app.get('/api/shipments', async (req, res) => {
        const actor = await auth(req), limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25)), offset = Math.max(0, Number(req.query.offset) || 0);
        ensure(Number.isInteger(limit) && Number.isInteger(offset) && offset <= 1000000, 'VALIDATION_ERROR', 'Paginación inválida.', 400);
        const filter = actor.role === 'DRIVER' ? 'AND EXISTS(SELECT 1 FROM parcels p JOIN route_assignments a ON a.parcel_id=p.id JOIN routes r ON r.id=a.route_id WHERE p.shipment_id=s.id AND r.driver_id=?)' : '';
        const params = actor.role === 'DRIVER' ? [actor.orgId, actor.driverId!, limit, offset] : [actor.orgId, limit, offset];
        res.json({ items: (await store.all(`SELECT s.* FROM shipments s WHERE s.org_id=? ${filter} ORDER BY s.created_at DESC,s.id LIMIT ? OFFSET ?`, ...params)).map(camel), limit, offset });
    });
    app.get('/api/shipments/:id', async (req, res) => {
        const actor = await auth(req), shipment = await domain.record('shipments', String(req.params.id), actor);
        if (actor.role === 'DRIVER')
            ensure(await store.one('SELECT a.id FROM route_assignments a JOIN parcels p ON p.id=a.parcel_id JOIN routes r ON r.id=a.route_id WHERE p.shipment_id=? AND r.driver_id=?', shipment.id, actor.driverId), 'FORBIDDEN', 'El envío no está asignado a este chofer.', 403);
        res.json(camel(shipment));
    });
    const post = (path: string, schema: ZodType, work: (actor: Actor, b: any, req: Request) => unknown) => app.post(path, async (req, res) => res.json(await work(await auth(req), schema.parse(req.body), req)));
    post('/api/clients', schemas.client, async (a, b) => await domain.createClient(a, b));
    post('/api/clients/:id', schemas.client, async (a,b,r)=>await domain.updateClient(a,String(r.params.id),b));
    post('/api/users', schemas.user, async (a, b) => await domain.createUser(a, b));
    post('/api/drivers', schemas.driver, async (a, b) => await domain.createDriver(a, b));
    post('/api/vehicles', schemas.vehicle, async (a, b) => await domain.createVehicle(a, b));
    post('/api/shipments', schemas.shipment, async (a, b) => await domain.createShipment(a, b));
    post('/api/receipts', schemas.receipt, async (a, b) => await domain.receive(a, b));
    post('/api/routes', schemas.route, async (a, b) => await domain.createRoute(a, b));
    const routeId = (req: Request) => String(req.params.id);
    post('/api/routes/:id/assignments', schemas.assign, async (a, b, r) => await domain.assign(a, routeId(r), b));
    post('/api/routes/:id/stops/order', schemas.order, async (a, b, r) => await domain.reorder(a, routeId(r), b));
    post('/api/routes/:id/ready', schemas.version, async (a, b, r) => await domain.ready(a, routeId(r), b));
    post('/api/routes/:id/load-scans', schemas.load, async (a, b, r) => await domain.load(a, routeId(r), b));
    post('/api/routes/:id/dispatch', schemas.version, async (a, b, r) => await domain.dispatch(a, routeId(r), b));
    post('/api/routes/:id/close', schemas.version, async (a, b, r) => await domain.closeRoute(a, routeId(r), b));
    post('/api/stops/:id/pickups', schemas.pickup, async (a, b, r) => await domain.pickup(a, routeId(r), b));
    post('/api/stops/:id/attempts', schemas.attempt, async (a, b, r) => await domain.attempt(a, routeId(r), b));
    post('/api/incidents/:id/authorize-return', schemas.command, async (a, b, r) => await domain.authorizeReturn(a, routeId(r), b));
    post('/api/returns/:id/receive', schemas.returnReceive, async (a, b, r) => await domain.receiveReturn(a, routeId(r), b));
    post('/api/returns/:id/depot-evidence', schemas.resolve, async (a, b, r) => await domain.correctReturnEvidence(a, routeId(r), b));
    post('/api/returns/:id/send-to-sender', schemas.returnSender, async (a, b, r) => await domain.sendReturn(a, routeId(r), b));
    post('/api/vehicles/:id/inspections', schemas.inspection, async (a, b, r) => await domain.inspect(a, routeId(r), b));
    post('/api/vehicles/:id/documents', schemas.document, async (a, b, r) => await domain.document(a, routeId(r), b));
    post('/api/drivers/:id/documents', schemas.document, async (a, b, r) => await createDriverDocument(domain, a, routeId(r), b));
    post('/api/driver-documents/:id/renew', schemas.renewDocument, async (a, b, r) => await renewDriverDocument(domain, a, routeId(r), b));
    post('/api/vehicles/:id/maintenance', schemas.maintenance, async (a, b, r) => await domain.maintenance(a, routeId(r), b));
    post('/api/maintenance/:id/complete', schemas.resolve, async (a, b, r) => await domain.completeMaintenance(a, routeId(r), b));
    post('/api/defects/:id/resolve', schemas.resolve, async (a, b, r) => await domain.resolveDefect(a, routeId(r), b));
    post('/api/evidence', schemas.evidence, async (a, b) => await domain.upload(a, b));
    app.get('/api/evidence/:id', async (req, res) => {
        const actor = await auth(req), e = await domain.record('evidence', routeId(req), actor);
        if (e.parcel_id)
            await domain.parcel(e.parcel_id, actor);
        else
            ensure(actor.role !== 'DRIVER', 'FORBIDDEN', 'Evidencia restringida.', 403);
        res.set({ 'Content-Type': e.mime_type, 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(Buffer.from(e.data));
    });
    app.get('/api/integrations/quadminds', async (req, res) => res.json(await tracking.bindings(await auth(req))));
    app.post('/api/vehicles/:id/tracking-binding', async (req, res) => res.json(await tracking.bind(await auth(req), routeId(req), req.body)));
    app.get('/api/integrations/traccar',async(req,res)=>res.json(await traccar.settings(await auth(req))));
    app.post('/api/integrations/traccar/devices',async(req,res)=>res.json(await traccar.createDevice(await auth(req),req.body)));
    app.post('/api/vehicles/:id/traccar-binding',async(req,res)=>res.json(await traccar.bind(await auth(req),routeId(req),req.body)));
    app.post('/api/clients/:id/delivery-provider',async(req,res)=>res.json(await traccar.clientPolicy(await auth(req),routeId(req),req.body)));
    app.post('/api/routes/:id/tracking-provider',async(req,res)=>res.json(await traccar.routePolicy(await auth(req),routeId(req),req.body)));
    app.get('/api/routes/:id/tracking', async (req, res) => {
      const actor=await auth(req),id=routeId(req);await domain.route(id,actor);
      const setting=await store.one('SELECT provider FROM route_tracking_settings WHERE org_id=? AND route_id=?',actor.orgId,id);
      res.json(setting?.provider==='TRACCAR'?await traccar.route(actor,id):await tracking.route(actor,id));
    });
    app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint no encontrado.' } }));
    const dist = resolve('dist');
    if (existsSync(resolve(dist, 'index.html'))) {
        app.use(express.static(dist));
        app.get('/{*splat}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
    }
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (error instanceof ZodError)
            return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Revisá los campos del formulario.', details: error.issues.map(x => ({ path: x.path.join('.'), message: x.message })) } });
        if (error instanceof DomainError)
            return res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
        if (error instanceof SyntaxError)
            return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'El cuerpo JSON no es válido.' } });
        if (error && typeof error === 'object' && 'status' in error && error.status === 413)
            return res.status(413).json({ error: { code: 'VALIDATION_ERROR', message: 'La solicitud excede el tamaño permitido.' } });
        diagnostics.error(error,_req);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'La operación no pudo completarse.',requestId:requestContext.getStore()?.requestId } });
    });
    return app;
}
