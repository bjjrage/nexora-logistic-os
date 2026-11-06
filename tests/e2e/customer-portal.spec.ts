import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {Store} from '../../server/db.ts';
import {createApp} from '../../server/app.ts';

async function downloadCsv(page:Page,label:string) {
  const waiting=page.waitForEvent('download');
  await page.getByRole('link',{name:label,exact:true}).click();
  const download=await waiting,stream=await download.createReadStream();
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('Clientes → Depósito habilita, suspende y reactiva un portal de consulta y exportación aislado',async({page,browser})=>{
  const store=new Store(':memory:'),server=createApp(store).listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const customerContext=await browser.newContext(),customer=await customerContext.newPage();
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));customer.on('pageerror',error=>errors.push(error.message));
  try {
    const send=async(path:string,data:Record<string,unknown>)=>{
      const response=await page.request.post(origin+path,{headers:{'X-Requested-With':'logistics-os'},data:{commandId:randomUUID(),...data}});
      expect(response.ok(),path+': '+await response.text()).toBeTruthy();return response.json();
    };
    await send('/api/setup',{organizationName:'Nexora portal QA',timezone:'America/Asuncion',username:'qa-admin',password:'Portal-QA-Admin-2026!'});
    const a=(await send('/api/clients',{name:'Mayorista A'})).id,b=(await send('/api/clients',{name:'Mayorista B'})).id;
    const location=(await send('/api/inventory/locations',{code:'CENTRAL-QA',name:'Depósito QA'})).id;
    for(const [clientId,letter] of [[a,'A'],[b,'B']]){
      const product=(await send('/api/inventory/products',{clientId,sku:'SKU-'+letter,name:'Mercadería '+letter,tracking:'QUANTITY'})).id;
      await send('/api/inventory/receipts',{clientId,productId:product,locationId:location,quantity:5,reference:'INGRESO-'+letter});
      await send('/api/orders',{clientId,externalId:'PEDIDO-'+letter,orderDate:'2026-11-05',destination:'Destino '+letter,recipientName:'Receptor '+letter,lines:[{productId:product,quantity:1}]});
    }
    await send('/api/customer-access',{clientId:b,name:'Persona B',username:'persona-b',password:'Portal-QA-B-2026!'});
    await page.goto(origin);
    await page.getByRole('button',{name:'Clientes',exact:true}).click();
    await page.getByRole('row').filter({hasText:'Mayorista A'}).getByRole('button',{name:'Abrir ficha',exact:true}).click();
    await page.getByRole('button',{name:'Depósito',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Acceso al portal',exact:true})).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.getByRole('button',{name:'Ayuda: Acceso al portal',exact:true}).hover();
    await expect(page.getByRole('tooltip')).toContainText('Cada usuario consulta y exporta únicamente');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.getByRole('button',{name:'Ayuda: Usuario de ingreso',exact:true}).hover();
    await expect(page.getByRole('tooltip')).toContainText('Entre 3 y 80 caracteres');
    await page.mouse.move(0,0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.getByRole('button',{name:'Ayuda: Contraseña',exact:true}).focus();
    await expect(page.getByRole('tooltip')).toContainText('Entre 6 y 128 caracteres');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.getByLabel('Nombre de la persona',{exact:true}).fill('Persona A');
    await page.getByLabel('Usuario de ingreso',{exact:true}).fill('persona-a');
    await page.getByLabel('Contraseña',{exact:true}).fill('Portal-QA-A-2026!');
    await page.getByRole('button',{name:'Habilitar usuario',exact:true}).click();
    const account=page.getByRole('article',{name:'Acceso de Persona A',exact:true});
    await expect(account.getByText('Activo',{exact:true})).toBeVisible();
    await expect(page.getByText('Persona B',{exact:true})).toHaveCount(0);
    await page.screenshot({path:'.local/customer-depot-access-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Ayuda: Contraseña',exact:true}).click();
    await expect(page.getByRole('tooltip')).toBeVisible();
    const helpBounds=await page.getByRole('tooltip').boundingBox();
    expect(helpBounds!.x).toBeGreaterThanOrEqual(0);expect(helpBounds!.x+helpBounds!.width).toBeLessThanOrEqual(390);
    await page.getByLabel('Nombre de la persona',{exact:true}).click();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'.local/customer-depot-access-mobile.png',fullPage:true});

    await customer.goto(origin);
    await customer.getByLabel('Usuario',{exact:true}).fill('persona-a');
    await customer.getByLabel('Contraseña',{exact:true}).fill('Portal-QA-A-2026!');
    await customer.getByRole('button',{name:'Ingresar',exact:true}).click();
    await expect(customer.getByRole('heading',{name:'Mi depósito',exact:true})).toBeVisible();
    await expect(customer.getByRole('navigation',{name:'Navegación del cliente',exact:true})).toBeVisible();
    const metrics=customer.getByRole('region',{name:'Resumen de cuenta',exact:true}).getByRole('button');
    await expect(metrics).toHaveCount(5);
    for(const metric of await metrics.all()){await expect(metric).toHaveCSS('border-top-style','solid');await expect(metric).toHaveCSS('background-color','rgb(255, 255, 255)');}
    await customer.screenshot({path:'.local/customer-home-desktop.png',fullPage:true});
    await customer.setViewportSize({width:390,height:844});
    expect(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await customer.screenshot({path:'.local/customer-home-mobile.png',fullPage:true});
    await customer.setViewportSize({width:1280,height:720});
    const filtered=customer.waitForResponse(response=>new URL(response.url()).pathname==='/api/inventory/stock'&&new URL(response.url()).searchParams.get('status')==='AVAILABLE');
    await customer.getByRole('button',{name:'Ver stock disponible',exact:true}).click();
    expect((await filtered).status()).toBe(200);
    await expect(customer.getByRole('cell',{name:'Disponible',exact:true})).toBeVisible();
    await expect(customer.getByRole('cell').filter({hasText:'Mercadería A'})).toBeVisible();
    await expect(customer.getByText('Mercadería B',{exact:true})).toHaveCount(0);
    const inventory=await downloadCsv(customer,'Exportar inventario');
    expect(inventory).toContain('SKU-A');expect(inventory).not.toContain('SKU-B');
    await customer.getByRole('button',{name:'Pedidos',exact:true}).click();
    await expect(customer.getByRole('heading',{name:'PEDIDO-A',exact:true})).toBeVisible();
    await expect(customer.getByText('PEDIDO-B',{exact:true})).toHaveCount(0);
    const orders=await downloadCsv(customer,'Exportar pedidos');
    expect(orders).toContain('PEDIDO-A');expect(orders).not.toContain('PEDIDO-B');
    await customer.getByRole('button',{name:'Movimientos',exact:true}).click();
    await expect(customer.getByRole('cell',{name:'INGRESO-A',exact:true})).toBeVisible();
    const movements=await downloadCsv(customer,'Exportar movimientos');
    expect(movements).toContain('INGRESO-A');expect(movements).not.toContain('INGRESO-B');
    const forced=await customer.request.get(origin+'/api/orders/export.csv?clientId='+b);
    expect(forced.status()).toBe(200);expect(await forced.text()).not.toContain('PEDIDO-B');
    await customer.getByLabel('Buscar en tus movimientos',{exact:true}).fill('sin-resultados');
    await expect(customer.getByText('No hay movimientos para esta búsqueda.',{exact:true})).toBeVisible();
    await customer.getByLabel('Buscar en tus movimientos',{exact:true}).fill('INGRESO-A');
    await expect(customer.getByRole('cell',{name:'INGRESO-A',exact:true})).toBeVisible();
    await customer.screenshot({path:'.local/customer-portal-desktop.png',fullPage:true});
    await customer.setViewportSize({width:390,height:844});
    expect(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await customer.screenshot({path:'.local/customer-portal-mobile.png',fullPage:true});

    await account.getByRole('button',{name:'Suspender acceso de Persona A',exact:true}).click();
    await expect(account.getByText('Suspendido',{exact:true})).toBeVisible();
    expect((await customer.request.get(origin+'/api/orders/export.csv')).status()).toBe(401);
    await customer.getByRole('button',{name:'Actualizar',exact:true}).click();
    await expect(customer.getByRole('button',{name:'Ingresar',exact:true})).toBeVisible();
    await account.getByRole('button',{name:'Reactivar acceso de Persona A',exact:true}).click();
    await expect(account.getByText('Activo',{exact:true})).toBeVisible();
    await customer.getByLabel('Usuario',{exact:true}).fill('persona-a');
    await customer.getByLabel('Contraseña',{exact:true}).fill('Portal-QA-A-2026!');
    await customer.getByRole('button',{name:'Ingresar',exact:true}).click();
    await expect(customer.getByRole('heading',{name:'Mi depósito',exact:true})).toBeVisible();
    expect(errors).toEqual([]);
  } catch(error) {
    await page.screenshot({path:'.local/customer-depot-failure.png',fullPage:true}).catch(()=>{});
    await customer.screenshot({path:'.local/customer-portal-failure.png',fullPage:true}).catch(()=>{});
    throw error;
  } finally {
    await customerContext.close();await page.goto('about:blank');
    const closed=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    server.closeAllConnections();await closed;await store.close();
  }
});
