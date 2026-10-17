import type {Database} from './database.ts';
import {ensure} from './errors.ts';

export async function verifyProductCodes(store:Database,orgId:string,clientId:string,id:string,sku:string,barcode:string|null){
 const codes=[...new Set([sku,barcode].filter((value):value is string=>Boolean(value)).map(value=>value.toLowerCase()))];
 for(const code of codes){
  ensure(!await store.one('SELECT id FROM inventory_products WHERE org_id=? AND client_id=? AND id<>? AND (lower(sku)=? OR lower(barcode)=?)',orgId,clientId,id,code,code),'VALIDATION_ERROR','El SKU o código de barras ya identifica otro producto de este cliente.',409);
  ensure(!await store.one('SELECT id FROM inventory_units WHERE org_id=? AND client_id=? AND (lower(serial)=? OR lower(barcode)=?)',orgId,clientId,code,code),'VALIDATION_ERROR','El código ya identifica una unidad serializada de este cliente.',409);
 }
}
