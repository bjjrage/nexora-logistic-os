import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db.ts';
import {setup,type Actor} from '../server/auth.ts';
import {CompanyAdministration} from '../server/company.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {createApp} from '../server/app.ts';

const command=()=>({commandId:randomUUID()});
const forbidden=(error:any)=>error.code==='FORBIDDEN';
async function fixture(t:any){
 const store=new Store(':memory:');t.after(()=>store.close());
 const initial=await setup(store,{organizationName:'Universo',timezone:'America/Asuncion',username:'qa.admin',password:'QA-Company-2026!'});
 const actor:Actor={id:initial.userId,orgId:initial.orgId,name:'Administrador QA',role:'ADMIN',driverId:null};
 const domain=new Logistics(store),company=new CompanyAdministration(store);
 const client=(await domain.createClient(actor,{...command(),name:'Universo'})).id;
 return {store,actor,domain,company,client};
}

test('empresa operadora se corrige sin convertir al cliente en empresa ni cambiar su personal; auditoría e aislamiento',async t=>{
 const {store,actor,domain,company,client}=await fixture(t);
 await domain.createUser(actor,{...command(),name:'Depósito QA',username:'qa.depot',password:'QA-Company-2026!',role:'DEPOT'});
 const body={...command(),name:'Nexora Logistic',timezone:'America/Asuncion'};
 const result=await company.update(actor,body);
 assert.deepEqual(await company.update(actor,body),result);
 assert.equal((await store.one('SELECT COUNT(*) n FROM audit WHERE command_id=?',body.commandId))!.n,1);
 assert.equal((await store.one('SELECT name FROM clients WHERE id=?',client))!.name,'Universo');
 const read=await company.read(actor);
 assert.equal(read.organization!.id,actor.orgId);assert.equal(read.organization!.name,'Nexora Logistic');
 assert.deepEqual(read.team.map(user=>user.role).sort(),['ADMIN','DEPOT']);
 assert.ok(read.team.every(user=>!('password_hash' in user)&&!('passwordHash' in user)));
 const depot={...actor,role:'DEPOT' as const};
 const bootstrap=JSON.parse(JSON.stringify(await domain.bootstrap(depot)));
 assert.equal(bootstrap.organization.name,'Nexora Logistic');
 assert.equal(bootstrap.clients[0].name,'Universo');
 assert.deepEqual(JSON.parse(JSON.stringify(bootstrap.organization.supportContacts)),[{name:'Administración',role:'ADMIN'}]);
 for(const role of ['OPERATIONS','DEPOT','DRIVER','CUSTOMER'] as const){
  await assert.rejects(()=>company.read({...actor,role}),forbidden);
  await assert.rejects(()=>company.update({...actor,role},{...command(),name:'Invalid',timezone:'UTC'}),forbidden);
 }
 await assert.rejects(()=>company.update(actor,{...command(),name:'Wrong',timezone:'No/Such_Timezone'}),(e:any)=>e.code==='VALIDATION_ERROR');
 assert.equal((await company.read(actor)).organization!.name,'Nexora Logistic');
 const other=randomUUID();await store.run('INSERT INTO organizations VALUES(?,?,?)',other,'Otra empresa','UTC');
 assert.deepEqual((await company.read({...actor,orgId:other})).team,[]);
});

test('editar cliente conserva identidad, stock y envíos; rechaza roles y otra empresa',async t=>{
 const {store,actor,domain,client}=await fixture(t),inventory=new Inventory(store);
 const location=(await inventory.createLocation(actor,{...command(),code:'QA',name:'Depósito QA',kind:'DEPOT'})).id;
 const product=(await inventory.createProduct(actor,{...command(),clientId:client,sku:'QA-1',name:'Producto QA',tracking:'QUANTITY',unit:'unidad',weightGrams:100,volumeCm3:100})).id;
 await inventory.receive(actor,{...command(),clientId:client,productId:product,locationId:location,quantity:3,reference:'QA',reason:''});
 const shipment=(await domain.createShipment(actor,{...command(),clientId:client,reference:'QA-1',originText:'QA',destinationText:'QA',recipientName:'QA',recipientPhone:'',proofPolicy:'RECEIVER',parcelCount:1,weightGrams:100,volumeCm3:100})).id;
 const body={...command(),name:'Universo actualizado'};
 const result=await domain.updateClient(actor,client,body);assert.deepEqual(await domain.updateClient(actor,client,body),result);
 assert.equal(result.id,client);assert.equal((await store.one('SELECT client_id FROM shipments WHERE id=?',shipment))!.client_id,client);
 const balance=await store.one('SELECT client_id,quantity FROM inventory_balances WHERE product_id=?',product);
 assert.equal(balance!.client_id,client);assert.equal(balance!.quantity,3);
 assert.equal((await store.one('SELECT COUNT(*) n FROM audit WHERE command_id=?',body.commandId))!.n,1);
 for(const role of ['DEPOT','DRIVER','CUSTOMER'] as const)await assert.rejects(()=>domain.updateClient({...actor,role},client,{...command(),name:'Wrong'}),forbidden);
 const other=randomUUID();await store.run('INSERT INTO organizations VALUES(?,?,?)',other,'Otra','UTC');
 await assert.rejects(()=>domain.updateClient({...actor,orgId:other},client,{...command(),name:'Wrong'}),(e:any)=>e.code==='NOT_FOUND');
 assert.equal((await store.one('SELECT name FROM clients WHERE id=?',client))!.name,'Universo actualizado');
});

