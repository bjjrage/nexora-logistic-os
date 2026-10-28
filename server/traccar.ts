import { z } from 'zod';
import type { Database } from './database.ts';
import { authorize, type Actor } from './auth.ts';
import { Logistics } from './domain.ts';
import { ensure } from './errors.ts';
import {bindVehiclePhone} from './vehicle-phone.ts';

export const STALE_AFTER_MS = 180_000;
export { normalizeTraccarPosition } from './traccar-position.ts';

export class TraccarTracking {
  private store: Database;
  private env: NodeJS.ProcessEnv;
  private request: typeof fetch;
  private clock: () => number;
  constructor(store: Database, env = process.env, request: typeof fetch = fetch, clock = Date.now) { this.store=store;this.env=env;this.request=request;this.clock=clock; }
  configured() { return this.store.kind === 'postgres' && this.env.TRACCAR_ENABLED === 'true' && !!this.env.TRACCAR_GATEWAY_URL && (this.env.TRACCAR_GATEWAY_SECRET?.length ?? 0) >= 32; }
  async settings(actor: Actor) {
    authorize(actor, ['ADMIN','OPERATIONS']);
    const source = await this.store.one("SELECT connected,checked_at FROM tracking_source_state WHERE source='TRACCAR'");
    return { provider: 'TRACCAR', configured: this.configured(), connected: !!source?.connected && this.clock()-Date.parse(source.checked_at)<90_000,
      checkedAt: source?.checked_at ?? null,
      latestPositionAt: (await this.store.one(`SELECT MAX(p.measured_at) AS measured_at FROM traccar_latest p JOIN traccar_vehicle_bindings b ON b.org_id=p.org_id AND b.vehicle_id=p.vehicle_id AND b.device_id=p.device_id AND b.revision=p.revision WHERE p.org_id=?`,actor.orgId))?.measured_at ?? null,
      devices: await this.store.all('SELECT device_id AS id,name,unique_id AS identifier FROM traccar_devices WHERE org_id=? ORDER BY name', actor.orgId),
      bindings: await this.store.all('SELECT vehicle_id AS "vehicleId",device_id AS "deviceId" FROM traccar_vehicle_bindings WHERE org_id=?', actor.orgId),
      routes: await this.store.all('SELECT route_id AS "routeId",provider FROM route_tracking_settings WHERE org_id=?', actor.orgId),
      policies: await this.store.all('SELECT client_id AS "clientId",delivery_provider AS "deliveryProvider" FROM client_delivery_policies WHERE org_id=?', actor.orgId),
      lockedPolicies: await this.store.all('SELECT client_id AS "clientId",delivery_provider AS "deliveryProvider" FROM client_delivery_locks WHERE org_id=?', actor.orgId),
      phoneUrl: this.env.TRACCAR_PHONE_URL ?? null };
  }
  async health() {
    const source=await this.store.one("SELECT connected,checked_at FROM tracking_source_state WHERE source='TRACCAR'");
    return {provider:'TRACCAR',configured:this.configured(),connected:!!source?.connected&&this.clock()-Date.parse(source.checked_at)<90_000};
  }
  async createDevice(actor: Actor, input: unknown) {
    authorize(actor,['ADMIN','OPERATIONS']);
    const body=z.object({commandId:z.uuid(),name:z.string().trim().min(1).max(80)}).parse(input);
    ensure(this.configured(),'INTEGRATION_NOT_CONFIGURED','Traccar no está configurado en este servidor.',503);
    const url=new URL(this.env.TRACCAR_GATEWAY_URL!);
    ensure(url.protocol==='https:'&&!url.username&&!url.password,'INTEGRATION_NOT_CONFIGURED','La pasarela requiere HTTPS.',503);
    const result=await this.request(new URL('/devices',url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.env.TRACCAR_GATEWAY_SECRET}`},body:JSON.stringify({...body,orgId:actor.orgId})});
    ensure(result.ok,'TRACKING_PROVIDER_ERROR','No se pudo registrar el teléfono. Reintentá con la misma operación.',502);
    return result.json();
  }
  async bind(actor: Actor, vehicleId: string, input: unknown) {
    const body=z.object({commandId:z.uuid(),deviceId:z.string().regex(/^\d+$/).nullable()}).parse(input),domain=new Logistics(this.store);
    return domain.command(actor,`vehicles.${vehicleId}.traccar`,body,['ADMIN','OPERATIONS'],async()=>{
      await bindVehiclePhone(this.store,actor.orgId,vehicleId,body.deviceId,this.clock);
      return {id:vehicleId,deviceId:body.deviceId};
    });
  }
  async clientPolicy(actor: Actor, clientId: string, input: unknown) {
    const body=z.object({commandId:z.uuid(),deliveryProvider:z.enum(['QUADMINDS','NEXORA'])}).parse(input),domain=new Logistics(this.store);
    return domain.command(actor,`clients.${clientId}.delivery-provider`,body,['ADMIN'],async()=>{
      await domain.record('clients',clientId,actor);
      const lock=await this.store.one('SELECT delivery_provider FROM client_delivery_locks WHERE org_id=? AND client_id=?',actor.orgId,clientId);
      ensure(!lock||lock.delivery_provider===body.deliveryProvider,'INVALID_TRANSITION','Este cliente tiene un circuito de reparto protegido por contrato.');
      const current=await this.store.one('SELECT delivery_provider FROM client_delivery_policies WHERE org_id=? AND client_id=?',actor.orgId,clientId);
      if(current?.delivery_provider===body.deliveryProvider)return {id:clientId,deliveryProvider:body.deliveryProvider,unchanged:true};
      ensure(!await this.store.one("SELECT a.id FROM route_assignments a JOIN parcels p ON p.id=a.parcel_id JOIN shipments s ON s.id=p.shipment_id JOIN routes r ON r.id=a.route_id WHERE s.org_id=? AND s.client_id=? AND a.active=1 AND r.state IN('READY','IN_PROGRESS')",actor.orgId,clientId),'INVALID_TRANSITION','No se cambia el circuito de un cliente con repartos comprometidos.');
      if(body.deliveryProvider==='NEXORA')ensure(!await this.store.one('SELECT q.parcel_id FROM quad_parcel_links q JOIN parcels p ON p.id=q.parcel_id JOIN shipments s ON s.id=p.shipment_id WHERE s.org_id=? AND s.client_id=?',actor.orgId,clientId),'INVALID_TRANSITION','Este cliente tiene órdenes QuadMinds; conservá su circuito.');
      await this.store.run('INSERT INTO client_delivery_policies VALUES(?,?,?,?) ON CONFLICT(org_id,client_id) DO UPDATE SET delivery_provider=excluded.delivery_provider,updated_at=excluded.updated_at',actor.orgId,clientId,body.deliveryProvider,new Date(this.clock()).toISOString());
      return {id:clientId,deliveryProvider:body.deliveryProvider};
    });
  }
  async routePolicy(actor: Actor, routeId: string, input: unknown) {
    const body=z.object({commandId:z.uuid(),provider:z.enum(['QUADMINDS','TRACCAR'])}).parse(input),domain=new Logistics(this.store);
    return domain.command(actor,`routes.${routeId}.tracking-provider`,body,['ADMIN','OPERATIONS'],async()=>{
      const route=await domain.route(routeId,actor);
      const current=await this.store.one('SELECT provider FROM route_tracking_settings WHERE org_id=? AND route_id=?',actor.orgId,routeId);
      if(current?.provider===body.provider)return {id:routeId,provider:body.provider,unchanged:true};
      ensure(route.state==='DRAFT','INVALID_TRANSITION','Elegí el tracking antes de confirmar la ruta.');
      if(body.provider==='TRACCAR')ensure(!await this.store.one('SELECT route_id FROM quad_route_links WHERE org_id=? AND route_id=?',actor.orgId,routeId),'INVALID_TRANSITION','La ruta está vinculada a QuadMinds.');
      await validateRouteProvider(this.store,actor.orgId,routeId,body.provider);
      await this.store.run('INSERT INTO route_tracking_settings VALUES(?,?,?,?) ON CONFLICT(org_id,route_id) DO UPDATE SET provider=excluded.provider,updated_at=excluded.updated_at',actor.orgId,routeId,body.provider,new Date(this.clock()).toISOString());
      return {id:routeId,provider:body.provider};
    });
  }
  async route(actor: Actor, routeId: string) {
    authorize(actor,['ADMIN','OPERATIONS','DRIVER']);
    const route=await new Logistics(this.store).route(routeId,actor);
    const binding=await this.store.one('SELECT * FROM traccar_vehicle_bindings WHERE org_id=? AND vehicle_id=?',actor.orgId,route.vehicle_id);
    const point=binding?await this.store.one('SELECT * FROM traccar_latest WHERE org_id=? AND vehicle_id=? AND device_id=? AND revision=?',actor.orgId,route.vehicle_id,binding.device_id,binding.revision):null;
    const source=await this.store.one("SELECT * FROM tracking_source_state WHERE source='TRACCAR'");
    const sourceError=!source?.connected||this.clock()-Date.parse(source.checked_at)>90_000?'TRACKING_DISCONNECTED':null;
    const ageSeconds=point?Math.max(0,Math.floor((this.clock()-Date.parse(point.measured_at))/1000)):null;
    return {provider:'TRACCAR',routeId,vehicleId:route.vehicle_id,scope:'CURRENT_VEHICLE_POSITION',status:!point?'NO_POSITION':sourceError||ageSeconds!>STALE_AFTER_MS/1000?'STALE':'FRESH',
      sourceError,checkedAt:source?.checked_at??null,ageSeconds,pollIntervalMs:15000,staleAfterMs:STALE_AFTER_MS,
      position:point?{latitude:point.latitude,longitude:point.longitude,accuracy:point.accuracy,measuredAt:point.measured_at,receivedAt:point.received_at}:null};
  }
}

export async function validateRouteProvider(store: Database, orgId: string, routeId: string, requestedProvider?:'TRACCAR'|'QUADMINDS') {
  const setting=await store.one('SELECT provider FROM route_tracking_settings WHERE org_id=? AND route_id=?',orgId,routeId);
  const provider=requestedProvider??setting?.provider??'QUADMINDS';
  const missing=await store.one(`SELECT cl.name FROM route_assignments a JOIN parcels p ON p.id=a.parcel_id AND p.org_id=a.org_id
    JOIN shipments s ON s.id=p.shipment_id AND s.org_id=p.org_id JOIN clients cl ON cl.id=s.client_id AND cl.org_id=s.org_id
    LEFT JOIN client_delivery_policies c ON c.org_id=s.org_id AND c.client_id=s.client_id
    WHERE a.org_id=? AND a.route_id=? AND a.active=1 AND c.client_id IS NULL LIMIT 1`,orgId,routeId);
  ensure(!missing,'INVALID_TRANSITION','Antes de elegir el GPS, definí el circuito de reparto de cada cliente en Tracking > Sistema por cliente. Universo conserva QuadMinds.');
  const incompatible=await store.one(`SELECT a.id FROM route_assignments a JOIN parcels p ON p.id=a.parcel_id AND p.org_id=a.org_id
    JOIN shipments s ON s.id=p.shipment_id AND s.org_id=p.org_id JOIN clients cl ON cl.id=s.client_id AND cl.org_id=s.org_id LEFT JOIN client_delivery_policies c ON c.org_id=s.org_id AND c.client_id=s.client_id
    WHERE a.org_id=? AND a.route_id=? AND a.active=1 AND c.delivery_provider<>?`,orgId,routeId,provider==='TRACCAR'?'NEXORA':'QUADMINDS');
  ensure(!incompatible,'INVALID_TRANSITION','La ruta mezcla clientes con circuitos distintos. Separá Universo/QuadMinds de los repartos Nexora/Traccar.');
}

export async function validateParcelRouteProvider(store:Database,orgId:string,routeId:string,parcelIds:string[]) {
  const setting=await store.one('SELECT provider FROM route_tracking_settings WHERE org_id=? AND route_id=?',orgId,routeId);
  const provider=setting?.provider??'QUADMINDS';
  for(const parcelId of [...new Set(parcelIds)]){
    const client=await store.one(`SELECT cl.name,c.delivery_provider FROM parcels p JOIN shipments s ON s.id=p.shipment_id AND s.org_id=p.org_id
      JOIN clients cl ON cl.id=s.client_id AND cl.org_id=s.org_id LEFT JOIN client_delivery_policies c ON c.org_id=s.org_id AND c.client_id=s.client_id
      WHERE p.org_id=? AND p.id=?`,orgId,parcelId);
    ensure(client,'NOT_FOUND','El bulto no tiene un cliente válido.',404);
    const circuit=client.delivery_provider;
    ensure(circuit||provider!=='TRACCAR','INVALID_TRANSITION',`Definí el circuito de ${client.name} en Tracking > Sistema por cliente antes de asignar este pedido a una ruta Traccar.`);
    ensure(!circuit||circuit===(provider==='TRACCAR'?'NEXORA':'QUADMINDS'),'INVALID_TRANSITION','Este pedido usa un circuito distinto al GPS de la ruta. Universo conserva QuadMinds; los repartos Nexora usan Traccar.');
  }
}
