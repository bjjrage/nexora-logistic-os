import { randomUUID } from 'node:crypto';
import { camel, type Row } from './db.ts';
import type { Database } from './database.ts';
import { authorize, hash, passwordHash, type Actor, type Role } from './auth.ts';
import { ensure } from './errors.ts';
import { validateRouteProvider, validateParcelRouteProvider } from './traccar.ts';
import {schemas} from './validation.ts';
import {saveClientProfile,clientProfileSummaries} from './client-profiles.ts';
import {latestParcelAssignment} from './driver-access.ts';
import {verifyVehicleCapacity} from './vehicle-capacity.ts';
const now = () => new Date().toISOString();
const canonical = (value: any): string => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const OPS: Role[] = ['ADMIN', 'OPERATIONS'];
const DEPOT: Role[] = ['ADMIN', 'OPERATIONS', 'DEPOT'];
const ROAD: Role[] = ['ADMIN', 'OPERATIONS', 'DRIVER'];
export class Logistics {
    store: Database;
    constructor(store: Database) { this.store = store; }
    async record(table: string, id: string, actor: Actor) {
        const row = await this.store.one(`SELECT * FROM ${table} WHERE id=? AND org_id=?`, id, actor.orgId);
        ensure(row, 'NOT_FOUND', 'No se encontró el recurso autorizado.', 404);
        return row;
    }
    async route(id: string, actor: Actor, expectedVersion?: number) {
        const row = await this.record('routes', id, actor);
        if (actor.role === 'DRIVER')
            ensure(row.driver_id === actor.driverId, 'FORBIDDEN', 'La ruta no está asignada a este chofer.', 403);
        if (expectedVersion !== undefined)
            ensure(row.version === expectedVersion, 'VERSION_CONFLICT', 'El plan cambió. Actualizá los datos antes de reintentar.');
        return row;
    }
    async parcel(id: string, actor: Actor) {
        const parcel = await this.record('parcels', id, actor);
        if (actor.role === 'DRIVER')
            ensure(await this.store.one(`SELECT a.id FROM route_assignments a JOIN routes r ON r.id=a.route_id AND r.org_id=a.org_id WHERE a.parcel_id=? AND r.driver_id=? AND r.org_id=? AND ${latestParcelAssignment}`, id, actor.driverId, actor.orgId), 'FORBIDDEN', 'El bulto no está asignado a este chofer.', 403);
        return parcel;
    }
    async command(actor: Actor, operation: string, input: Row, roles: Role[], work: () => Row | Promise<Row>) {
        authorize(actor, roles);
        ensure(typeof input.commandId === 'string' && /^[a-f0-9-]{36}$/i.test(input.commandId), 'VALIDATION_ERROR', 'Se requiere commandId UUID.', 400);
        return await this.store.transaction(async () => {
            const bodyHash = hash(canonical(input));
            const previous = await this.store.one('SELECT * FROM idempotency WHERE org_id=? AND command_id=?', actor.orgId, input.commandId);
            if (previous) {
                ensure(previous.actor_id === actor.id && previous.operation === operation && previous.body_hash === bodyHash, 'DUPLICATE_COMMAND', 'La clave ya se usó con otra operación, identidad o contenido.');
                return JSON.parse(previous.response);
            }
            const result = await work();
            await this.store.run('INSERT INTO idempotency VALUES(?,?,?,?,?,?)', actor.orgId, actor.id, input.commandId, operation, bodyHash, JSON.stringify(result));
            await this.store.run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, actor.id, operation, String(result.id ?? ''), input.commandId, JSON.stringify({ result: result.state ?? 'APPLIED' }), now());
            return result;
        });
    }
    async move(parcel: Row, actor: Actor, state: string, custodyType: string, custodyId: string, action: string, commandId: string) {
        const { Inventory }=await import('./inventory.ts');
        await new Inventory(this.store).syncParcelTransition(actor,parcel.id,parcel.state,state,custodyType,custodyId,commandId);
        await this.store.run('INSERT INTO custody_events VALUES(?,?,?,?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, parcel.id, actor.id, parcel.custody_type, parcel.custody_id, custodyType, custodyId, action, now(), commandId);
        await this.store.run('UPDATE parcels SET state=?,custody_type=?,custody_id=? WHERE id=? AND org_id=?', state, custodyType, custodyId, parcel.id, actor.orgId);
    }
    async bump(routeId: string) { await this.store.run('UPDATE routes SET version=version+1 WHERE id=?', routeId); }
    async updateClient(actor:Actor,clientId:string,b:Row){
        b=schemas.client.parse(b);
        return this.command(actor,`clients.${clientId}.update`,b,OPS,async()=>{
            await this.record('clients',clientId,actor);
            await this.store.run('UPDATE clients SET name=? WHERE id=? AND org_id=?',b.name,clientId,actor.orgId);
            await saveClientProfile(this.store,actor.orgId,clientId,b);
            return {id:clientId,name:b.name};
        });
    }
    async createClient(actor: Actor, b: Row) {
        b=schemas.client.parse(b);
        return await this.command(actor, 'clients.create', b, OPS, async () => {
            const id = randomUUID();
            await this.store.run('INSERT INTO clients VALUES(?,?,?)', id, actor.orgId, b.name);
            await saveClientProfile(this.store,actor.orgId,id,b);
            return { id };
        });
    }
    async createDriver(actor: Actor, b: Row) {
        return await this.command(actor, 'drivers.create', b, OPS, async () => {
            ensure(!await this.store.one('SELECT id FROM customer_accounts WHERE username=?',b.username),'VALIDATION_ERROR','El nombre de usuario ya existe.',409);
            const id = randomUUID();
            await this.store.run('INSERT INTO drivers VALUES(?,?,?,1)', id, actor.orgId, b.name);
            await this.store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,?)', randomUUID(), actor.orgId, b.username, b.name, passwordHash(b.password), 'DRIVER', id);
            return { id };
        });
    }
    async createUser(actor: Actor, b: Row) {
        return await this.command(actor, 'users.create', b, ['ADMIN'], async () => {
            ensure(!await this.store.one('SELECT id FROM customer_accounts WHERE username=?',b.username),'VALIDATION_ERROR','El nombre de usuario ya existe.',409);
            const id = randomUUID();
            await this.store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)', id, actor.orgId, b.username, b.name, passwordHash(b.password), b.role);
            return { id };
        });
    }
    async createVehicle(actor: Actor, b: Row) {
        return await this.command(actor, 'vehicles.create', b, OPS, async () => {
            const id = randomUUID();
            await this.store.run('INSERT INTO vehicles VALUES(?,?,?,?,?,?,1)', id, actor.orgId, b.plate, b.capacityWeightGrams, b.capacityVolumeCm3, b.odometer);
            return { id };
        });
    }
    async createShipment(actor: Actor, b: Row) {
        return await this.command(actor, 'shipments.create', b, OPS, async () => {
            await this.record('clients', b.clientId, actor);
            const id = randomUUID();
            await this.store.run('INSERT INTO shipments VALUES(?,?,?,?,?,?,?,?,?,?)', id, actor.orgId, b.clientId, b.reference, b.originText, b.destinationText, b.recipientName, b.recipientPhone, b.proofPolicy, now());
            for (let i = 0; i < b.parcelCount; i++)
                await this.store.run('INSERT INTO parcels VALUES(?,?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, id, `B-${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`, 'EXPECTED', 'SENDER', b.clientId, b.weightGrams, b.volumeCm3);
            return { id };
        });
    }
    async receive(actor: Actor, b: Row) {
        return await this.command(actor, 'receipts.create', b, DEPOT, async () => {
            await this.record('shipments', b.shipmentId, actor);
            const parcels = await Promise.all([...new Set<string>(b.codes)].map(async (code) => {
                const p = await this.store.one('SELECT * FROM parcels WHERE code=? AND org_id=?', code, actor.orgId);
                ensure(p && p.shipment_id === b.shipmentId, 'NOT_FOUND', 'El código no pertenece a este envío.', 404);
                ensure(p.state === 'EXPECTED' || (p.state === 'RECEIVED' && p.custody_type === 'DEPOT' && p.custody_id === b.location), 'INVALID_TRANSITION', 'Este bulto ya tiene otra custodia.');
                ensure(!await this.store.one('SELECT id FROM route_assignments WHERE parcel_id=? AND active=1', p.id), 'INVALID_TRANSITION', 'El bulto está reservado para un retiro directo.');
                return p;
            }));
            const fresh = parcels.filter(p => p.state === 'EXPECTED');
            if (!fresh.length)
                return { id: b.shipmentId, received: 0, alreadyReceived: parcels.length };
            const id = randomUUID();
            await this.store.run('INSERT INTO receipts VALUES(?,?,?,?,?,?)', id, actor.orgId, b.shipmentId, b.location, actor.id, now());
            for (const p of fresh) {
                await this.store.run('INSERT INTO receipt_items VALUES(?,?)', id, p.id);
                await this.move(p, actor, 'RECEIVED', 'DEPOT', b.location, 'RECEIVED', b.commandId);
            }
            return { id, received: fresh.length, alreadyReceived: parcels.length - fresh.length };
        });
    }
    async createRoute(actor: Actor, b: Row) {
        return await this.command(actor, 'routes.create', b, OPS, async () => {
            const driver = await this.record('drivers', b.driverId, actor), vehicle = await this.record('vehicles', b.vehicleId, actor);
            ensure(driver.available && vehicle.available, 'INVALID_TRANSITION', 'Chofer o vehículo no disponible.');
            ensure(b.endAt > b.startAt, 'VALIDATION_ERROR', 'La ventana debe terminar después del inicio.', 400);
            const id = randomUUID();
            await this.store.run('INSERT INTO routes(id,org_id,name,driver_id,vehicle_id,start_at,end_at) VALUES(?,?,?,?,?,?,?)', id, actor.orgId, b.name, b.driverId, b.vehicleId, b.startAt, b.endAt);
            return { id, version: 1, state: 'DRAFT' };
        });
    }
    async assign(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `routes.${id}.assign`, b, OPS, async () => {
            const route = await this.route(id, actor, b.expectedVersion);
            ensure(route.state === 'DRAFT', 'INVALID_TRANSITION', 'Solo se modifica un plan en borrador.');
            const parcels = await Promise.all([...new Set<string>(b.parcelIds)].map(async (p) => await this.parcel(p, actor)));
            await validateParcelRouteProvider(this.store,actor.orgId,id,parcels.map(p=>p.id));
            for (const p of parcels) {
                ensure(!await this.store.one("SELECT id FROM returns WHERE parcel_id=? AND state<>'SENT_TO_SENDER'", p.id), 'INVALID_TRANSITION', 'El bulto tiene una devolución pendiente al remitente.');
                ensure(b.pickup ? p.state === 'EXPECTED' && p.custody_type === 'SENDER' : ['RECEIVED', 'RETURNED_TO_DEPOT'].includes(p.state) && p.custody_type === 'DEPOT', 'INVALID_TRANSITION', 'El bulto no está disponible en la custodia requerida.');
                await this.store.run('INSERT INTO route_assignments VALUES(?,?,?,?,?,1)', randomUUID(), actor.orgId, id, p.id, b.pickup ? 1 : 0);
                for (const kind of (b.pickup ? ['PICKUP', 'DELIVERY'] : ['DELIVERY'])) {
                    if (!await this.store.one('SELECT id FROM stops WHERE route_id=? AND shipment_id=? AND kind=?', id, p.shipment_id, kind)) {
                        const sequence = (await this.store.one('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM stops WHERE route_id=?', id))!.n;
                        await this.store.run('INSERT INTO stops VALUES(?,?,?,?,?,?,?)', randomUUID(), actor.orgId, id, p.shipment_id, sequence, kind, 'PENDING');
                    }
                }
            }
            await this.bump(id);
            return { id, version: route.version + 1 };
        });
    }
    async reorder(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `routes.${id}.order`, b, OPS, async () => {
            const r = await this.route(id, actor, b.expectedVersion);
            ensure(r.state === 'DRAFT', 'INVALID_TRANSITION', 'Solo se ordenan planes en borrador.');
            const stops = await this.store.all('SELECT * FROM stops WHERE route_id=?', id);
            ensure(stops.length === b.stopIds.length && new Set(b.stopIds).size === stops.length && stops.every(s => b.stopIds.includes(s.id)), 'VALIDATION_ERROR', 'Incluí cada parada exactamente una vez.', 400);
            await this.store.run('UPDATE stops SET sequence=sequence+10000 WHERE route_id=?', id);
            await Promise.all(b.stopIds.map(async (stopId: string, i: number) => await this.store.run('UPDATE stops SET sequence=? WHERE id=?', i + 1, stopId)));
            await this.capacity(r, actor);
            await this.bump(id);
            return { id, version: r.version + 1 };
        });
    }
    async capacity(route: Row, actor: Actor) {
        const vehicle = await this.record('vehicles', route.vehicle_id, actor);
        const parcels = await this.store.all('SELECT p.*,a.pickup FROM route_assignments a JOIN parcels p ON p.id=a.parcel_id WHERE a.route_id=? AND a.active=1', route.id);
        ensure(parcels.length, 'VALIDATION_ERROR', 'La ruta no tiene bultos.', 400);
        ensure(parcels.every(p => p.weight_grams !== null && p.volume_cm3 !== null), 'VALIDATION_ERROR', 'Capacidad sin verificar: hay bultos con peso o volumen desconocidos.', 400);
        let weight = 0, volume = 0;
        const onboard = new Set<string>();
        const check = () => ensure(weight >= 0 && volume >= 0 && weight <= vehicle.capacity_weight_grams && volume <= vehicle.capacity_volume_cm3, 'CAPACITY_EXCEEDED', 'La capacidad de peso o volumen se excede en un tramo.');
        for (const p of parcels.filter(p => !p.pickup)) {
            weight += p.weight_grams;
            volume += p.volume_cm3;
            onboard.add(p.id);
        }
        check();
        for (const stop of await this.store.all('SELECT * FROM stops WHERE route_id=? ORDER BY sequence', route.id)) {
            for (const p of parcels.filter(p => p.shipment_id === stop.shipment_id && (stop.kind === 'DELIVERY' || p.pickup))) {
                if (stop.kind === 'PICKUP') {
                    ensure(!onboard.has(p.id), 'INVALID_TRANSITION', 'El retiro tiene un orden incompatible.');
                    onboard.add(p.id);
                    weight += p.weight_grams;
                    volume += p.volume_cm3;
                }
                else {
                    ensure(onboard.has(p.id), 'INVALID_TRANSITION', 'El retiro debe preceder a la entrega.');
                    onboard.delete(p.id);
                    weight -= p.weight_grams;
                    volume -= p.volume_cm3;
                }
                check();
            }
        }
        ensure(onboard.size === 0, 'INVALID_TRANSITION', 'Hay bultos sin parada de entrega.');
        return { verified: true };
    }
    async ready(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `routes.${id}.ready`, b, OPS, async () => {
            const r = await this.route(id, actor, b.expectedVersion);
            ensure(r.state === 'DRAFT', 'INVALID_TRANSITION', 'La ruta debe estar en borrador.');
            await validateRouteProvider(this.store,actor.orgId,id);
            await this.capacity(r, actor);
            await this.store.run("UPDATE routes SET state='READY',version=version+1 WHERE id=?", id);
            return { id, state: 'READY', version: r.version + 1 };
        });
    }
    async vehicleCapacity(actor:Actor,vehicleId:string,additional:Row[]=[]){
        await verifyVehicleCapacity(this.store,actor.orgId,vehicleId,additional);
    }
    async load(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `routes.${id}.load`, b, DEPOT, async () => {
            const r = await this.route(id, actor, b.expectedVersion);
            ensure(r.state === 'READY', 'INVALID_TRANSITION', 'La ruta debe estar confirmada.');
            const p = await this.store.one('SELECT p.* FROM parcels p JOIN route_assignments a ON a.parcel_id=p.id WHERE a.route_id=? AND p.code=? AND a.active=1 AND a.pickup=0 AND p.org_id=?', id, b.code, actor.orgId);
            ensure(p, 'NOT_FOUND', 'El bulto no pertenece al manifiesto de carga.', 404);
            if (p.state === 'LOADED' && p.custody_type === 'VEHICLE' && p.custody_id === r.vehicle_id)
                return { id, alreadyLoaded: true, version: r.version };
            ensure(['RECEIVED', 'RETURNED_TO_DEPOT'].includes(p.state) && p.custody_type === 'DEPOT', 'INVALID_TRANSITION', 'El bulto no está en depósito.');
            await this.vehicleCapacity(actor,r.vehicle_id,[p]);
            await this.move(p, actor, 'LOADED', 'VEHICLE', r.vehicle_id, 'LOADED', b.commandId);
            await this.bump(id);
            return { id, version: r.version + 1 };
        });
    }
    async fleetGuard(r: Row, actor: Actor) {
        const v = await this.record('vehicles', r.vehicle_id, actor), d = await this.record('drivers', r.driver_id, actor);
        ensure(v.available && d.available, 'INVALID_TRANSITION', 'Chofer o vehículo no disponible.');
        ensure(await this.store.one('SELECT id FROM users WHERE org_id=? AND driver_id=? AND enabled=1',actor.orgId,d.id),'INVALID_TRANSITION','El acceso del chofer está suspendido.');
        ensure(!await this.store.one("SELECT id FROM defects WHERE vehicle_id=? AND state='OPEN' AND severity='CRITICAL'", v.id), 'INVALID_TRANSITION', 'Hay un defecto crítico abierto.');
        ensure(!await this.store.one('SELECT id FROM vehicle_documents WHERE vehicle_id=? AND blocks_dispatch=1 AND expires_at<=?', v.id, now()), 'INVALID_TRANSITION', 'Hay documentación impeditiva vencida.');
        ensure(!await this.store.one('SELECT id FROM driver_documents WHERE driver_id=? AND blocks_dispatch=1 AND expires_at<=?', d.id, now()), 'INVALID_TRANSITION', 'Hay documentación impeditiva del chofer vencida.');
        ensure(!await this.store.one("SELECT id FROM maintenance WHERE vehicle_id=? AND state='OPEN' AND ((due_at IS NOT NULL AND due_at<=?) OR (due_odometer IS NOT NULL AND due_odometer<=?))", v.id, now(), v.odometer), 'INVALID_TRANSITION', 'Hay mantenimiento vencido.');
        const inspection = await this.store.one('SELECT * FROM inspections WHERE vehicle_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1', v.id);
        ensure(inspection && inspection.created_at >= r.start_at && inspection.created_at <= r.end_at, 'INVALID_TRANSITION', 'Falta checklist de salida dentro de la ventana de trabajo.');
    }
    async dispatch(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `routes.${id}.dispatch`, b, ROAD, async () => {
            const r = await this.route(id, actor, b.expectedVersion);
            ensure(r.state === 'READY', 'INVALID_TRANSITION', 'La ruta debe estar lista.');
            await validateRouteProvider(this.store,actor.orgId,id);
            ensure(now() >= r.start_at && now() <= r.end_at, 'INVALID_TRANSITION', 'El despacho está fuera de la ventana de trabajo.');
            await this.capacity(r, actor);
            await this.vehicleCapacity(actor,r.vehicle_id);
            await this.fleetGuard(r, actor);
            const assigned = await this.store.all('SELECT p.*,a.pickup FROM route_assignments a JOIN parcels p ON p.id=a.parcel_id WHERE a.route_id=? AND a.active=1', id);
            ensure(assigned.every(p => p.pickup ? p.state === 'EXPECTED' && p.custody_type === 'SENDER' : p.state === 'LOADED' && p.custody_type === 'VEHICLE' && p.custody_id === r.vehicle_id), 'INVALID_TRANSITION', 'El manifiesto no está reconciliado: faltan bultos por cargar.');
            for (const p of assigned.filter(p => !p.pickup))
                await this.move(p, actor, 'IN_TRANSIT', 'VEHICLE', r.vehicle_id, 'DISPATCHED', b.commandId);
            await this.store.run("UPDATE routes SET state='IN_PROGRESS',version=version+1 WHERE id=?", id);
            return { id, state: 'IN_PROGRESS', version: r.version + 1 };
        });
    }
    async pickup(actor: Actor, stopId: string, b: Row) {
        return await this.command(actor, `stops.${stopId}.pickup`, b, ROAD, async () => {
            const stop = await this.record('stops', stopId, actor), r = await this.route(stop.route_id, actor, b.expectedVersion);
            ensure(r.state === 'IN_PROGRESS' && stop.kind === 'PICKUP', 'INVALID_TRANSITION', 'La parada no admite retiro.');
            const previous = await this.store.one("SELECT id FROM stops WHERE route_id=? AND sequence<? AND state NOT IN('COMPLETED','FAILED')", r.id, stop.sequence);
            ensure(!previous, 'INVALID_TRANSITION', 'Completá las paradas anteriores.');
            const pickupParcels = await Promise.all([...new Set<string>(b.codes)].map(async (code) => {
                const p = await this.store.one('SELECT p.* FROM parcels p JOIN route_assignments a ON a.parcel_id=p.id WHERE p.org_id=? AND p.code=? AND p.shipment_id=? AND a.route_id=? AND a.pickup=1 AND a.active=1', actor.orgId, code, stop.shipment_id, r.id);
                ensure(p, 'NOT_FOUND', 'El bulto no corresponde a este retiro.', 404);
                ensure(p.state === 'EXPECTED' && p.custody_type === 'SENDER', 'INVALID_TRANSITION', 'La custodia del bulto cambió.');
                return p;
            }));
            await this.vehicleCapacity(actor,r.vehicle_id,pickupParcels);
            for (const p of pickupParcels) {
                await this.move(p, actor, 'IN_TRANSIT', 'VEHICLE', r.vehicle_id, 'DIRECT_PICKUP', b.commandId);
            }
            const missing = await this.store.one("SELECT p.id FROM parcels p JOIN route_assignments a ON a.parcel_id=p.id WHERE a.route_id=? AND p.shipment_id=? AND a.pickup=1 AND p.state='EXPECTED'", r.id, stop.shipment_id);
            await this.store.run('UPDATE stops SET state=? WHERE id=?', missing ? 'PARTIAL' : 'COMPLETED', stopId);
            await this.bump(r.id);
            return { id: stopId, version: r.version + 1 };
        });
    }
    async verifyEvidence(actor: Actor, evidenceId: string, parcelId?: string) {
        const e = await this.record('evidence', evidenceId, actor);
        ensure(!parcelId || e.parcel_id === parcelId, 'EVIDENCE_REQUIRED', 'La evidencia no corresponde al bulto.');
        return e;
    }
    async retryDelivery(actor:Actor,stopId:string,b:Row){
        return this.command(actor,`stops.${stopId}.retry`,b,ROAD,async()=>{
            const stop=await this.record('stops',stopId,actor),r=await this.route(stop.route_id,actor,b.expectedVersion);
            ensure(r.state==='IN_PROGRESS'&&stop.kind==='DELIVERY'&&['FAILED','PARTIAL'].includes(stop.state),'INVALID_TRANSITION','La parada no admite un nuevo intento.');
            const parcels=await this.store.all("SELECT p.* FROM parcels p JOIN route_assignments a ON a.parcel_id=p.id AND a.org_id=p.org_id WHERE a.route_id=? AND a.active=1 AND p.shipment_id=? AND p.state='RETURN_PENDING' AND p.custody_type='VEHICLE' AND p.custody_id=? AND NOT EXISTS(SELECT 1 FROM returns ret WHERE ret.parcel_id=p.id AND ret.state<>'SENT_TO_SENDER')",r.id,stop.shipment_id,r.vehicle_id);
            ensure(parcels.length,'INVALID_TRANSITION','No hay bultos fallidos que admitan reintento; completá las devoluciones autorizadas.');
            for(const parcel of parcels)await this.move(parcel,actor,'IN_TRANSIT','VEHICLE',r.vehicle_id,'DELIVERY_RETRY',b.commandId);
            await this.store.run("UPDATE stops SET state='PARTIAL' WHERE id=?",stopId);
            await this.bump(r.id);
            return {id:stopId,version:r.version+1,retryCount:parcels.length};
        });
    }
    async attempt(actor: Actor, stopId: string, b: Row) {
        return await this.command(actor, `stops.${stopId}.attempt`, b, ROAD, async () => {
            const stop = await this.record('stops', stopId, actor), r = await this.route(stop.route_id, actor, b.expectedVersion);
            ensure(r.state === 'IN_PROGRESS' && stop.kind === 'DELIVERY' && ['PENDING','PARTIAL'].includes(stop.state), 'INVALID_TRANSITION', 'La parada no está habilitada para entrega. Para repetir una visita fallida, habilitá un nuevo intento.');
            ensure(!await this.store.one("SELECT id FROM stops WHERE route_id=? AND sequence<? AND state NOT IN('COMPLETED','FAILED')", r.id, stop.sequence), 'INVALID_TRANSITION', 'Completá las paradas anteriores.');
            const delivered = [...new Set<string>(b.deliveredParcelIds)], failed = [...new Set<string>(b.failedParcelIds)];
            ensure(delivered.length + failed.length > 0 && !delivered.some(p => failed.includes(p)), 'VALIDATION_ERROR', 'Seleccioná resultados distintos por bulto.', 400);
            if (delivered.length)
                ensure(b.receiverName.trim(), 'EVIDENCE_REQUIRED', 'Indicá el nombre del receptor.');
            if (failed.length)
                ensure(b.reasonCode && b.nextAction.trim(), 'VALIDATION_ERROR', 'La incidencia requiere motivo y próxima acción.', 400);
            const shipment = await this.record('shipments', stop.shipment_id, actor);
            for (const parcelId of [...delivered, ...failed]) {
                const p = await this.parcel(parcelId, actor);
                ensure(p.shipment_id === stop.shipment_id && await this.store.one('SELECT id FROM route_assignments WHERE route_id=? AND parcel_id=? AND active=1', r.id, p.id), 'FORBIDDEN', 'El bulto no está en esta parada.', 403);
                ensure(p.state === 'IN_TRANSIT' && p.custody_type === 'VEHICLE' && p.custody_id === r.vehicle_id, 'INVALID_TRANSITION', 'El bulto no admite este intento; habilitá el reintento si la visita anterior falló.');
                ensure(!await this.store.one("SELECT id FROM returns WHERE parcel_id=? AND state<>'SENT_TO_SENDER'", p.id), 'INVALID_TRANSITION', 'La devolución autorizada debe completarse.');
                const quad=await this.store.one('SELECT * FROM quad_parcel_links WHERE org_id=? AND parcel_id=?',actor.orgId,p.id);
                const inventory=await this.store.one('SELECT id FROM inventory_order_parcels WHERE org_id=? AND parcel_id=?',actor.orgId,p.id);
                const policy=await this.store.one('SELECT delivery_provider FROM client_delivery_policies WHERE org_id=? AND client_id=?',actor.orgId,shipment.client_id);
                const ownDelivery=policy?.delivery_provider==='NEXORA';
                ensure(!inventory||quad||ownDelivery,'INVALID_TRANSITION','Los pedidos de este cliente se cierran desde QuadMinds. Vinculá y sincronizá su resultado.');
                if(ownDelivery)ensure((await this.store.one('SELECT provider FROM route_tracking_settings WHERE org_id=? AND route_id=?',actor.orgId,r.id))?.provider==='TRACCAR','INVALID_TRANSITION','El reparto Nexora requiere una ruta Traccar.');
                if(quad){
                    ensure(quad.provider_result===(delivered.includes(p.id)?'DELIVERED':'FAILED'),'INVALID_TRANSITION','Registrá el resultado en la app de QuadMinds y sincronizá la ruta.');
                    if(delivered.includes(p.id)){
                        const proofs=await this.store.all('SELECT q.kind,q.evidence_id,e.sha256 FROM quad_proofs q JOIN evidence e ON e.id=q.evidence_id AND e.org_id=q.org_id WHERE q.org_id=? AND q.parcel_id=?',actor.orgId,p.id);
                        const photos=proofs.filter(e=>e.kind==='PHOTO'&&b.evidenceIds.includes(e.evidence_id)),signatures=proofs.filter(e=>e.kind==='SIGNATURE'&&b.evidenceIds.includes(e.evidence_id));
                        ensure(quad.evidence_state==='COMPLETE'&&photos.some(photo=>signatures.some(signature=>signature.sha256!==photo.sha256)),'EVIDENCE_REQUIRED','La entrega requiere foto y firma distintas, almacenadas desde QuadMinds.');
                    }
                }
                if (delivered.includes(p.id) && shipment.proof_policy === 'RECEIVER_PHOTO') {
                    const evidenceMatches = await Promise.all(b.evidenceIds.map(async (e: string) => !!await this.store.one('SELECT id FROM evidence WHERE id=? AND parcel_id=? AND org_id=?', e, p.id, actor.orgId)));
                    ensure(evidenceMatches.some(Boolean), 'EVIDENCE_REQUIRED', `Falta una foto almacenada para ${p.code}.`);
                }
            }
            for (const e of b.evidenceIds) {
                const evidence = await this.verifyEvidence(actor, e);
                ensure([...delivered, ...failed].includes(evidence.parcel_id), 'EVIDENCE_REQUIRED', 'La foto pertenece a otro bulto.');
            }
            const id = randomUUID();
            await this.store.run('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)', id, actor.orgId, stopId, actor.id, b.receiverName, b.reasonCode, b.nextAction, JSON.stringify(b.evidenceIds), now());
            for (const parcelId of delivered) {
                const p = await this.parcel(parcelId, actor);
                await this.store.run('INSERT INTO attempt_items VALUES(?,?,?)', id, p.id, 'DELIVERED');
                await this.move(p, actor, 'DELIVERED', 'RECIPIENT', b.receiverName, 'DELIVERED', b.commandId);
                await this.store.run('UPDATE route_assignments SET active=0 WHERE parcel_id=? AND route_id=?', p.id, r.id);
                await this.store.run("UPDATE incidents SET state='RESOLVED' WHERE parcel_id=? AND state='OPEN'", p.id);
            }
            for (const parcelId of failed) {
                const p = await this.parcel(parcelId, actor);
                await this.store.run('INSERT INTO attempt_items VALUES(?,?,?)', id, p.id, 'FAILED');
                await this.move(p, actor, 'RETURN_PENDING', 'VEHICLE', r.vehicle_id, 'DELIVERY_FAILED', b.commandId);
                // Keep each attempt, while one open incident represents its outstanding obligation.
                if (!await this.store.one("SELECT id FROM incidents WHERE parcel_id=? AND state='OPEN'", p.id))
                    await this.store.run('INSERT INTO incidents VALUES(?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, p.id, r.id, b.reasonCode, b.nextAction, actor.id, 'OPEN');
            }
            const remaining = await this.store.all('SELECT p.state FROM parcels p JOIN route_assignments a ON a.parcel_id=p.id WHERE a.route_id=? AND p.shipment_id=? AND a.active=1', r.id, stop.shipment_id);
            const unattempted = remaining.some(p => ['EXPECTED', 'LOADED', 'IN_TRANSIT'].includes(p.state));
            await this.store.run('UPDATE stops SET state=? WHERE id=?', unattempted ? 'PARTIAL' : remaining.length ? 'FAILED' : 'COMPLETED', stopId);
            await this.bump(r.id);
            return { id, version: r.version + 1 };
        });
    }
    async authorizeReturn(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `incidents.${id}.return`, b, OPS, async () => {
            const i = await this.record('incidents', id, actor), p = await this.parcel(i.parcel_id, actor);
            ensure(i.state === 'OPEN' && p.state === 'RETURN_PENDING', 'INVALID_TRANSITION', 'La incidencia no admite devolución.');
            const returnId = randomUUID();
            await this.store.run('INSERT INTO returns(id,org_id,parcel_id,route_id,incident_id) VALUES(?,?,?,?,?)', returnId, actor.orgId, p.id, i.route_id, id);
            await this.store.run("UPDATE incidents SET state='RETURN_AUTHORIZED' WHERE id=?", id);
            return { id: returnId, state: 'AUTHORIZED' };
        });
    }
    async receiveReturn(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `returns.${id}.receive`, b, DEPOT, async () => {
            const item = await this.record('returns', id, actor), p = await this.parcel(item.parcel_id, actor), r = await this.route(item.route_id, actor);
            ensure(item.state === 'AUTHORIZED' && p.state === 'RETURN_PENDING' && p.custody_type === 'VEHICLE' && p.custody_id === r.vehicle_id, 'INVALID_TRANSITION', 'La devolución no está en custodia del vehículo.');
            ensure(b.evidenceId, 'EVIDENCE_REQUIRED', 'Guardá una foto de la recepción en depósito.');
            await this.verifyEvidence(actor, b.evidenceId, p.id);
            await this.store.run('INSERT INTO return_evidence VALUES(?,?,?,?,?,?,?,?)', id, actor.orgId, 'DEPOT', b.evidenceId, actor.id, now(), 'RECEIPT', null);
            const receiptId = randomUUID();
            await this.store.run('INSERT INTO receipts VALUES(?,?,?,?,?,?)', receiptId, actor.orgId, p.shipment_id, b.location, actor.id, now());
            await this.store.run('INSERT INTO receipt_items VALUES(?,?)', receiptId, p.id);
            await this.move(p, actor, 'RETURNED_TO_DEPOT', 'DEPOT', b.location, 'RETURN_RECEIVED', b.commandId);
            await this.store.run("UPDATE returns SET state='AT_DEPOT',depot_receipt_id=? WHERE id=?", receiptId, id);
            await this.store.run('UPDATE route_assignments SET active=0 WHERE route_id=? AND parcel_id=?', r.id, p.id);
            await this.bump(r.id);
            return { id, state: 'AT_DEPOT' };
        });
    }
    async correctReturnEvidence(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `returns.${id}.depotEvidence`, b, OPS, async () => {
            const item = await this.record('returns', id, actor);
            ensure(item.state === 'AT_DEPOT', 'INVALID_TRANSITION', 'Solo se subsana evidencia de una devolución ya recibida en depósito.');
            ensure(!await this.store.one("SELECT return_id FROM return_evidence WHERE return_id=? AND stage='DEPOT'", id), 'INVALID_TRANSITION', 'La recepción ya tiene evidencia; se conserva el registro original.');
            await this.verifyEvidence(actor, b.evidenceId, item.parcel_id);
            await this.store.run('INSERT INTO return_evidence VALUES(?,?,?,?,?,?,?,?)', id, actor.orgId, 'DEPOT', b.evidenceId, actor.id, now(), 'CORRECTION', b.note);
            return { id, state: 'DEPOT_EVIDENCE_RECORDED' };
        });
    }
    async sendReturn(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `returns.${id}.sender`, b, DEPOT, async () => {
            const item = await this.record('returns', id, actor), p = await this.parcel(item.parcel_id, actor);
            ensure(item.state === 'AT_DEPOT' && p.state === 'RETURNED_TO_DEPOT' && p.custody_type === 'DEPOT', 'INVALID_TRANSITION', 'La devolución todavía no se recibió en depósito.');
            const proof = await this.verifyEvidence(actor, b.evidenceId, p.id);
            const depot = await this.store.one("SELECT e.sha256 FROM return_evidence re JOIN evidence e ON e.id=re.evidence_id WHERE re.return_id=? AND re.stage='DEPOT'", id);
            ensure(depot, 'EVIDENCE_REQUIRED', 'Falta evidencia de la recepción en depósito. Operaciones debe subsanar el registro.');
            ensure(depot.sha256 !== proof.sha256, 'EVIDENCE_REQUIRED', 'La entrega al remitente requiere una foto distinta a la recepción en depósito.');
            await this.store.run('INSERT INTO return_evidence VALUES(?,?,?,?,?,?,?,?)', id, actor.orgId, 'SENDER', b.evidenceId, actor.id, now(), 'SENDER_HANDOVER', null);
            await this.move(p, actor, 'RETURNED_TO_SENDER', 'SENDER', (await this.record('shipments', p.shipment_id, actor)).client_id, 'RETURNED_TO_SENDER', b.commandId);
            await this.store.run("UPDATE returns SET state='SENT_TO_SENDER',sender_evidence_id=?,receiver_name=? WHERE id=?", b.evidenceId, b.receiverName, id);
            await this.store.run("UPDATE incidents SET state='RESOLVED' WHERE id=?", item.incident_id);
            return { id, state: 'SENT_TO_SENDER' };
        });
    }
    async closeRoute(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `routes.${id}.close`, b, ROAD, async () => {
            const r = await this.route(id, actor, b.expectedVersion);
            ensure(r.state === 'IN_PROGRESS', 'INVALID_TRANSITION', 'La ruta no está en curso.');
            const pending = await this.store.all("SELECT * FROM stops WHERE route_id=? AND state NOT IN('COMPLETED','FAILED')", id);
            ensure(!pending.length, 'INVALID_TRANSITION', 'Hay paradas pendientes sin reconciliar.');
            ensure(!await this.store.one('SELECT id FROM route_assignments WHERE route_id=? AND active=1', id), 'INVALID_TRANSITION', 'Hay bultos en custodia del vehículo o pendientes de resolver.');
            await this.store.run("UPDATE routes SET state='OPERATIONALLY_CLOSED',version=version+1 WHERE id=?", id);
            return { id, state: 'OPERATIONALLY_CLOSED', version: r.version + 1 };
        });
    }
    async inspect(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `vehicles.${id}.inspect`, b, ROAD, async () => {
            const v = await this.record('vehicles', id, actor);
            if (actor.role === 'DRIVER')
                ensure(await this.store.one("SELECT id FROM routes WHERE org_id=? AND driver_id=? AND vehicle_id=? AND state IN('READY','IN_PROGRESS')", actor.orgId, actor.driverId, id), 'FORBIDDEN', 'El vehículo no está asignado.', 403);
            ensure(b.odometer >= v.odometer, 'VALIDATION_ERROR', 'El kilometraje no puede retroceder.', 400);
            const inspectionId = randomUUID();
            await this.store.run('INSERT INTO inspections VALUES(?,?,?,?,?,?,?,?)', inspectionId, actor.orgId, id, b.odometer, b.fuelPercent, JSON.stringify(b.items), actor.id, now());
            await this.store.run('UPDATE vehicles SET odometer=? WHERE id=?', b.odometer, id);
            for (const item of b.items.filter((i: Row) => i.severity !== 'OK'))
                await this.store.run('INSERT INTO defects(id,org_id,vehicle_id,inspection_id,severity,note) VALUES(?,?,?,?,?,?)', randomUUID(), actor.orgId, id, inspectionId, item.severity, `${item.label}: ${item.note}`);
            return { id: inspectionId };
        });
    }
    async document(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `vehicles.${id}.document`, b, OPS, async () => {
            await this.record('vehicles', id, actor);
            const docId = randomUUID();
            await this.store.run('INSERT INTO vehicle_documents VALUES(?,?,?,?,?,?)', docId, actor.orgId, id, b.name, b.expiresAt, b.blocksDispatch ? 1 : 0);
            return { id: docId };
        });
    }
    async resolveDefect(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `defects.${id}.resolve`, b, OPS, async () => {
            const defect = await this.record('defects', id, actor);
            ensure(defect.state === 'OPEN', 'INVALID_TRANSITION', 'El defecto ya está resuelto.');
            await this.verifyEvidence(actor, b.evidenceId);
            await this.store.run("UPDATE defects SET state='RESOLVED',resolution_note=?,evidence_id=? WHERE id=?", b.note, b.evidenceId, id);
            return { id, state: 'RESOLVED' };
        });
    }
    async maintenance(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `vehicles.${id}.maintenance`, b, OPS, async () => {
            await this.record('vehicles', id, actor);
            ensure(b.dueAt !== null || b.dueOdometer !== null, 'VALIDATION_ERROR', 'Indicá fecha o kilometraje de vencimiento.', 400);
            const itemId = randomUUID();
            await this.store.run('INSERT INTO maintenance(id,org_id,vehicle_id,description,due_at,due_odometer) VALUES(?,?,?,?,?,?)', itemId, actor.orgId, id, b.description, b.dueAt, b.dueOdometer);
            return { id: itemId };
        });
    }
    async completeMaintenance(actor: Actor, id: string, b: Row) {
        return await this.command(actor, `maintenance.${id}.complete`, b, OPS, async () => {
            const item = await this.record('maintenance', id, actor);
            ensure(item.state === 'OPEN', 'INVALID_TRANSITION', 'El servicio ya fue completado.');
            await this.verifyEvidence(actor, b.evidenceId);
            await this.store.run("UPDATE maintenance SET state='COMPLETED',completion_note=?,evidence_id=? WHERE id=?", b.note, b.evidenceId, id);
            return { id, state: 'COMPLETED' };
        });
    }
    async upload(actor: Actor, b: Row) {
        return await this.command(actor, 'evidence.store', b, DEPOT.concat('DRIVER'), async () => {
            if (b.parcelId)
                await this.parcel(b.parcelId, actor);
            else
                authorize(actor, OPS);
            const data = Buffer.from(b.dataBase64, 'base64');
            ensure(data.length > 0 && data.length <= 5 * 1024 * 1024, 'VALIDATION_ERROR', 'La foto debe pesar entre 1 byte y 5 MB.', 400);
            const signatures: Record<string, boolean> = { 'image/jpeg': data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff, 'image/png': data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/webp': data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' };
            ensure(signatures[b.mimeType], 'VALIDATION_ERROR', 'El archivo no coincide con un formato de imagen permitido.', 400);
            const id = randomUUID();
            await this.store.run('INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?)', id, actor.orgId, b.parcelId ?? null, actor.id, b.filename, b.mimeType, data, hash(data), now());
            return { id, state: 'STORED' };
        });
    }
    async bootstrap(actor: Actor) {
        const s=this.store, cap=500;
        const tables=['clients','drivers','vehicles','shipments','parcels','routes','stops','route_assignments','incidents','returns','defects','vehicle_documents','driver_documents','inspections','maintenance','attempts','custody_events','audit'];
        const driver=actor.role==='DRIVER';
        const ownParcels=`(SELECT a.parcel_id FROM route_assignments a JOIN routes r ON r.id=a.route_id AND r.org_id=a.org_id WHERE r.driver_id=? AND ${latestParcelAssignment})`;
        const driverFilters:Record<string,string>={
            routes:'AND driver_id=?',drivers:'AND id=?',route_assignments:'AND route_id IN(SELECT id FROM routes WHERE driver_id=?)',
            stops:'AND route_id IN(SELECT id FROM routes WHERE driver_id=?)',incidents:'AND route_id IN(SELECT id FROM routes WHERE driver_id=?)',returns:'AND route_id IN(SELECT id FROM routes WHERE driver_id=?)',
            parcels:`AND id IN ${ownParcels}`,shipments:`AND id IN(SELECT p.shipment_id FROM parcels p WHERE p.id IN ${ownParcels})`,
            vehicles:'AND id IN(SELECT vehicle_id FROM routes WHERE driver_id=?)',driver_documents:'AND driver_id=?',
            attempts:'AND stop_id IN(SELECT s.id FROM stops s JOIN routes r ON r.id=s.route_id AND r.org_id=s.org_id WHERE r.driver_id=?)',
            custody_events:`AND parcel_id IN ${ownParcels}`
        };
        const collections=Object.fromEntries(await Promise.all(tables.map(async table=>{const filter=driver?driverFilters[table]:undefined;const order=table==='routes'?"CASE state WHEN 'IN_PROGRESS' THEN 0 WHEN 'READY' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END, rowid DESC":'rowid DESC';return [table,await s.all('SELECT * FROM '+table+' WHERE org_id=? '+(filter??'')+' ORDER BY '+order+' LIMIT ?',actor.orgId,...(filter?[actor.driverId!]:[]),cap)];}))) as Record<string,Row[]>;
        const totals=await s.all(tables.concat('evidence').map(table=>"SELECT '"+table+"' AS collection,COUNT(*) AS n FROM "+table+' WHERE org_id=?').join(' UNION ALL '),...tables.concat('evidence').map(()=>actor.orgId));
        const limitedCollections=totals.filter(row=>row.n>cap);
        const all=(table:string)=>collections[table];
        const [summaries,returnProofs,attemptItems,evidence]=await Promise.all([
            s.all("SELECT shipment_id,COUNT(*) AS expected,SUM(CASE WHEN state<>'EXPECTED' THEN 1 ELSE 0 END) AS received,SUM(CASE WHEN state='DELIVERED' THEN 1 ELSE 0 END) AS delivered,SUM(CASE WHEN state NOT IN('DELIVERED','RETURNED_TO_SENDER') THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN state='RETURNED_TO_SENDER' THEN 1 ELSE 0 END) AS returned,SUM(CASE WHEN state='EXPECTED' THEN 1 ELSE 0 END) AS missing FROM parcels WHERE org_id=? AND shipment_id IN("+(collections.shipments.length?collections.shipments.map(()=>'?').join(','):'NULL')+") GROUP BY shipment_id",actor.orgId,...collections.shipments.map(x=>x.id)),
            s.all("SELECT return_id,evidence_id FROM return_evidence WHERE org_id=? AND stage='DEPOT' AND return_id IN("+(collections.returns.length?collections.returns.map(()=>'?').join(','):'NULL')+")",actor.orgId,...collections.returns.map(x=>x.id)),
            s.all('SELECT ai.* FROM attempt_items ai WHERE attempt_id IN(SELECT id FROM attempts WHERE org_id=? ORDER BY rowid DESC LIMIT ?)',actor.orgId,cap),
            s.all('SELECT id,org_id,parcel_id,actor_id,filename,mime_type,created_at FROM evidence WHERE org_id=? ORDER BY rowid DESC LIMIT ?',actor.orgId,cap)
        ]);
        const countMap=new Map(summaries.map(({shipment_id,...counts})=>[shipment_id,counts]));
        const proofMap=new Map(returnProofs.map(row=>[row.return_id,row.evidence_id]));
        let routes=all('routes'),shipments=all('shipments'),parcels=all('parcels'),drivers=all('drivers'),vehicles=all('vehicles'),clients=all('clients');
        if(actor.role==='DRIVER') {
            routes=routes.filter(r=>r.driver_id===actor.driverId);
            const routeIds=new Set(routes.map(r=>r.id));
            const assignedIds=new Set(all('route_assignments').filter(a=>routeIds.has(a.route_id)).map(a=>a.parcel_id));
            parcels=parcels.filter(p=>assignedIds.has(p.id));
            const shipmentIds=new Set(parcels.map(p=>p.shipment_id));shipments=shipments.filter(x=>shipmentIds.has(x.id));
            drivers=drivers.filter(d=>d.id===actor.driverId);
            const vehicleIds=new Set(routes.map(r=>r.vehicle_id));vehicles=vehicles.filter(v=>vehicleIds.has(v.id));clients=[];
        }
        const profileMap=OPS.includes(actor.role)?await clientProfileSummaries(s,actor.orgId):new Map<string,Row>();
        const routeIds=new Set(routes.map(r=>r.id)),parcelIds=new Set(parcels.map(p=>p.id)),vehicleIds=new Set(vehicles.map(v=>v.id));
        const stops=all('stops').filter(x=>routeIds.has(x.route_id)),stopIds=new Set(stops.map(s=>s.id));
        return {
            clientProfilesEnabled:true,
            organization:{...camel((await s.one('SELECT * FROM organizations WHERE id=?',actor.orgId))!),supportContacts:await s.all("SELECT name,role FROM users WHERE org_id=? AND role IN('ADMIN','OPERATIONS') ORDER BY name",actor.orgId)},user:actor,
            clients:clients.map((client):Row=>({...camel(client),...profileMap.get(client.id)})),drivers:drivers.map(x=>({...camel(x),available:!!x.available})),vehicles:vehicles.map(x=>({...camel(x),available:!!x.available})),
            shipments:shipments.map((x):Row=>({...camel(x),counts:countMap.get(x.id)??{expected:0,received:0,delivered:0,pending:0,returned:0,missing:0}})),parcels:parcels.map(camel),routes:routes.map(camel),stops:stops.map(camel),
            assignments:all('route_assignments').filter(x=>routeIds.has(x.route_id)).map(x=>({...camel(x),active:!!x.active,pickup:!!x.pickup})),
            incidents:all('incidents').filter(x=>routeIds.has(x.route_id)).map(camel),returns:all('returns').filter(x=>routeIds.has(x.route_id)).map(x=>({...camel(x),depotEvidenceId:proofMap.get(x.id)??null})),
            driverDocuments:all('driver_documents').filter(x=>drivers.some(d=>d.id===x.driver_id)).map(x=>({...camel(x),blocksDispatch:!!x.blocks_dispatch})),
            defects:all('defects').filter(x=>vehicleIds.has(x.vehicle_id)).map(camel),documents:all('vehicle_documents').filter(x=>vehicleIds.has(x.vehicle_id)).map(x=>({...camel(x),blocksDispatch:!!x.blocks_dispatch})),
            inspections:all('inspections').filter(x=>vehicleIds.has(x.vehicle_id)).map(x=>({...camel(x),items:JSON.parse(x.items)})),maintenance:all('maintenance').filter(x=>vehicleIds.has(x.vehicle_id)).map(camel),
            attempts:all('attempts').filter(x=>stopIds.has(x.stop_id)).map(x=>({...camel(x),evidenceIds:JSON.parse(x.evidence_ids),items:attemptItems.filter(item=>item.attempt_id===x.id).map(camel)})),
            custodyEvents:all('custody_events').filter(x=>parcelIds.has(x.parcel_id)).map(camel),
            evidence:evidence.filter(x=>actor.role!=='DRIVER'||parcelIds.has(x.parcel_id)).map(camel),
            audit:all('audit').filter(x=>actor.role!=='DRIVER'||x.actor_id===actor.id).map(camel),
            tracking:{status:'PROVIDERS_AVAILABLE',message:'QuadMinds para Universo. Traccar para los repartos propios de Nexora.'},
            limits:{perCollection:cap,hasMore:limitedCollections.length>0,message:'Vista limitada a los últimos 500 registros por colección. Los conteos corresponden a la vista cargada; consultá /api/shipments para paginar envíos.'}
        };
    }
}
