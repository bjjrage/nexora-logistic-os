import type {Database,Row} from './database.ts';
import {camel} from './db.ts';
const fields={legalName:'legal_name',taxId:'tax_id',contactName:'contact_name',phone:'phone',email:'email',address:'address',city:'city',notes:'notes'};

// Called inside the client's audited transaction; omitted fields retain their saved values.
export async function saveClientProfile(store:Database,orgId:string,clientId:string,input:Row){
 const existing=await store.one('SELECT * FROM client_profiles WHERE org_id=? AND client_id=?',orgId,clientId);
 const entries=Object.entries(fields),columns=entries.map(([,column])=>column);
 const values=entries.map(([key,column])=>input[key]??existing?.[column]??'');
 await store.run(`INSERT INTO client_profiles(org_id,client_id,${columns.join(',')},updated_at) VALUES(${Array(11).fill('?').join(',')}) ON CONFLICT(org_id,client_id) DO UPDATE SET ${columns.map(c=>`${c}=excluded.${c}`).join(',')},updated_at=excluded.updated_at`,orgId,clientId,...values,new Date().toISOString());
}

export async function clientProfileSummaries(store:Database,orgId:string,limit=500){
 const rows=await store.all(`SELECT c.id,p.legal_name,p.tax_id,p.contact_name,p.phone,p.email,p.address,p.city,p.notes,p.updated_at,
 (SELECT COUNT(*) FROM inventory_products i WHERE i.org_id=c.org_id AND i.client_id=c.id AND i.active=1) AS catalog_product_count
 FROM clients c LEFT JOIN client_profiles p ON p.org_id=c.org_id AND p.client_id=c.id
 WHERE c.org_id=? ORDER BY c.rowid DESC LIMIT ?`,orgId,limit);
 return new Map(rows.map(row=>[row.id,camel(row)]));
}
