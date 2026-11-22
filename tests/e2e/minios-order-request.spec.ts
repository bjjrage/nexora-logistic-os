import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {expect,test} from '@playwright/test';
import {Store} from '../../server/db.ts';
import {createApp} from '../../server/app.ts';

test('Mini OS: cliente solicita pedido por SKU y Operaciones lo registra sin reservar',async({page,browser})=>{
  const db=new Store(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const customerContext=await browser.newContext();
  const customer=await customerContext.newPage();
  try{
    const headers={'X-Requested-With':'logistics-os'};
    const setup=await page.request.post(origin+'/api/setup',{headers,data:{
      organizationName:'Mini OS navegador',timezone:'America/Asuncion',username:'minios-admin',password:'MiniOS-Admin-2026!',
    }});
    expect(setup.status()).toBe(201);
    const send=async(path:string,data:Record<string,unknown>)=>{
      const response=await page.request.post(origin+path,{headers,data:{commandId:randomUUID(),...data}});
      expect(response.status(),path+': '+await response.text()).toBeGreaterThanOrEqual(200);
      expect(response.status(),path+': '+await response.text()).toBeLessThan(300);
      return response.json();
    };
    const clientId=(await send('/api/clients',{name:'Comercio del interior'})).id;
    const productId=(await send('/api/inventory/products',{clientId,sku:'MINIOS-001',name:'Producto ejemplo',tracking:'QUANTITY'})).id;
    await send('/api/customer-access',{clientId,name:'Comerciante',username:'cliente-minios',password:'Cliente-MiniOS-2026!'});

    await customer.goto(origin+'/portal/');
    await customer.getByLabel('Usuario',{exact:true}).fill('cliente-minios');
    await customer.getByLabel('Contraseña',{exact:true}).fill('Cliente-MiniOS-2026!');
    await customer.getByRole('button',{name:'Ingresar',exact:true}).click();
    const customerNavigation=customer.getByRole('navigation',{name:'Navegación del cliente'});
    await customerNavigation.getByRole('button',{name:'Pedidos',exact:true}).click();
    const requests=customer.getByRole('region',{name:'Solicitudes de pedidos del comerciante'});
    await expect(requests.getByRole('heading',{name:'Solicitar nuevo pedido'})).toBeVisible();
    await requests.getByLabel('Número de pedido').fill('PED-CLIENTE-100');
    await requests.getByLabel('Fecha').fill('2026-11-22');
    await requests.getByLabel('Destinatario',{exact:true}).fill('Persona compradora');
    await requests.getByLabel('Dirección de entrega').fill('Barrio San Pablo, Asunción');
    await requests.getByLabel('Producto 1').selectOption(productId);
    await requests.getByLabel('Cantidad').fill('2');
    await requests.getByRole('button',{name:'Enviar solicitud'}).click();
    await expect(requests.getByText('Pendiente de revisión')).toBeVisible();
    expect((await db.one('SELECT COUNT(*) AS total FROM inventory_orders'))?.total).toBe(0);

    await page.goto(origin);
    await page.getByRole('navigation',{name:'Navegación principal'}).getByRole('button',{name:'Solicitudes clientes'}).click();
    await expect(page.getByRole('heading',{name:'Solicitudes de comerciantes'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Comercio del interior · PED-CLIENTE-100'})).toBeVisible();
    await page.getByRole('button',{name:'Registrar pedido'}).click();
    await expect(page.getByText('No hay solicitudes en este estado.')).toBeVisible();
    const persisted=await db.one('SELECT id,status FROM inventory_orders WHERE external_id=?','PED-CLIENTE-100');
    expect(persisted?.status).toBe('DRAFT');
    expect((await db.one('SELECT COUNT(*) AS total FROM inventory_order_parcels'))?.total).toBe(0);

    await requests.getByRole('button',{name:'Actualizar'}).click();
    await expect(requests.getByText('Registrado en NEXORA')).toBeVisible();
    await customer.setViewportSize({width:390,height:844});
    await expect(requests.getByRole('button',{name:'Enviar solicitud'})).toBeVisible();
  }finally{
    await customerContext.close();
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await db.close();
  }
});
