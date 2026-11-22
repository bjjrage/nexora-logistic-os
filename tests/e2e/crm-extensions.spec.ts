import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {expect,test} from '@playwright/test';
import {createApp} from '../../server/app.ts';
import {Store} from '../../server/db.ts';

test('CRM-02 + CRM-03: bandeja y storyboard en UI sin envíos ni renders',async({page})=>{
  const db=new Store(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await once(server,'listening');
  const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  try{
    const setup=await page.request.post(origin+'/api/setup',{headers:{'X-Requested-With':'logistics-os'},data:{
      organizationName:'NEXORA QA',timezone:'America/Asuncion',username:'crm-ext-qa',password:'CRM-Extension-QA-2026!',
    }});
    expect(setup.status()).toBe(201);
    const lead=await page.request.post(origin+'/api/crm/prospects',{headers:{'X-Requested-With':'logistics-os'},data:{
      commandId:crypto.randomUUID(),name:'Tienda de prueba',city:'Luque',department:'Central',
    }});
    expect(lead.status()).toBe(201);
    const leadId=(await lead.json()).id as string;
    const contact=await page.request.post(origin+'/api/crm/prospects/'+leadId+'/contacts',{headers:{'X-Requested-With':'logistics-os'},data:{
      commandId:crypto.randomUUID(),name:'Vendedor QA',email:'test@example.test',preferredChannel:'EMAIL',
    }});
    expect(contact.status()).toBe(201);
    const contactId=(await contact.json()).id as string;

    await page.goto(origin);
    await page.getByRole('navigation',{name:'Navegación principal'}).getByRole('button',{name:'CRM comercial'}).click();
    await page.getByRole('navigation',{name:'Secciones del CRM'}).getByRole('button',{name:'Bandeja'}).click();
    await expect(page.getByRole('heading',{name:'Bandeja comercial'})).toBeVisible();
    await page.getByLabel('Empresa prospecto').selectOption(leadId);
    await page.getByLabel('Contacto',{exact:true}).selectOption(contactId);
    await page.getByRole('button',{name:'Abrir conversación'}).click();
    await expect(page.getByRole('heading',{name:'Mensajes de trabajo'})).toBeVisible();
    await page.getByLabel('Borrador del mensaje').fill('Hola, ¿te interesaría conocer nuestros servicios?');
    await page.getByRole('button',{name:'Guardar borrador'}).click();
    await expect(page.getByText('Hola, ¿te interesaría conocer nuestros servicios?')).toBeVisible();
    await page.getByRole('button',{name:'Solicitar aprobación'}).click();
    await page.getByRole('button',{name:'Aprobar (no enviar)'}).click();
    await expect(page.getByText('Aprobado · no enviado')).toBeVisible();

    await page.getByRole('navigation',{name:'Secciones del CRM'}).getByRole('button',{name:'Studio creativo'}).click();
    await expect(page.getByRole('heading',{name:'Studio creativo NEXORA'})).toBeVisible();
    await page.getByRole('button',{name:'Nuevo brief'}).click();
    await page.getByLabel('Qué queremos comunicar').fill('Mostrar cómo un comercio puede almacenar mercadería y organizar pedidos a través de Nexora.');
    await page.getByRole('button',{name:'Guardar brief'}).click();
    await page.getByRole('button',{name:'Crear propuesta editorial'}).click();
    await expect(page.getByRole('button',{name:'Antes y después'})).toBeVisible();
    await expect(page.getByText('Storyboard editorial sin IA.')).toBeVisible();
    await page.getByRole('button',{name:'Aprobar storyboard (sin render)'}).click();
    await expect(page.getByText('APPROVED',{exact:true})).toBeVisible();
  }finally{
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await db.close();
  }
});
