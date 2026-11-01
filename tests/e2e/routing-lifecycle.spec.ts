import {randomUUID} from 'node:crypto';
import {test,expect} from '../support/routing-test.ts';

test('reserves six orders, approves two distinct crews, then loads, dispatches, delivers and closes both routes',async({page})=>{
 test.setTimeout(180000);
 const send=async(path:string,data:Record<string,unknown>)=>{
  const response=await page.request.post(path,{headers:{'X-Requested-With':'logistics-os'},data:{commandId:randomUUID(),...data}});
  expect(response.ok(),path+': '+await response.text()).toBeTruthy();return response.json();
 };
 const bootstrap=async()=> (await(await page.request.get('/api/bootstrap')).json());
 await send('/api/setup',{organizationName:'QA ciclo de reparto',timezone:'UTC',username:'qa-lifecycle',password:'Routing-Lifecycle-2026!'});
 const client=(await send('/api/clients',{name:'Cliente ciclo de reparto'})).id;
 await send('/api/clients/'+client+'/delivery-provider',{deliveryProvider:'NEXORA'});
 const location=(await send('/api/inventory/locations',{code:'CICLO-BASE',name:'Base de prueba'})).id;
 const product=(await send('/api/inventory/products',{clientId:client,sku:'CICLO-1',name:'Caja de prueba',tracking:'QUANTITY',weightGrams:100,volumeCm3:100})).id;
 await send('/api/inventory/receipts',{clientId:client,productId:product,locationId:location,quantity:6});
 await send('/api/routing/points',{kind:'LOCATION',id:location,latitude:-25.3,longitude:-57.6});
 for(let i=1;i<=2;i++){
  await send('/api/vehicles',{plate:'CICLO-'+i,capacityWeightGrams:300,capacityVolumeCm3:10000,odometer:0});
  await send('/api/drivers',{name:'Chofer ciclo '+i,username:'ciclo-driver-'+i,password:'Routing-Lifecycle-Driver-2026!'});
 }
 const date=new Date().toISOString().slice(0,10),orderIds:string[]=[];
 for(let i=1;i<=6;i++){
  const order=(await send('/api/orders',{clientId:client,externalId:'CICLO-PEDIDO-'+i,orderDate:date,recipientName:'Receptor '+i,destination:'Dirección sintética '+i,lines:[{productId:product,quantity:1}]})).id;
  orderIds.push(order);
  const reserved=await send('/api/orders/'+order+'/reserve',{});
  expect(reserved.parcels).toHaveLength(1);
  await send('/api/routing/points',{kind:'ORDER',id:order,latitude:-25.3-i*.002,longitude:-57.6});
 }
 for(const id of orderIds)expect((await(await page.request.get('/api/orders/'+id)).json()).status).toBe('RESERVED');

 await page.goto('/');await page.getByRole('button',{name:'Rutas',exact:true}).click();
 const board=page.getByRole('region',{name:'Reservados por organizar'});
 await board.getByRole('button',{name:'Organizar todos los reservados'}).click();
 const proposal=board.getByRole('region',{name:'Propuesta de distribución'});
 // The real OR-Tools child runs its bounded local search before rendering the proposal.
 await expect(proposal).toContainText('6 pedidos agrupados',{timeout:15000});
 await expect(proposal.getByRole('article')).toHaveCount(2);
 for(let i=1;i<=2;i++){await expect(proposal).toContainText('CICLO-'+i);await expect(proposal).toContainText('Chofer ciclo '+i);}
 const pending=await(await page.request.get('/api/routing/queue')).json();
 expect(pending.proposal.proposedRoutes).toHaveLength(2);
 expect(new Set(pending.proposal.proposedRoutes.map((route:any)=>route.vehicleId)).size).toBe(2);
 expect(new Set(pending.proposal.proposedRoutes.map((route:any)=>route.driverId)).size).toBe(2);
 expect(pending.proposal.proposedRoutes.flatMap((route:any)=>route.stops.map((stop:any)=>stop.orderId))).toHaveLength(6);
 await proposal.getByLabel('Revisé la distribución, las ubicaciones y las indicaciones de entrega').check();
 await proposal.getByRole('button',{name:'Aprobar distribución y crear rutas'}).click();
 const organized=board.getByRole('region',{name:'Pedidos organizados por camión'});
 await expect(organized.getByRole('article')).toHaveCount(2);

 const queue=await(await page.request.get('/api/routing/queue')).json();
 const trucks=queue.routes.filter((route:any)=>route.orders.length>0);
 expect(trucks).toHaveLength(2);
 const organizedOrderIds=trucks.flatMap((route:any)=>route.orders.map((order:any)=>order.id));
 expect(organizedOrderIds).toHaveLength(6);expect(new Set(organizedOrderIds).size).toBe(6);
 expect(new Set(trucks.map((route:any)=>route.plate)).size).toBe(2);
 expect(new Set(trucks.map((route:any)=>route.driverName)).size).toBe(2);
 const approvedRouteDetails=await Promise.all(trucks.map(async(route:any)=>{
  const response=await page.request.get('/api/routes/'+route.id+'/detail');
  expect(response.ok()).toBeTruthy();
  const detail=await response.json();expect(detail.routes[0].id).toBe(route.id);return detail.routes[0];
 }));
 expect(new Set(approvedRouteDetails.map((route:any)=>route.vehicleId)).size).toBe(2);
 expect(new Set(approvedRouteDetails.map((route:any)=>route.driverId)).size).toBe(2);

 await page.getByRole('button',{name:'Empresa y equipo',exact:true}).click();
 await page.getByRole('button',{name:'Activar modo de prueba',exact:true}).click();
 await expect(page.getByText(/MODO DE PRUEBA ACTIVO/)).toBeVisible();
 await page.getByRole('button',{name:'Rutas',exact:true}).click();
 await expect(page.getByRole('region',{name:'Pedidos organizados por camión'}).getByRole('article')).toHaveCount(2);
 for(let truckIndex=0;truckIndex<trucks.length;truckIndex++){
  const truck=trucks[truckIndex],routeOrderIds=truck.orders.map((order:any)=>order.id);
  const truckCard=page.getByRole('region',{name:'Pedidos organizados por camión'}).getByRole('article',{name:`${truck.name} · ${truck.plate}`,exact:true});
  await expect(truckCard).toContainText(truck.plate);
  await expect(truckCard).toContainText(truck.driverName);
  await truckCard.getByRole('button',{name:'Cargar este camión',exact:true}).click();
  const load=page.getByRole('region',{name:'Carga del vehículo'});
  await expect(load).toContainText(`Cargados 0 de ${routeOrderIds.length} bultos.`);
  await load.getByRole('button',{name:'Seleccionar pendientes',exact:true}).click();
  await load.getByRole('button',{name:'Confirmar carga',exact:true}).click();
  for(const id of routeOrderIds)await expect.poll(async()=> (await(await page.request.get('/api/orders/'+id)).json()).status).toBe('LOADED');
  await page.getByRole('button',{name:'Confirmar ruta',exact:true}).click();
  expect((await bootstrap()).routes.find((route:any)=>route.id===truck.id).state).toBe('READY');

  await page.getByRole('button',{name:'Control de salida',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Odómetro observado',exact:true}).fill(String(truckIndex));
  await page.getByRole('spinbutton',{name:'Combustible (%)',exact:true}).fill('75');
  await page.getByRole('textbox',{name:'Nombre del control',exact:true}).fill('Inspección sintética '+truck.plate);
  await page.getByRole('button',{name:'Guardar checklist y despachar ahora',exact:true}).click();
  await expect(page.getByText('Salida de ruta registrada.',{exact:true})).toBeVisible();
  expect((await bootstrap()).routes.find((route:any)=>route.id===truck.id).state).toBe('IN_PROGRESS');
  await page.getByRole('button',{name:/Paradas \(/}).click();
  for(let orderIndex=0;orderIndex<routeOrderIds.length;orderIndex++){
   const id=routeOrderIds[orderIndex];
   await page.getByRole('button',{name:'Registrar resultado de entrega',exact:true}).first().click();
   await page.getByRole('radio',{name:'Entregado',exact:true}).check();
   await page.getByRole('textbox',{name:'Nombre de quien recibe',exact:true}).fill('Receptor de prueba '+(truckIndex+1)+'-'+(orderIndex+1));
   await page.getByRole('button',{name:'Guardar resultado',exact:true}).click();
   await expect.poll(async()=> (await(await page.request.get('/api/orders/'+id)).json()).status).toBe('DELIVERED');
  }
  await page.getByRole('button',{name:'Cerrar ruta',exact:true}).click();
  await expect.poll(async()=> (await bootstrap()).routes.find((route:any)=>route.id===truck.id).state).toBe('OPERATIONALLY_CLOSED');
  await page.getByRole('button',{name:'Volver a rutas',exact:false}).click();
 }

 const finalBootstrap=await bootstrap();
 for(const id of orderIds)expect((await(await page.request.get('/api/orders/'+id)).json()).status).toBe('DELIVERED');
 for(const truck of trucks)expect(finalBootstrap.routes.find((route:any)=>route.id===truck.id).state).toBe('OPERATIONALLY_CLOSED');
 expect(finalBootstrap.assignments.filter((assignment:any)=>assignment.active&&trucks.some((route:any)=>route.id===assignment.routeId))).toHaveLength(0);
 expect((await(await page.request.get('/api/inventory/reconciliation')).json()).ok).toBe(true);

 await page.getByText('Buscar rutas e historial',{exact:true}).click();
 await page.getByRole('combobox',{name:'Estado de ruta',exact:true}).selectOption('OPERATIONALLY_CLOSED');
 const closedRoutes=page.locator('.route-list');
 await expect(closedRoutes.getByRole('button')).toHaveCount(2);
 for(const truck of trucks)await expect(closedRoutes).toContainText(truck.plate);
 await page.screenshot({path:'.local/routing-lifecycle-two-closed-routes.png',fullPage:true});
});
