import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { createApp } from '../../server/app.ts';
import { Store } from '../../server/db.ts';

test('CRM interno: prospectos, contactos, funnel, seguimiento e importación', async ({page}) => {
  const db = new Store(':memory:');
  const server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    const setup = await page.request.post(origin + '/api/setup', {
      headers: {'X-Requested-With': 'logistics-os'},
      data: {organizationName: 'CRM fixture', timezone: 'America/Asuncion', username: 'crm-qa', password: 'Crm-QA-Local-2026!'},
    });
    expect(setup.status()).toBe(201);
    const migration = await db.one('SELECT applied_at FROM schema_migrations WHERE version=24');
    await db.run('DELETE FROM schema_migrations WHERE version=24');
    await page.goto(origin);
    const navigation = page.getByRole('navigation', {name: 'Navegación principal'});
    await expect(navigation.getByRole('button', {name: 'Inicio', exact: true})).toBeVisible();
    const crmLink = navigation.getByRole('button', {name: 'CRM comercial'});
    await expect(crmLink).toHaveCount(0);
    const disabled = await page.request.get(origin + '/api/crm/prospects');
    expect(disabled.status()).toBe(503);
    expect((await disabled.json()).error.code).toBe('CRM_NOT_READY');
    const bootstrap = await page.request.get(origin + '/api/bootstrap');
    expect(bootstrap.ok()).toBeTruthy();
    expect((await bootstrap.json()).crmAvailable).toBe(false);
    await db.run('INSERT INTO schema_migrations VALUES(24,?)', migration?.applied_at);
    await page.reload();
    await crmLink.click();
    await expect(page.getByRole('heading', {name: 'CRM comercial'})).toBeVisible();
    await page.getByRole('button', {name: 'Nuevo prospecto'}).click();
    const form = page.locator('section').filter({has: page.getByRole('heading', {name: 'Nuevo prospecto'})});
    await form.getByLabel('Nombre comercial').fill('Taller Ñandutí');
    await form.getByLabel('Rubro', {exact: true}).fill('Textil');
    await form.getByLabel('Ciudad', {exact: true}).fill('Luque');
    await form.getByLabel('Campaña', {exact: true}).fill('Invierno');
    await form.getByRole('button', {name: 'Guardar empresa'}).click();
    await expect(page.getByRole('heading', {name: 'Taller Ñandutí'})).toBeVisible();

    await page.getByRole('button', {name: 'Nuevo contacto'}).click();
    await page.getByLabel('Nombre del contacto').fill('Ana Taller');
    await page.getByLabel('Correo del contacto').fill('ana@example.test');
    await page.getByLabel('Canal preferido').selectOption('EMAIL');
    await page.getByRole('button', {name: 'Guardar contacto'}).click();
    await expect(page.getByRole('cell', {name: 'Ana Taller', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Editar contacto: Ana Taller'}).click();
    await page.getByRole('checkbox', {name: 'No contactar'}).check();
    await page.getByRole('button', {name: 'Guardar contacto'}).click();
    await expect(page.getByRole('cell', {name: 'No contactar'})).toBeVisible();

    await page.getByLabel('Próxima etapa').selectOption('VALIDATED');
    await page.getByLabel('Motivo del cambio').fill('Datos revisados');
    await page.getByRole('button', {name: 'Cambiar etapa'}).click();
    await expect(page.getByText('Identificado → Validado')).toBeVisible();

    await page.getByLabel('Tarea', {exact: true}).fill('Revisar capacidad');
    await page.getByLabel('Vencimiento', {exact: true}).fill('2026-01-01T09:00');
    await page.getByRole('button', {name: 'Crear tarea'}).click();
    await expect(page.getByText('Vencida', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Completar tarea: Revisar capacidad'}).click();
    await page.getByLabel('Estado de tareas').selectOption('DONE');
    await expect(page.getByRole('cell', {name: 'Revisar capacidad'})).toBeVisible();

    await page.getByRole('button', {name: 'Volver al CRM'}).click();
    await page.getByRole('button', {name: 'Importar CSV'}).click();
    await page.getByLabel('Archivo CSV').setInputFiles({
      name: 'prospectos.csv', mimeType: 'text/csv',
      buffer: Buffer.from('nombre,ciudad,campaña\nTienda Flor,Asunción,Invierno\nTaller Ñandutí,Luque,Invierno\n'),
    });
    await page.getByRole('button', {name: 'Ver vista previa'}).click();
    await expect(page.getByText('1 duplicadas')).toBeVisible();
    await page.getByRole('button', {name: 'Importar 1 válidas'}).click();
    await expect(page.getByText('1 prospectos importados.')).toBeVisible();
    await page.getByRole('button', {name: 'Cerrar importación'}).click();
    await page.getByRole('button', {name: 'Funnel', exact: true}).click();
    await page.getByRole('region', {name: 'Tablero de etapas'}).getByRole('button', {name: 'Validado 1'}).click();
    await expect(page.getByRole('button', {name: 'Taller Ñandutí'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Tienda Flor'})).toHaveCount(0);

    await page.setViewportSize({width: 390, height: 844});
    await page.getByRole('button', {name: 'Dashboard', exact: true}).click();
    await expect(page.getByRole('button', {name: /Tareas vencidas/})).toBeVisible();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close();
  }
});
