import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('varios pedidos se agregan a la misma ruta confirmada o en preparación',async({page})=>{
 const send=async(path:string,data:Record<string,unknown>)=>{const response=await page.request.post(path,{headers:{'X-Requested-With':'logistics-os'},data:{commandId:randomUUID(),...data}});expect(response.ok(),path+': '+await response.text()).toBeTruthy();return response.json();};
 const session=await(await page.request.get('/api/session')).json();
 if(session.setupRequired)await send('/api/setup',{organizationName:'QA varias entregas',timezone:'America/Asuncion',username:'qa-browser',password:'QA-Browser-Isolated-2026!'});else await send('/api/login',{username:'qa-browser',password:'QA-Browser-Isolated-2026!'});
 const suffix=randomUUID().slice(0,8),name='Ruta compartida '+suffix;
 const client=(await send('/api/clients',{name:'Cliente '+suffix})).id;
 await send('/api/clients/'+client+'/delivery-provider',{deliveryProvider:'NEXORA'});
 const driver=(await send('/api/drivers',{name:'Chofer '+suffix,username:'drv-'+suffix,password:'QA-Driver-Flow-2026!'})).id;
 const vehicle=(await send('/api/vehicles',{plate:'MULT-'+suffix,capacityWeightGrams:10000,capacityVolumeCm3:10000,odometer:0})).id;
 const location=(await send('/api/inventory/locations',{code:'DEP-'+suffix,name:'Depósito QA'})).id;
 const product=(await send('/api/inventory/products',{clientId:client,sku:'MULT-'+suffix,name:'Artículo QA',tracking:'QUANTITY',weightGrams:100,volumeCm3:100})).id;
 await send('/api/inventory/receipts',{clientId:client,productId:product,locationId:location,quantity:3});
 const orders=[];
 for(let i=1;i<=3;i++){
  const id=(await send('/api/orders',{clientId:client,externalId:`MULT-${suffix}-${i}`,orderDate:'2026-10-28',recipientName:'Receptor '+i,destination:'Destino '+i,lines:[{productId:product,quantity:1}]})).id;
  const reservation=await send('/api/orders/'+id+'/reserve',{});orders.push({id,parcel:reservation.parcels[0].id});
 }
 const route=(await send('/api/routes',{name,driverId:driver,vehicleId:vehicle,trackingProvider:'TRACCAR',startAt:new Date(Date.now()-60000).toISOString(),endAt:new Date(Date.now()+3600000).toISOString()})).id;
 const current=async()=> (await(await page.request.get('/api/bootstrap')).json()).routes.find((r:any)=>r.id===route);
 await send('/api/routes/'+route+'/assignments',{expectedVersion:await current().then(r=>r.version),parcelIds:[orders[0].parcel],pickup:false});
 await send('/api/routes/'+route+'/load-selected',{expectedVersion:await current().then(r=>r.version),parcelIds:[orders[0].parcel]});
 await send('/api/routes/'+route+'/ready',{expectedVersion:await current().then(r=>r.version)});
 await page.goto('/');
 const assignFromOrder=async(index:number,confirmed:boolean,stay=false)=>{
  await page.getByRole('button',{name:'Pedidos',exact:true}).click();
  await page.getByRole('textbox',{name:'Buscar pedidos',exact:true}).fill(`MULT-${suffix}-${index+1}`);
  await page.getByRole('article').filter({hasText:`MULT-${suffix}-${index+1}`}).getByRole('button',{name:'Gestionar reserva',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Reserva y ruta'}),select=dialog.getByRole('combobox',{name:'Ruta para este pedido'});
  await expect(select.locator(`option[value="${route}"]`)).toContainText('MULT-'+suffix);
  await select.selectOption(route);
  if(confirmed)await expect(dialog.getByText(/quedará pendiente de confirmación/)).toBeVisible();
  await dialog.getByRole('button',{name:stay?'Asignar y seguir en Pedidos':'Asignar e ir a cargar',exact:true}).click();
  if(stay){
   await expect(dialog).toHaveCount(0);
   await page.getByRole('article').filter({hasText:`MULT-${suffix}-${index+1}`}).getByRole('button',{name:'Abrir ruta · '+name,exact:true}).click();
  }
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Confirmar ruta',exact:true})).toBeDisabled();
 };
 await assignFromOrder(1,true);
 expect((await current()).state).toBe('DRAFT');
 await expect(page.getByRole('region',{name:'Carga del vehículo'})).toContainText('Cargados 1 de 2 bultos.');
 await assignFromOrder(2,false,true);
 await expect(page.getByRole('region',{name:'Carga del vehículo'})).toContainText('Cargados 1 de 3 bultos.');
 await expect(page.getByRole('button',{name:'Paradas (3)',exact:true})).toBeVisible();
 const load=page.getByRole('region',{name:'Carga del vehículo'});
 await load.getByRole('button',{name:'Seleccionar pendientes'}).click();
 await load.getByRole('button',{name:'Confirmar carga',exact:true}).click();
 await page.getByRole('button',{name:'Confirmar ruta',exact:true}).click();
 expect((await current()).state).toBe('READY');
 for(const order of orders)expect((await(await page.request.get('/api/orders/'+order.id)).json()).status).toBe('LOADED');
 expect((await(await page.request.get('/api/inventory/reconciliation')).json()).ok).toBe(true);
});
