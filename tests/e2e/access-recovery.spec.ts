import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

test('recovery UI accepts the same six-character minimum and the account can log in with different username case',async({page})=>{
 const post=async(path:string,data:Record<string,unknown>)=>{const r=await page.request.post(path,{headers:{'X-Requested-With':'logistics-os'},data});expect(r.ok(),`${path}: ${r.status()}`).toBeTruthy();return r.json();};
 const session=await(await page.request.get('/api/session')).json();
 if(session.setupRequired)await post('/api/setup',{organizationName:'QA aislada',timezone:'America/Asuncion',username:'qa-browser',password:'QA-Browser-Isolated-2026!'});
 else await post('/api/login',{username:'qa-browser',password:'QA-Browser-Isolated-2026!'});
 const username='QaRecovery'+randomUUID().slice(0,8),user=await post('/api/users',{commandId:randomUUID(),name:'QA recuperación',username,password:'QA-inicial',role:'ADMIN'});
 const recovery=await post('/api/password-recovery/issue',{kind:'USER',id:user.id});
 await page.goto('/#restablecer='+recovery.token);
 await page.getByLabel('Nueva contraseña',{exact:true}).fill('abcdef');await page.getByLabel('Repetir contraseña',{exact:true}).fill('abcdef');
 await page.getByRole('button',{name:'Guardar nueva contraseña'}).click();await expect(page.getByRole('heading',{name:'Contraseña actualizada'})).toBeVisible();
 await post('/api/logout',{});
 const login=await page.request.post('/api/login',{headers:{'X-Requested-With':'logistics-os'},data:{username:username.toLowerCase(),password:'abcdef'}});expect(login.status()).toBe(200);
});
