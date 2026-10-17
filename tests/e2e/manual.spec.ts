import {test,expect} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';

test('interactive manual: every function completes, saves only progress, and never calls business APIs',async({page})=>{
  test.setTimeout(120000);
  const errors:string[]=[],calls:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))calls.push(r.url());});
  await page.goto('/manual.html');
  await expect(page.getByRole('heading',{name:'¿Qué necesitás hacer hoy?'})).toBeVisible();
  const lessons=await page.evaluate(()=> (window as any).NEXORA_MANUAL.guides.map((g:any)=>({id:g.id,steps:g.steps.length})));
  expect(lessons.length).toBeGreaterThanOrEqual(45);
  for(const guide of lessons){
    await page.goto('/manual.html#guia/'+guide.id+'/1');
    for(let i=0;i<guide.steps;i++){
      await expect(page.locator('#practice-action')).toBeVisible();
      const example=page.getByRole('button',{name:'Usar datos de ejemplo'});
      if(await example.count())await example.click();
      await page.locator('#practice-action').click();
      await expect(page.locator('#step-result')).toBeVisible();
      await expect(page.locator('#next')).toBeEnabled();
      await page.locator('#next').click();
    }
    await expect(page.locator('.celebrate')).toBeVisible();
  }
  await page.reload();
  await page.getByRole('button',{name:'Elegir otra función',exact:true}).click();
  await expect(page.locator('#overall-count')).toHaveText(`${lessons.length} / ${lessons.length}`);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nexora.academia.v1')!));
  expect(Object.keys(saved).sort()).toEqual(['last','progress']);
  expect(errors).toEqual([]);expect(calls).toEqual([]);
});

test('manual: input validation, search, journey continuity, mobile layout and standalone HTML',async({page})=>{
  await page.goto('/manual.html');
  await page.getByRole('searchbox',{name:'Buscar una función'}).fill('catalogo');
  await expect(page.locator('#cards')).toContainText('Importar el catálogo');
  await page.locator('#role').selectOption('Cliente');
  await expect(page.locator('#cards')).not.toContainText('Importar el catálogo');
  await page.getByRole('searchbox',{name:'Buscar una función'}).fill('zzzz-no-existe');
  await expect(page.getByRole('heading',{name:'No encontramos esa tarea'})).toBeVisible();
  await page.getByRole('button',{name:'Quitar filtros'}).click();
  await page.getByRole('button',{name:'Empezar recorrido'}).click();
  await page.locator('#practice-action').click();await page.locator('#next').click();
  await page.locator('#practice-action').click();
  await expect(page.locator('#next')).toBeDisabled();
  await page.getByRole('button',{name:'Usar datos de ejemplo'}).click();
  await page.locator('#practice-action').click();await page.locator('#next').click();
  await page.getByRole('button',{name:'Usar datos de ejemplo'}).click();
  await page.locator('#practice-action').click();await page.locator('#next').click();
  await page.getByRole('button',{name:'Seguir: Elegir el circuito del cliente'}).click();
  await expect(page.locator('.route-strip')).toContainText('Etapa 2 de 21');
  await page.goto('/manual.html#guia/recibir-cantidad/2');
  await page.getByLabel('Escanear SKU o código de barras').fill('NO-EXISTE');
  await page.locator('#practice-action').click();
  await expect(page.locator('#form-error')).toContainText('DEMO-001');
  await page.getByRole('button',{name:'Usar datos de ejemplo'}).click();
  await page.locator('#practice-action').click();
  await expect(page.locator('#step-result')).toBeVisible();
  await page.reload();await expect(page.locator('#next')).toBeEnabled();
  await page.goto('/manual.html#guia/catalogo/2');
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Descargar CSV ficticio'}).click();
  const download=await downloadEvent;
  expect(download.suggestedFilename()).toBe('catalogo-demo-hogar.csv');
  expect(readFileSync((await download.path())!,'utf8')).toContain('DEMO-003,Equipo demo');
  await page.setViewportSize({width:1365,height:900});
  await page.goto('/manual.html#guia/cliente-alta/2');
  await page.screenshot({path:'.local/manual-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.practice')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'↺ Repetir'}).click();
  await page.locator('#practice-action').click();await page.locator('#next').click();
  await page.getByLabel('Nombre comercial *',{exact:true}).fill('Demo Hogar');
  await page.locator('#practice-action').click();
  await expect(page.locator('#next')).toBeEnabled();
  await page.screenshot({path:'.local/manual-mobile.png',fullPage:true});
  await page.goto(pathToFileURL(resolve('MANUAL_MAESTRO_NEXORA_OS.html')).toString());
  await expect(page.getByRole('heading',{name:'¿Qué necesitás hacer hoy?'})).toBeVisible();
  await page.getByRole('button',{name:'Empezar recorrido'}).click();
  await expect(page.locator('#practice-action')).toBeVisible();
});
