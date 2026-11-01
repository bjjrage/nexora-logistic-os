import {randomUUID} from 'node:crypto';
import {test,expect} from '../support/e2e-test.ts';

test('bulk load and unload keep reservations accurate across several orders',async({page})=>{
 const post=async(path:string,body:Record<string,unknown>)=>{
  const response=await page.request.post(path,{headers:{'X-Requested-With':'logistics-os'},data:{commandId:randomUUID(),...body}});
  expect(response.ok(),`${path}: ${await response.text()}`).toBeTruthy();return response.json();
 };
 const session=await(await page.request.get('/api/session')).json();
 if(session.setupRequired)await post('/api/setup',{organizationName:'QA bultos en lote',timezone:'America/Asuncion',username:'qa-browser',password:'QA-Browser-Isolated-2026!'});
 else await post('/api/login',{username:'qa-browser',password:'QA-Browser-Isolated-2026!'});
 const suffix=randomUUID().slice(0,8);
 const client=(await post('/api/clients',{name:'Cliente lote '+suffix})).id;
 const driver=(await post('/api/drivers',{name:'Chofer lote '+suffix,username:'bulk-'+suffix,password:'QA-Bulk-Driver-2026!'})).id;
 const vehicle=(await post('/api/vehicles',{plate:'BULK-'+suffix,capacityWeightGrams:5000,capacityVolumeCm3:10000,odometer:0})).id;
 const location=(await post('/api/inventory/locations',{code:'BULK-'+suffix,name:'Depósito lote'})).id;
 const product=(await post('/api/inventory/products',{clientId:client,sku:'BULK-'+suffix,name:'Caja lote '+suffix,tracking:'QUANTITY',weightGrams:100,volumeCm3:100})).id;
 await post('/api/inventory/receipts',{clientId:client,productId:product,locationId:location,quantity:10});
 const orders:Array<{id:string;parcelIds:string[];codes:string[]}>=[];
 for(let i=1;i<=2;i++){
  const id=(await post('/api/orders',{clientId:client,externalId:`BULK-${suffix}-${i}`,orderDate:'2026-10-28',recipientName:'Receptor '+i,destination:'Destino '+i,lines:[{productId:product,quantity:5}]})).id;
  const reservation=await post(`/api/orders/${id}/reserve`,{});
  orders.push({id,parcelIds:reservation.parcels.map((parcel:{id:string})=>parcel.id),codes:reservation.parcels.map((parcel:{code:string})=>parcel.code)});
 }
 const routeName='Ruta lote '+suffix;
 const route=(await post('/api/routes',{name:routeName,driverId:driver,vehicleId:vehicle,trackingProvider:'TRACCAR',startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()})).id;
 await post(`/api/routes/${route}/assignments`,{expectedVersion:1,parcelIds:orders.flatMap(order=>order.parcelIds),pickup:false});
 const bootstrap=async()=> (await(await page.request.get('/api/bootstrap')).json());
 const routeData=async()=> (await bootstrap()).routes.find((item:{id:string})=>item.id===route);

 await page.goto('/');await page.getByRole('button',{name:'Rutas',exact:true}).click();
 await page.getByText('Buscar rutas e historial',{exact:true}).click();
 await page.getByRole('searchbox',{name:'Buscar ruta',exact:true}).fill(suffix);
 await page.getByRole('button',{name:new RegExp(routeName)}).click();
 const load=page.getByRole('region',{name:'Carga del vehículo',exact:true});
 await expect(load).toContainText('Cargados 0 de 10 bultos.');
 await load.getByRole('button',{name:'Seleccionar pendientes',exact:true}).click();
 await load.getByRole('button',{name:'Confirmar carga',exact:true}).click();
 for(const order of orders)await expect.poll(async()=> (await(await page.request.get(`/api/orders/${order.id}`)).json()).status).toBe('LOADED');

 await page.getByRole('button',{name:'Bajar artículos (10)',exact:true}).click();
 const unload=page.getByRole('region',{name:'Artículos en el vehículo',exact:true});
 await expect(unload.getByRole('region',{name:'Gestionar varios bultos',exact:true})).toContainText('0 seleccionados');
 await unload.getByRole('button',{name:'Seleccionar todos',exact:true}).click();
 await expect(unload.getByRole('region',{name:'Gestionar varios bultos',exact:true})).toContainText('10 seleccionados');
 page.once('dialog',dialog=>dialog.accept());
 await unload.getByRole('button',{name:'Bajar al depósito (10)',exact:true}).click();
 for(const order of orders)await expect.poll(async()=> (await(await page.request.get(`/api/orders/${order.id}`)).json()).status).toBe('RESERVED');
 expect((await routeData()).state).toBe('DRAFT');
 const reconciliation=await(await page.request.get('/api/inventory/reconciliation')).json();
 expect(reconciliation.ok).toBe(true);

 const allParcelIds=orders.flatMap(order=>order.parcelIds);
 await post(`/api/routes/${route}/unassign-selected`,{expectedVersion:(await routeData()).version,parcelIds:allParcelIds});
 expect((await bootstrap()).assignments.filter((assignment:{active:boolean;routeId:string})=>assignment.active&&assignment.routeId===route)).toHaveLength(0);
 for(const order of orders)await expect.poll(async()=> (await(await page.request.get(`/api/orders/${order.id}`)).json()).status).toBe('RESERVED');
 expect((await(await page.request.get('/api/inventory/reconciliation')).json()).ok).toBe(true);
});
