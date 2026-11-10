import test from 'node:test';
import {Store} from '../server/db.ts';
import {checkClientRemoval,checkClientWithBillingIsKept,checkProductRemoval} from './support/client-removal.ts';

test('eliminar cliente sin historial y archivar con custodia e historial protegidos',async t=>{
 const db=new Store(':memory:');
 t.after(()=>db.close());
 await checkClientRemoval(db);
});

test('eliminar un SKU retira el stock disponible y conserva su historial',async t=>{
 const db=new Store(':memory:');
 t.after(()=>db.close());
 await checkProductRemoval(db);
});

test('la base conserva los documentos de facturación al archivar',async t=>{
 const db=new Store(':memory:');t.after(()=>db.close());
 await checkClientWithBillingIsKept(db);
});
