import {test,expect} from '../support/e2e-test.ts';
import {randomUUID} from 'node:crypto';

test('reserved orders can be added to a confirmed route, loaded, and confirmed again',async({page})=>{
 const send=async(path:string,data:Record<string,unknown>)=>{const response=await page.request.post(path,{headers:{'X-Requested-With':'logistics-os'},data:{commandId:randomUUID(),...data}});expect(response.ok(),path+': '+await response.text()).toBeTruthy();return response.json();};
 const session=await(await page.request.get('/api/session')).json();
 if(session.setupRequired)await send('/api/setup',{organizationName:'QA varias entregas',timezone:'America/Asuncion',username:'qa-browser',password:'QA-Browser-Isolated-2026!'});else await send('/api/login',{username:'qa-browser',password:'QA-Browser-Isolated-2026!'});
 const suffix=randomUUID().slice(0,8),name='Ruta compartida '+suffix;
 const client=(await send('/api/clients',{name:'Cliente '+suffix})).id;
 await send('/api/clients/'+client+'/delivery-provider',{deliveryProvider:'NEXORA'});
 const driver=(await send('/api/drivers',{name:'Chofer '+suffix,username:'drv-'+suffix,password:'QA-Driver-Flow-2026!'})).id;
 const vehicle=(await send('/api/vehicles',{plate:'MULT-'+suffix,capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
 const location=(await send('/api/inventory/locations',{code:'DEP-'+suffix,name:'DepÃ³sito QA'})).id;
 const product=(await send('/api/inventory/products',{clientId:client,sku:'MULT-'+suffix,name:'ArtÃ­culo QA',tracking:'QUANTITY',weightGrams:100,volumeCm3:100})).id;
 await send('/api/inventory/receipts',{clientId:client,productId:product,locationId:location,quantity:3});
 const orders:Array<{id:string;parcel:string}> = [];
 for(let i=1;i<=3;i++){
  const id=(await send('/api/orders',{clientId:client,externalId:`MULT-${suffix}-${i}`,orderDate:'2026-10-28',recipientName:'Receptor '+i,destination:'Destino '+i,lines:[{productId:product,quantity:1}]})).id;
  const reservation=await send('/api/orders/'+id+'/reserve',{});orders.push({id,parcel:reservation.parcels[0].id});
 }
 const route=(await send('/api/routes',{name,driverId:driver,vehicleId:vehicle,trackingProvider:'TRACCAR',startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()})).id;
 const current=async()=> (await(await page.request.get('/api/bootstrap')).json()).routes.find((r:any)=>r.id===route);
 await send('/api/routes/'+route+'/assignments',{expectedVersion:1,parcelIds:[orders[0].parcel],pickup:false});

 await page.goto('/');await page.getByRole('button',{name:'Rutas',exact:true}).click();
 await page.getByText('Buscar rutas e historial',{exact:true}).click();
 await page.getByRole('searchbox',{name:'Buscar ruta',exact:true}).fill(suffix);
 await page.getByRole('button',{name:new RegExp(name)}).click();
 const load=page.getByRole('region',{name:'Carga del veh\u00edculo'});
 const loadOrder=async(index:number)=>{
  const parcel=load.locator('.parcel-row').filter({hasText:`MULT-${suffix}-${index+1}`});
  await expect(parcel).toBeVisible();await parcel.getByRole('checkbox').check();
  await load.getByRole('button',{name:'Confirmar carga',exact:true}).click();
  await expect.poll(async()=> (await(await page.request.get('/api/orders/'+orders[index].id)).json()).status).toBe('LOADED');
 };
 await expect(load).toContainText('Cargados 0 de 1 bultos.');
 await loadOrder(0);
 await expect(load).toContainText('Carga completa.');
 await page.getByRole('button',{name:'Confirmar ruta',exact:true}).click();
 expect((await current()).state).toBe('READY');

 const addOrder=async(index:number)=>{
  await send('/api/routes/'+route+'/assignments',{expectedVersion:(await current()).version,parcelIds:[orders[index].parcel],pickup:false});
  await page.getByRole('button',{name:'Actualizar',exact:true}).click();
  await expect.poll(async()=> (await current()).state).toBe('DRAFT');
  await page.getByRole('button',{name:/Cargar artículos/}).click();
  await expect(load).toContainText(`Cargados ${index} de ${index+1} bultos.`);
  await loadOrder(index);
  await page.getByRole('button',{name:'Confirmar ruta',exact:true}).click();
  expect((await current()).state).toBe('READY');
 };
 await addOrder(1);
 await page.getByRole('button',{name:/Cargar artículos/}).click();
 await expect(page.getByRole('region',{name:'Carga del veh\u00edculo'})).toContainText('Cargados 2 de 2 bultos.');
 await addOrder(2);
 await expect(page.getByRole('button',{name:'Paradas (3)',exact:true})).toBeVisible();
 expect((await current()).state).toBe('READY');
 for(const order of orders)expect((await(await page.request.get('/api/orders/'+order.id)).json()).status).toBe('LOADED');
 expect((await(await page.request.get('/api/inventory/reconciliation')).json()).ok).toBe(true);
});
