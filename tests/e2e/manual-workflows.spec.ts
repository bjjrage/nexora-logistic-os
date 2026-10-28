import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const key='nexora.workflows.v2';
async function saved(page:any,id:string){return page.evaluate(({key,id}:any)=>JSON.parse(localStorage.getItem(key)||'{}')[id],{key,id});}
async function openFlow(page:any,id:string){await page.goto('/manual.html#flujo/'+id);await page.locator('.wf-tools [data-wf-reset]').click();}
async function execute(page:any){
 const form=page.locator('#wf-form');await expect(form).toBeVisible();
 const route=form.locator('select[name="chosenRoute"]');if(await route.count())await route.selectOption({index:1});
 for(const input of await form.locator('input[type="checkbox"]:not(:disabled)').all())await input.check();
 await form.locator('button[type="submit"]').click();
 await expect(page.locator('.wf-error')).toHaveCount(0);
}

test('manual workflows: all nine operations change real simulation state, reconcile stock and never call business APIs',async({page})=>{
 test.setTimeout(180000);const errors:string[]=[],business:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))business.push(r.url());});
 await page.goto('/manual.html');
 await expect(page.getByRole('heading',{name:'Aprendé el OS haciendo una operación.'})).toBeVisible();
 const flows=await page.evaluate(()=>(window as any).NEXORA_WORKFLOWS.scenarios);
 expect(flows).toHaveLength(9);
 for(const flow of flows){
  await openFlow(page,flow.id);
  for(const step of flow.steps){
   await expect(page.locator('.wf-task-title h2')).toBeVisible();
   if(step==='edit')await page.locator('input[name="demand"]').fill('1');
   await execute(page);
   const snapshot=await saved(page,flow.id);
   expect(snapshot.done).toContain(step);
   expect(snapshot.received-snapshot.reserved-snapshot.delivered-snapshot.quarantine).toBeGreaterThanOrEqual(0);
   expect(snapshot.reserved-snapshot.loaded).toBeGreaterThanOrEqual(0);
  }
  await expect(page.locator('.wf-finish')).toBeVisible();
 }
 const delivery=await saved(page,'reparto');expect(delivery.closed).toBe(true);expect(delivery.delivered).toBe(2);expect(delivery.reserved).toBe(0);
 const corrected=await saved(page,'corregir');expect(corrected.demand).toBe(1);expect(corrected.delivered).toBe(1);
 const returned=await saved(page,'retorno');expect(returned.closed).toBe(true);expect(returned.released).toBe(2);expect(returned.quarantine).toBe(0);
 const quad=await saved(page,'quadminds');expect(quad.externalPending).toBe(true);expect(quad.delivered).toBe(0);
 expect(errors).toEqual([]);expect(business).toEqual([]);
});

test('manual: blocked steps, role boundaries, partial load, reload and undo keep the same operation',async({page})=>{
 await openFlow(page,'reparto');
 await page.locator('[data-wf-step="5"]').click();
 await page.getByRole('button',{name:'Despachar',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Confirmá el plan');
 expect(await saved(page,'reparto')).toBeTruthy();
 await page.locator('#wf-actor').selectOption('DEPOT');
 await page.getByRole('button',{name:'Despachar',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('El rol Depósito no puede');
 await page.locator('.wf-error [data-wf-next]').click();
 await page.locator('#wf-actor').selectOption('ADMIN');
 await execute(page); // reserve
 let s=await saved(page,'reparto');expect(s.reserved).toBe(2);expect(s.loaded).toBe(0);
 await execute(page); // assign
 await execute(page); // confirm plan
 await page.getByRole('button',{name:'Confirmar carga',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Seleccioná al menos una unidad');
 await page.locator('input[name="units"][value="1"]').check();
 await page.getByRole('button',{name:'Confirmar carga',exact:true}).click();
 s=await saved(page,'reparto');expect(s.loaded).toBe(1);expect(s.done).not.toContain('load');
 await page.reload();
 await expect(page.locator('input[name="units"][value="1"]')).toBeChecked();
 await expect(page.locator('input[name="units"][value="1"]')).toBeDisabled();
 await page.locator('input[name="units"][value="2"]').check();
 await page.getByRole('button',{name:'Confirmar carga',exact:true}).click();
 await expect(page.locator('.wf-task-title h2')).toHaveText('Hacer el control de salida');
 await page.getByRole('button',{name:'Deshacer práctica',exact:true}).click();
 s=await saved(page,'reparto');expect(s.loaded).toBe(1);expect(s.reserved).toBe(2);
 await expect(page.locator('.wf-task-title h2')).toHaveText('Cargar el vehículo');
 await page.setViewportSize({width:1365,height:900});
 await page.screenshot({path:'.local/workflow-carga-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.local/workflow-carga-mobile.png',fullPage:true});
 await openFlow(page,'corregir');
 await page.locator('[data-wf-step="1"]').click();
 await page.getByRole('button',{name:'Desreservar pedido',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Primero bajá');
 await page.locator('.wf-error [data-wf-next]').click();await execute(page);
 s=await saved(page,'corregir');expect(s.loaded).toBe(0);expect(s.reserved).toBe(2);
 await execute(page);s=await saved(page,'corregir');expect(s.reserved).toBe(0);expect(s.assigned).toBe(false);
});

test('manual: catalogue adds no stock, shortage is recoverable, glossary is accessible and portable HTML works offline',async({page,context})=>{
 await openFlow(page,'primer-dia');
 for(let i=0;i<6;i++)await execute(page);
 let s=await saved(page,'primer-dia');expect(s.catalogReady).toBe(true);expect(s.received).toBe(0);
 await page.locator('input[name="receiptQty"]').fill('1');await execute(page);
 await execute(page); // order for two
 await page.getByRole('button',{name:'Reservar stock',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Falta stock');
 await page.locator('[data-wf-step="6"]').click();await page.locator('input[name="receiptQty"]').fill('2');await execute(page);
 await page.getByRole('button',{name:'Reservar stock',exact:true}).click();
 s=await saved(page,'primer-dia');expect(s.received).toBe(3);expect(s.reserved).toBe(2);
 await page.getByRole('button',{name:'Qué hace cada módulo',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Un pedido de inventario ya genera su envío');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
 await page.goto('/manual.html');await page.screenshot({path:'.local/workflow-home-desktop.png',fullPage:true});
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'Descargar HTML sin conexión'}).click();
 expect((await download).suggestedFilename()).toBe('MANUAL_WORKFLOWS_NEXORA_PORTATIL.html');
 await context.setOffline(true);
 await page.goto(pathToFileURL(resolve('MANUAL_WORKFLOWS_NEXORA_PORTATIL.html')).toString());
 await expect(page.getByRole('heading',{name:'Aprendé el OS haciendo una operación.'})).toBeVisible();
 await page.getByRole('button',{name:'Practicar pedido → entrega',exact:true}).click();
 await page.locator('.wf-tools [data-wf-reset]').click();
 await page.getByRole('button',{name:'Reservar stock',exact:true}).click();
 s=await saved(page,'reparto');expect(s.reserved).toBe(2);expect(s.loaded).toBe(0);
 await context.setOffline(false);
});
