import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db.ts';
import {setup,type Actor} from '../server/auth.ts';
import {Logistics} from '../server/domain.ts';
import {Inventory} from '../server/inventory.ts';
import {CatalogImport} from '../server/catalog-import.ts';
import {createApp} from '../server/app.ts';
import {saveClientProfile} from '../server/client-profiles.ts';
const command=()=>({commandId:randomUUID()});
const profile={name:'Cliente QA',legalName:'Empresa ficticia QA',taxId:'QA-0001',contactName:'Contacto ficticio',phone:'+595000000000',email:'contacto@example.test',address:'Dirección ficticia QA',city:'Ciudad QA',notes:'Indicaciones internas de prueba'};
async function fixture(t:any){const store=new Store(':memory:');t.after(()=>store.close());const {orgId,userId}=await setup(store,{organizationName:'Nexora QA',timezone:'America/Asuncion',username:'qa.admin',password:'QA-Client-2026!'});const actor:Actor={id:userId,orgId,name:'QA',role:'ADMIN',driverId:null};return {store,actor,domain:new Logistics(store)};}

test('ficha completa se guarda, relee y edita sin perder campos omitidos; idempotencia y RUC por empresa',async t=>{
 const {store,actor,domain}=await fixture(t),body={...command(),...profile};
 const created=await domain.createClient(actor,body);assert.deepEqual(await domain.createClient(actor,body),created);
 const boot=JSON.parse(JSON.stringify(await domain.bootstrap(actor))),client=boot.clients[0];
 assert.equal(boot.clientProfilesEnabled,true);for(const [key,value] of Object.entries(profile))assert.equal(client[key],value);
 assert.equal(Number(client.catalogProductCount),0);
 await domain.updateClient(actor,created.id,{...command(),name:'Cliente QA actualizado',phone:'+595000000001'});
 const fresh=JSON.parse(JSON.stringify(await domain.bootstrap(actor))).clients[0];
 assert.equal(fresh.name,'Cliente QA actualizado');assert.equal(fresh.phone,'+595000000001');assert.equal(fresh.email,profile.email);assert.equal(fresh.taxId,profile.taxId);
 await domain.updateClient(actor,created.id,{...command(),name:fresh.name,email:''});
 assert.equal((await store.one('SELECT email FROM client_profiles WHERE client_id=?',created.id))!.email,'');
 const count=(await store.one('SELECT COUNT(*) n FROM clients'))!.n;
 await assert.rejects(()=>domain.createClient(actor,{...command(),...profile,name:'Duplicado'}),(e:any)=>e.code==='VALIDATION_ERROR'&&e.message.includes('RUC'));
 assert.equal((await store.one('SELECT COUNT(*) n FROM clients'))!.n,count);
 assert.equal((await store.one('SELECT COUNT(*) n FROM audit WHERE command_id=?',body.commandId))!.n,1);
 const foreignOrg=randomUUID();await store.run('INSERT INTO organizations VALUES(?,?,?)',foreignOrg,'Otra empresa','UTC');
 const foreignClient=randomUUID();await store.run('INSERT INTO clients VALUES(?,?,?)',foreignClient,foreignOrg,'Cliente de otra empresa');
 await saveClientProfile(store,foreignOrg,foreignClient,profile);
 await assert.rejects(()=>domain.updateClient({...actor,orgId:foreignOrg},created.id,{...command(),name:'Wrong'}),(e:any)=>e.code==='NOT_FOUND');
 for(const role of ['DEPOT','DRIVER','CUSTOMER'] as const)await assert.rejects(()=>domain.updateClient({...actor,role},created.id,{...command(),name:'Wrong'}),(e:any)=>e.code==='FORBIDDEN');
 const depot=JSON.parse(JSON.stringify(await domain.bootstrap({...actor,role:'DEPOT'})));
 assert.equal(depot.clients[0].name,fresh.name);assert.ok(!('email' in depot.clients[0]));assert.ok(!('notes' in depot.clients[0]));
});

