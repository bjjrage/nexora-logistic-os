import test from 'node:test';
import {Store} from '../server/db.ts';
import {checkClientRemoval,checkProductRemoval} from './support/client-removal.ts';

test('borrar cliente elimina sus datos en una operación, conserva la ruta mixta y respeta la custodia',async t=>{
 const db=new Store(':memory:');
 t.after(()=>db.close());
 await checkClientRemoval(db);
});

test('eliminar un SKU retira el stock disponible y conserva su historial',async t=>{
 const db=new Store(':memory:');
 t.after(()=>db.close());
 await checkProductRemoval(db);
});
