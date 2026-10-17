import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Store} from '../server/db.ts';
import {setup,passwordHash,hash} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {createApp} from '../server/app.ts';
test('direct HTTP cross-tenant matrix: reads and valid mutations cannot reach another organization',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const initial=await setup(store,{organizationName:'A',timezone:'UTC',username:'matrix-a',password:'QA-Matrix-A-2026!'});
 const actor={id:initial.userId,orgId:initial.orgId,name:'A',role:'ADMIN' as const,driverId:null},domain=new Logistics(store),inv=new Inventory(store),command=()=>({commandId:randomUUID()});
 const client=(await domain.createClient(actor,{...command(),name:'PRIVATE_CLIENT_A'})).id;
 const driver=(await domain.createDriver(actor,{...command(),name:'PRIVATE_DRIVER_A',username:'matrix-driver',password:'QA-Matrix-Driver-2026!'})).id;
 const vehicle=(await domain.createVehicle(actor,{...command(),plate:'PRIVATE-VEHICLE-A',capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
 const shipment=(await domain.createShipment(actor,{...command(),clientId:client,reference:'PRIVATE_REF_A',originText:'A',destinationText:'B',recipientName:'PRIVATE_RECEIVER_A',parcelCount:1,proofPolicy:'RECEIVER',weightGrams:1,volumeCm3:1,recipientPhone:''})).id;
 const route=(await domain.createRoute(actor,{...command(),name:'PRIVATE_ROUTE_A',driverId:driver,vehicleId:vehicle,startAt:new Date().toISOString(),endAt:new Date(Date.now()+3600000).toISOString()})).id;
 const parcel=(await store.one('SELECT id FROM parcels WHERE shipment_id=?',shipment))!.id;
 const evidence=(await domain.upload(actor,{...command(),parcelId:parcel,filename:'qa.png',mimeType:'image/png',dataBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCioAAAAASUVORK5CYII='})).id;
 const location=(await inv.createLocation(actor,{...command(),code:'QA',name:'PRIVATE_LOCATION_A'})).id;
 const product=(await inv.createProduct(actor,{...command(),clientId:client,sku:'QA-MATRIX',name:'PRIVATE_PRODUCT_A',tracking:'QUANTITY'})).id;
 const order=(await inv.createOrder(actor,{...command(),clientId:client,externalId:'QA-MATRIX',orderDate:'2026-10-17',destination:'B',recipientName:'QA',lines:[{productId:product,quantity:1}]})).id;
 const orgB=randomUUID(),userB=randomUUID(),token=randomBytes(32).toString('hex');await store.run('INSERT INTO organizations VALUES(?,?,?)',orgB,'B','UTC');await store.run('INSERT INTO users VALUES(?,?,?,?,?,?,NULL)',userB,orgB,'matrix-b','B',passwordHash('QA-Matrix-B-2026!'),'ADMIN');await store.run('INSERT INTO sessions VALUES(?,?,?)',hash(token),userB,new Date(Date.now()+60000).toISOString());
 const server=createApp(store).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const reads=[`/api/shipments/${shipment}`,`/api/orders/${order}`,`/api/evidence/${evidence}`,`/api/routes/${route}/tracking`,`/api/inventory?clientId=${client}`,`/api/orders/read?clientId=${client}`];
 const writes:[string,Record<string,unknown>][]=[
 [`/api/clients/${client}`,{name:'ATTACK',orgId:actor.orgId}],
 [`/api/routes/${route}/ready`,{expectedVersion:1}],
 [`/api/routes/${route}/tracking-provider`,{provider:'TRACCAR'}],
 [`/api/clients/${client}/delivery-provider`,{deliveryProvider:'NEXORA'}],
 [`/api/vehicles/${vehicle}/traccar-binding`,{deviceId:'999'}],
 [`/api/drivers/${driver}/documents`,{name:'QA',expiresAt:new Date(Date.now()+86400000).toISOString(),blocksDispatch:false}],
 [`/api/orders/${order}/reserve`,{locationId:location}],
 ['/api/inventory/receipts',{clientId:client,productId:product,locationId:location,quantity:1}],
 ['/api/password-recovery/issue',{kind:'USER',id:actor.id}]
 ];
 for(const path of reads){const response=await fetch(origin+path,{headers:{cookie:`logistics_session=${token}`}});assert.ok([403,404].includes(response.status),`${path}: ${response.status}`);assert.doesNotMatch(await response.text(),/PRIVATE_/);}
 for(const [path,body]of writes){const response=await fetch(origin+path,{method:'POST',headers:{cookie:`logistics_session=${token}`,'Content-Type':'application/json','X-Requested-With':'logistics-os',Origin:origin},body:JSON.stringify({...(!path.includes('password-recovery')?command():{}),...body})});assert.ok([403,404].includes(response.status),`${path}: ${response.status} ${await response.text()}`);}
 assert.equal((await store.one('SELECT name FROM clients WHERE id=?',client))!.name,'PRIVATE_CLIENT_A');assert.equal((await store.one('SELECT COUNT(*) AS n FROM inventory_movements'))!.n,0);assert.equal((await store.one('SELECT COUNT(*) AS n FROM password_recovery'))!.n,0);
});
