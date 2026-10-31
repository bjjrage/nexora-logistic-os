import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {Store} from '../../server/db.ts';
import {createApp} from '../../server/app.ts';

test('client registration saves its delivery circuit; Routes fixes a missing circuit without opening a map',async({page})=>{
 const store=new Store(':memory:'),server=createApp(store).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 try{
  const send=async(path:string,data:Record<string,unknown>)=>{const r=await page.request.post(origin+path,{headers:{'X-Requested-With':'logistics-os'},data:{commandId:randomUUID(),...data}});expect(r.ok(),await r.text()).toBeTruthy();return r.json();};
  await send('/api/setup',{organizationName:'Circuit QA',timezone:'UTC',username:'circuit-qa',password:'Circuit-QA-2026!'});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('button',{name:'Clientes',exact:true}).click();await page.getByRole('button',{name:'Registrar cliente',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Nombre comercial *',{exact:true}).fill('Cliente propio');await expect(dialog.getByLabel('Sistema de reparto',{exact:true})).toHaveValue('NEXORA');await dialog.getByRole('button',{name:'Registrar cliente',exact:true}).click();await expect(dialog).toHaveCount(0);
  const client=(await store.one("SELECT id,org_id FROM clients WHERE name='Cliente propio'"))!;expect((await store.one('SELECT delivery_provider FROM client_delivery_policies WHERE client_id=?',client.id))!.delivery_provider).toBe('NEXORA');
  await page.getByRole('button',{name:'← Clientes',exact:true}).click();await page.getByRole('button',{name:'Registrar cliente',exact:true}).click();await dialog.getByLabel('Nombre comercial *',{exact:true}).fill('Cliente externo');await dialog.getByLabel('Sistema de reparto',{exact:true}).selectOption('QUADMINDS');await dialog.getByRole('button',{name:'Registrar cliente',exact:true}).click();await expect(dialog).toHaveCount(0);
  const external=(await store.one("SELECT id FROM clients WHERE name='Cliente externo'"))!;expect((await store.one('SELECT delivery_provider FROM client_delivery_policies WHERE client_id=?',external.id))!.delivery_provider).toBe('QUADMINDS');
  const location=(await send('/api/inventory/locations',{code:'BASE',name:'Base'})).id,product=(await send('/api/inventory/products',{clientId:client.id,sku:'SKU',name:'Producto',tracking:'QUANTITY',weightGrams:100,volumeCm3:100})).id;
  await send('/api/inventory/receipts',{clientId:client.id,productId:product,locationId:location,quantity:1});const order=(await send('/api/orders',{clientId:client.id,externalId:'RESERVA-QA',orderDate:'2026-10-29',destination:'Destino QA',recipientName:'Receptor QA',lines:[{productId:product,quantity:1}]})).id;await send('/api/orders/'+order+'/reserve',{});
  // Emulate a pre-fix client already holding reserved merchandise.
  await store.run('DELETE FROM client_delivery_policies WHERE client_id=?',client.id);
  await page.getByRole('button',{name:'Rutas',exact:true}).click();const row=page.getByRole('article',{name:'RESERVA-QA',exact:true});await expect(row.getByText('Falta definir el sistema de reparto del cliente')).toBeVisible();await expect(row.getByRole('button',{name:'Revisar dirección'})).toHaveCount(0);
  await row.getByRole('button',{name:'Usar reparto Nexora para Cliente propio',exact:true}).click();await expect(page.getByText('Reparto Nexora habilitado para Cliente propio. Ya podés organizar sus reservas.')).toBeVisible();await expect(row.getByRole('button',{name:'Usar reparto Nexora para Cliente propio'})).toHaveCount(0);await expect(row.getByRole('button',{name:'Revisar dirección'})).toBeVisible();
  expect((await store.one('SELECT status FROM inventory_orders WHERE id=?',order))!.status).toBe('RESERVED');expect((await store.one('SELECT delivery_provider FROM client_delivery_policies WHERE client_id=?',external.id))!.delivery_provider).toBe('QUADMINDS');
  await page.screenshot({path:'.local/client-circuit-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.local/client-circuit-mobile.png',fullPage:true});expect(errors).toEqual([]);
 }finally{await page.goto('about:blank');const closed=new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));server.closeAllConnections();await closed;await store.close();}
});