test('cliente existente sin ficha conserva identidad y puede pasar a catálogo y recepción',async t=>{
 const {store,actor,domain}=await fixture(t),id=randomUUID();await store.run('INSERT INTO clients VALUES(?,?,?)',id,actor.orgId,'Universo QA');
 assert.equal((await store.one('SELECT COUNT(*) n FROM client_profiles'))!.n,0);
 await domain.updateClient(actor,id,{...command(),...profile,name:'Universo QA'});
 await new CatalogImport(store).import(actor,{...command(),clientId:id,csv:'sku,nombre,pesoKg,volumenM3\nSKU-QA-01,Producto ficticio,1,0.001',defaultTracking:'QUANTITY'});
 const inventory=new Inventory(store),location=await inventory.createLocation(actor,{...command(),code:'QA-CENTRAL',name:'Depósito ficticio',kind:'DEPOT'});
 const product=await store.one('SELECT id FROM inventory_products WHERE client_id=?',id);assert.ok(product);
 await inventory.receive(actor,{...command(),clientId:id,productId:product.id,locationId:location.id,quantity:2,reference:'Prueba QA'});
 const boot=JSON.parse(JSON.stringify(await domain.bootstrap(actor)));assert.equal(boot.clients[0].id,id);assert.equal(Number(boot.clients[0].catalogProductCount),1);
 assert.equal((await inventory.bootstrap(actor,id)).totals.AVAILABLE,2);
 assert.equal((await store.one('SELECT contact_name FROM client_profiles WHERE client_id=?',id))!.contact_name,profile.contactName);
});

test('HTTP valida correo y longitud antes de guardar; bootstrap conserva el contrato camelCase de la ficha',async t=>{
 const {store}=await fixture(t),server=createApp(store).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r())));
 const base='http://127.0.0.1:'+(server.address() as {port:number}).port;let cookie='';
 const post=async(path:string,body:any)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'logistics-os',Cookie:cookie},body:JSON.stringify(body)});
 const login=await post('/api/login',{username:'qa.admin',password:'QA-Client-2026!'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie')!.split(';')[0];
 assert.equal((await post('/api/clients',{...command(),...profile,email:'correo inválido'})).status,400);
 assert.equal((await post('/api/clients',{...command(),...profile,phone:'1'.repeat(81)})).status,400);
 assert.equal((await store.one('SELECT COUNT(*) n FROM clients'))!.n,0);
 const created=await post('/api/clients',{...command(),...profile});assert.equal(created.status,200);const {id}=await created.json();
 assert.equal((await store.one('SELECT delivery_provider FROM client_delivery_policies WHERE client_id=?',id))!.delivery_provider,'NEXORA');
 const externalBody={...command(),name:'Cliente externo',deliveryProvider:'QUADMINDS'};
 const external=await (await post('/api/clients',externalBody)).json();assert.deepEqual(await (await post('/api/clients',externalBody)).json(),external);
 assert.equal((await store.one('SELECT delivery_provider FROM client_delivery_policies WHERE client_id=?',external.id))!.delivery_provider,'QUADMINDS');
 assert.equal((await post('/api/clients',{...command(),name:'Inválido',deliveryProvider:'OTHER'})).status,400);
 assert.equal((await post('/api/clients',{...command(),...profile,name:'RUC duplicado',deliveryProvider:'QUADMINDS'})).status,409);
 assert.equal((await store.one('SELECT COUNT(*) n FROM clients'))!.n,2);assert.equal((await store.one('SELECT COUNT(*) n FROM client_delivery_policies'))!.n,2);
 const boot=await (await fetch(base+'/api/bootstrap',{headers:{Cookie:cookie}})).json();
 const client=boot.clients.find((c:any)=>c.id===id);assert.equal(client.legalName,profile.legalName);assert.equal(client.contactName,profile.contactName);assert.ok(!('legal_name' in client));
 assert.equal((await post('/api/clients/'+id,{...command(),name:'Editado',notes:'Nota editada'})).status,200);
 const read=await (await fetch(base+'/api/bootstrap',{headers:{Cookie:cookie}})).json(),updated=read.clients.find((c:any)=>c.id===id);assert.equal(updated.notes,'Nota editada');assert.equal(updated.taxId,profile.taxId);
 assert.equal((await store.one('SELECT delivery_provider FROM client_delivery_policies WHERE client_id=?',id))!.delivery_provider,'NEXORA');
});