test('HTTP: empresa y edición de clientes requieren sesión, CSRF y rol correspondiente',async t=>{
 const {store,actor,domain,client}=await fixture(t);
 await domain.createUser(actor,{...command(),name:'Depósito QA',username:'qa.depot',password:'QA-Company-2026!',role:'DEPOT'});
 const server=createApp(store).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 t.after(()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r())));
 const base='http://127.0.0.1:'+(server.address() as {port:number}).port;let cookie='';
 const post=async(path:string,body:unknown,csrf=true)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(csrf?{'X-Requested-With':'logistics-os'}:{}),Cookie:cookie},body:JSON.stringify(body)});
 const login=async(username:string)=>{const response=await post('/api/login',{username,password:'QA-Company-2026!'});assert.equal(response.status,200);cookie=response.headers.get('set-cookie')!.split(';')[0];};
 assert.equal((await fetch(base+'/api/company')).status,401);
 await login('qa.admin');
 const originalAccount=await store.one('SELECT id,username,password_hash,role FROM users WHERE id=?',actor.id);
 // Editing a display name must be visible with the existing cookie, without changing access.
 await store.run('UPDATE users SET name=? WHERE id=?','Administración Nexora',actor.id);
 const currentSession=await (await fetch(base+'/api/session',{headers:{Cookie:cookie}})).json();
 const currentBootstrap=await (await fetch(base+'/api/bootstrap',{headers:{Cookie:cookie}})).json();
 assert.equal(currentSession.user.name,'Administración Nexora');assert.equal(currentBootstrap.user.name,'Administración Nexora');
 assert.deepEqual(await store.one('SELECT id,username,password_hash,role FROM users WHERE id=?',actor.id),originalAccount);
 assert.equal((await post('/api/company',{...command(),name:'Nexora Logistic',timezone:'UTC'},false)).status,403);
 assert.equal((await post('/api/company',{...command(),name:'Nexora Logistic',timezone:'America/Asuncion'})).status,200);
 assert.equal((await post('/api/clients/'+client,{...command(),name:'   '})).status,400);
 assert.equal((await post('/api/clients/'+client,{...command(),name:'Universo'})).status,200);
 await login('qa.depot');
 assert.equal((await fetch(base+'/api/company',{headers:{Cookie:cookie}})).status,403);
 assert.equal((await post('/api/clients/'+client,{...command(),name:'Wrong'})).status,403);
 const bootstrap=await (await fetch(base+'/api/bootstrap',{headers:{Cookie:cookie}})).json();
 assert.equal(bootstrap.organization.name,'Nexora Logistic');assert.equal(bootstrap.clients[0].name,'Universo');
});

test('HTTP: Administración puede crear otra cuenta de Administración que luego inicia sesión',async t=>{
 const {store}=await fixture(t);
 const server=createApp(store).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 t.after(()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r())));
 const base='http://127.0.0.1:'+(server.address() as {port:number}).port;let cookie='';
 const post=async(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os',Cookie:cookie},body:JSON.stringify(body)});
 const login=async(username:string)=>{const response=await post('/api/login',{username,password:'QA-Company-2026!'});assert.equal(response.status,200);cookie=response.headers.get('set-cookie')!.split(';')[0];};
 await login('qa.admin');
 const created=await post('/api/users',{...command(),name:'Segunda Administración',username:'qa.admin2',password:'QA-Company-2026!',role:'ADMIN'});
 assert.equal(created.status,200);
 await login('qa.admin2');
 assert.equal((await (await fetch(base+'/api/session',{headers:{Cookie:cookie}})).json()).user.role,'ADMIN');
});

test('HTTP: Administración elimina cuentas del equipo; pierden acceso, liberan el usuario y conservan historial',async t=>{
 const {store,actor,domain}=await fixture(t);
 const depot=await domain.createUser(actor,{...command(),name:'Depósito Borrar',username:'qa.borrar',password:'QA-Company-2026!',role:'DEPOT'});
 const server=createApp(store).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 t.after(()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r())));
 const base='http://127.0.0.1:'+(server.address() as {port:number}).port;let cookie='';
 const post=async(path:string,body:unknown,c=cookie)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os',Cookie:c},body:JSON.stringify(body)});
 const login=async(username:string)=>{const response=await post('/api/login',{username,password:'QA-Company-2026!'},'');assert.equal(response.status,200);return response.headers.get('set-cookie')!.split(';')[0];};
 const adminCookie=await login('qa.admin'),depotCookie=await login('qa.borrar');cookie=adminCookie;
 assert.equal((await post(`/api/users/${depot.id}/delete`,{...command()},depotCookie)).status,403);
 assert.equal((await post(`/api/users/${actor.id}/delete`,{...command()})).status,409);
 assert.equal((await post(`/api/users/${depot.id}/delete`,{...command()})).status,200);
 assert.equal((await post('/api/login',{username:'qa.borrar',password:'QA-Company-2026!'},'')).status,401);
 assert.equal((await (await fetch(base+'/api/session',{headers:{Cookie:depotCookie}})).json()).user,null);
 const team=await (await fetch(base+'/api/company',{headers:{Cookie:adminCookie}})).json();
 assert.ok(!team.team.some((m:any)=>m.id===depot.id));
 assert.equal((await post(`/api/users/${depot.id}/access`,{...command(),enabled:true})).status,404);
 assert.equal((await post('/api/users',{...command(),name:'Nuevo',username:'qa.borrar',password:'QA-Company-2026!',role:'DEPOT'})).status,200);
 assert.ok(await store.one('SELECT id FROM users WHERE id=?',depot.id));
});
