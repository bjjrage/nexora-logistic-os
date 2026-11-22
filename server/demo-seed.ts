import {randomUUID} from 'node:crypto';
import type {Database} from './database.ts';
import {setup,passwordHash,type Actor} from './auth.ts';
import {Inventory} from './inventory.ts';
import {Logistics} from './domain.ts';

export async function seedPrivateDemo(db:Database) {
  if(db.kind!=='sqlite')throw new Error('La demo sólo usa SQLite aislado.');
  if(await db.one('SELECT id FROM users LIMIT 1'))return;
  await db.transaction(async()=>{
    const adminPass=process.env.DEMO_ADMIN_PASSWORD??'',merchantPass=process.env.DEMO_CUSTOMER_PASSWORD??'';
    if(adminPass.length<14||merchantPass.length<14)throw new Error('Faltan contraseñas de demo.');
    const {userId,orgId}=await setup(db,{organizationName:'DEMO · NEXORA OS4 · FICTICIA',timezone:'America/Asuncion',username:'demo.admin',password:adminPass});
    const actor:Actor={id:userId,orgId,name:'Administración DEMO',role:'ADMIN',driverId:null};
    const command=()=>({commandId:randomUUID()});
    const service=new Logistics(db),inventory=new Inventory(db);
    const clientId=(await service.createClient(actor,{...command(),name:'Boutique del Sur · FICTICIO'})).id;
    const loc=(await inventory.createLocation(actor,{...command(),code:'DEMO-CENTRAL',name:'Depósito demo central',kind:'DEPOT'})).id;
    const p1=(await inventory.createProduct(actor,{...command(),clientId,sku:'DEMO-REM-01',name:'Remera de prueba',tracking:'QUANTITY'})).id;
    const p2=(await inventory.createProduct(actor,{...command(),clientId,sku:'DEMO-BOL-02',name:'Bolso de prueba',tracking:'QUANTITY'})).id;
    await inventory.receive(actor,{...command(),clientId,productId:p1,locationId:loc,quantity:25,reference:'DEMO-IN-1'});
    await inventory.receive(actor,{...command(),clientId,productId:p2,locationId:loc,quantity:12,reference:'DEMO-IN-2'});
    await inventory.createOrder(actor,{...command(),clientId,externalId:'DEMO-PEDIDO-001',orderDate:new Date().toISOString().slice(0,10),destination:'Calle y barrio ficticios',recipientName:'Destinatario de ejemplo',lines:[{productId:p1,quantity:2}]});
    const now=new Date().toISOString();
    await db.run('INSERT INTO customer_accounts(id,org_id,client_id,name,username,password_hash,enabled,created_at) VALUES(?,?,?,?,?,?,1,?)',
      randomUUID(),orgId,clientId,'Comerciante DEMO','demo.comercio',passwordHash(merchantPass),now);
    for(const [i,fixture] of [
      {name:'Tienda Norte Ejemplo · FICTICIA',sector:'indumentaria',city:'Concepción',mail:'contacto@tienda.invalid'},
      {name:'Distribuidora Paraná Prueba · FICTICIA',sector:'repuestos',city:'Ciudad del Este',mail:'contacto@distribuidora.invalid'},
      {name:'Comercio Central Ejemplo · FICTICIO',sector:'cosméticos',city:'Luque',mail:'contacto@central.invalid'},
    ].entries()) {
      const id=randomUUID(),contactId=randomUUID(),threadId=randomUUID();
      await db.run('INSERT INTO crm_prospects(org_id,id,name,sector,city,department,source,campaign,owner_id,search_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        orgId,id,fixture.name,fixture.sector,fixture.city,'DEMO','FICTICIO','Prueba interna',userId,(fixture.name+' '+fixture.sector+' '+fixture.city).toLowerCase(),now,now);
      await db.run('INSERT INTO crm_contacts(org_id,prospect_id,id,name,email,preferred_channel) VALUES(?,?,?,?,?,?)',
        orgId,id,contactId,'Contacto ficticio',fixture.mail,'EMAIL');
      await db.run('INSERT INTO crm_outreach_threads(org_id,id,prospect_id,contact_id,channel,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        orgId,threadId,id,contactId,'EMAIL',userId,now,now);
      if(i===0)await db.run("INSERT INTO crm_outreach_messages(org_id,thread_id,id,state,body,created_by,created_at) VALUES(?,?,?,'DRAFT',?,?,?)",
        orgId,threadId,randomUUID(),'Hola, esto es un mensaje de demostración interna. No fue enviado.',userId,now);
    }
  });
}
