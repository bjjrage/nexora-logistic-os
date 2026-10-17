import test from 'node:test';
import { Store } from '../server/db.ts';
import { warehouseStory } from './warehouse-story.ts';

test('circuito completo: inventario → pedido → carga → QuadMinds con foto/firma → retorno → portal (proveedor fixture)',async()=>{
  const store=new Store(':memory:');try{await warehouseStory(store);}finally{await store.close();}
});
