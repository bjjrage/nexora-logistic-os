import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {expect,test} from '@playwright/test';
import {Store} from '../../server/db.ts';
import {createApp} from '../../server/app.ts';

test('Simulador autenticado del bot: stock, solicitud compartida y canales desconectados',async({page,browser})=>{
  const db=new Store(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const customer=await context.newPage();
  const post=async(path:string,data:Record<string,unknown>)=>{
    const response=await page.request.post(origin+path,{headers:{'X-Requested-With':'logistics-os'},
      data:{commandId:randomUUID(),...data}});
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  try {
    const setup=await page.request.post(origin+'/api/setup',{headers:{'X-Requested-With':'logistics-os'},
      data:{organizationName:'Bot QA',timezone:'America/Asuncion',username:'bot-admin',password:'Bot-QA-Admin-2026!'}});
    expect(setup.status()).toBe(201);
    const client=(await post('/api/clients',{name:'Comercio Bot'})).id;
    const product=(await post('/api/inventory/products',{clientId:client,sku:'BOT-MOBILE',name:'Producto simulador',tracking:'QUANTITY'})).id;
    const location=(await post('/api/inventory/locations',{code:'BOT-DEP',name:'Depósito Bot',kind:'DEPOT'})).id;
    await post('/api/inventory/receipts',{clientId:client,productId:product,locationId:location,quantity:2,reference:'Ingreso QA'});
    await post('/api/customer-access',{clientId:client,name:'Comerciante Bot',username:'bot-customer',password:'Bot-QA-Cliente-2026!'});
    await customer.goto(origin+'/portal/');
    await customer.getByLabel('Usuario',{exact:true}).fill('bot-customer');
    await customer.getByLabel('Contraseña',{exact:true}).fill('Bot-QA-Cliente-2026!');
    await customer.getByRole('button',{name:'Ingresar',exact:true}).click();
    const nav=customer.getByRole('navigation',{name:'Navegación del cliente'});
    await nav.getByRole('button',{name:'Pedidos',exact:true}).click();
    await customer.getByRole('checkbox',{name:'Simular conversación del bot'}).check();
    await expect(customer.getByText(/NOT_CONNECTED/)).toBeVisible();
    await customer.getByLabel('Número de pedido').fill('BOT-SIM-100');
    await customer.getByLabel('Destinatario',{exact:true}).fill('Comprador');
    await customer.getByLabel('Dirección de entrega').fill('Destino QA');
    await customer.getByLabel('Producto 1').selectOption(product);
    await customer.getByLabel('Cantidad').fill('3');
    await customer.getByRole('button',{name:'Consultar disponibilidad'}).click();
    const confirm=customer.getByRole('button',{name:'Confirmar solicitud del simulador'});
    await expect(confirm).toBeDisabled();
    await expect(customer.getByText('BOT-MOBILE · pedido 3 · disponible 2')).toBeVisible();
    await customer.getByRole('button',{name:'Revisar datos y stock'}).click();
    await customer.getByLabel('Cantidad').fill('2');
    await customer.getByRole('button',{name:'Consultar disponibilidad'}).click();
    await confirm.click();
    await expect(customer.getByText('Solicitud registrada para revisión de Operaciones.')).toBeVisible();
    expect((await db.one('SELECT COUNT(*) AS total FROM inventory_orders'))?.total).toBe(0);
    await customer.reload();
    await nav.getByRole('button',{name:'Pedidos',exact:true}).click();
    await expect(customer.getByRole('row').filter({hasText:'BOT-SIM-100'})).toContainText('Pendiente de revisión');
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await db.close();
  }
});
