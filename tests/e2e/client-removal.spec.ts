import {randomUUID} from 'node:crypto';
import {test,expect} from '../support/e2e-test.ts';

test('Administración retira un SKU y elimina el cliente desde su ficha',async({page})=>{
 const post=async(path:string,data:Record<string,unknown>)=>{
  const response=await page.request.post(path,{headers:{'X-Requested-With':'logistics-os'},data:{commandId:randomUUID(),...data}});
  expect(response.ok(),path+': '+await response.text()).toBe(true);
  return response.json();
 };
 await post('/api/setup',{organizationName:'QA eliminación',timezone:'America/Asuncion',username:'qa-browser',password:'QA-Browser-Isolated-2026!'});
 const {id:clientId}=await post('/api/clients',{name:'Bristol QA'});
 const {id:locationId}=await post('/api/inventory/locations',{code:'DEP-QA',name:'Depósito QA',kind:'DEPOT'});
 for(const sku of ['RETIRAR-QA','CONSERVAR-HASTA-BORRADO']){
  const {id:productId}=await post('/api/inventory/products',{clientId,sku,name:sku,tracking:'QUANTITY'});
  await post('/api/inventory/receipts',{clientId,productId,locationId,quantity:4});
 }
 await page.goto('/');
 const nav=page.getByRole('navigation',{name:'Navegación principal'});
 await nav.getByRole('button',{name:'Inventario',exact:true}).click();
 const row=page.getByRole('row').filter({hasText:'RETIRAR-QA'});
 await expect(row).toBeVisible();
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain('RETIRAR-QA');await dialog.accept();});
 await row.getByRole('button',{name:'Eliminar SKU'}).click();
 await expect(row).toHaveCount(0);
 await expect(page.getByRole('row').filter({hasText:'CONSERVAR-HASTA-BORRADO'})).toBeVisible();

 await nav.getByRole('button',{name:'Clientes',exact:true}).click();
 await page.getByRole('row').filter({hasText:'Bristol QA'}).getByRole('button',{name:'Abrir ficha'}).click();
 page.once('dialog',async dialog=>{
  expect(dialog.message()).toContain('Bristol QA');
  expect(dialog.message()).toContain('4 unidades de stock');
  await dialog.accept();
 });
 await page.getByRole('button',{name:'Eliminar cliente',exact:true}).click();
 await expect(page.getByText('Cliente y registros eliminados.')).toBeVisible();
 await expect(page.getByRole('row').filter({hasText:'Bristol QA'})).toHaveCount(0);
 await nav.getByRole('button',{name:'Inventario',exact:true}).click();
 await expect(page.getByRole('row').filter({hasText:'CONSERVAR-HASTA-BORRADO'})).toHaveCount(0);
});
