import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('Flota permite recuperar el acceso de un chofer sin duplicarlo',async({page})=>{
 const send=async(path:string,data:Record<string,unknown>)=>{const response=await page.request.post(path,{headers:{'X-Requested-With':'logistics-os'},data:{commandId:randomUUID(),...data}});expect(response.ok(),await response.text()).toBeTruthy();return response.json();};
 const session=await(await page.request.get('/api/session')).json();
 if(session.setupRequired)await send('/api/setup',{organizationName:'QA flota',timezone:'America/Asuncion',username:'qa-browser',password:'QA-Browser-Isolated-2026!'});else await send('/api/login',{username:'qa-browser',password:'QA-Browser-Isolated-2026!'});
 const suffix=randomUUID().slice(0,8),name='Chofer QA '+suffix;
 const driver=(await send('/api/drivers',{name,username:'old-'+suffix,password:'QA-Driver-2026!'})).id;
 const before=await(await page.request.get('/api/company')).json();
 const original=before.team.find((m:any)=>m.driverId===driver);
 await send('/api/users/'+original.id+'/delete',{});
 await page.goto('/');await page.getByRole('button',{name:'Flota',exact:true}).click();await page.getByRole('button',{name:'Choferes',exact:true}).click();
 const row=page.getByRole('row').filter({hasText:name});await row.getByRole('button',{name:'Crear acceso'}).click();
 await page.getByRole('textbox',{name:'Usuario',exact:true}).fill('new-'+suffix);
 await page.getByLabel('Contraseña inicial').last().fill('QA-Driver-2026!');
 await page.getByRole('button',{name:'Crear acceso',exact:true}).last().click();
 await expect(row).toContainText('new-'+suffix);await expect(row).toContainText('Activo');
 const after=await(await page.request.get('/api/company')).json();expect(after.team.filter((m:any)=>m.driverId===driver)).toHaveLength(1);
 await page.getByRole('button',{name:'Empresa y equipo',exact:true}).click();await page.getByRole('button',{name:'Equipo interno',exact:true}).click();await expect(page.getByRole('row').filter({hasText:name})).toHaveCount(0);
});
