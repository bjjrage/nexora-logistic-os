import type { Express, Request } from 'express';
import type { Database } from './database.ts';
import type { Actor } from './auth.ts';
import { Inventory, inventorySchemas, type InventoryActor } from './inventory.ts';
import { CatalogImport } from './catalog-import.ts';
import {parseOrdersXlsx} from './order-xlsx.ts';
import {authorize} from './auth.ts';
import {StockReceipts} from './stock-receipts.ts';
import {Routing} from './routing.ts';
import {relayRouting} from './routing-relay.ts';
import {correctDispatchOrders} from './dispatch-corrections.ts';
import {confirmDispatchLocations} from './dispatch-location-review.ts';
import {ReservedDispatch} from './reserved-dispatch.ts';

export type InventoryAuth = (req: Request) => Promise<Actor | InventoryActor>;
const actorForInventory = async (auth: InventoryAuth, req: Request) => await auth(req) as InventoryActor;
const queryString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Mount the inventory and client-order APIs before the application's legacy-role guard. */
export function installInventoryRoutes(app: Express, store: Database, auth: InventoryAuth) {
  const inventory = new Inventory(store);
  const catalog = new CatalogImport(store);
  const receipts = new StockReceipts(store);
  const routing = new Routing(store);
  const dispatch = new ReservedDispatch(store);
  app.get('/api/routing/queue',async(req,res)=>res.json(await dispatch.board(await auth(req) as Actor,queryString(req.query.date))));
  app.post('/api/routing/organize',async(req,res)=>{const actor=await auth(req) as Actor;res.json(await relayRouting(req,actor,store.kind,'/organize')??await dispatch.organize(actor,req.body));});
  app.post('/api/routing/approve',async(req,res)=>res.json(await dispatch.approve(await auth(req) as Actor,req.body)));
  app.post('/api/routing/discard',async(req,res)=>res.json(await dispatch.discard(await auth(req) as Actor,req.body)));
  app.post('/api/routing/correct-orders',async(req,res)=>res.json(await correctDispatchOrders(store,await auth(req) as Actor,req.body)));
  app.post('/api/routing/confirm-locations',async(req,res)=>res.json(await confirmDispatchLocations(store,await auth(req) as Actor,req.body)));
  app.post('/api/routing/suggest',async(req,res)=>{const actor=await auth(req) as Actor;res.json(await relayRouting(req,actor,store.kind,'/suggest')??await routing.suggest(actor,req.body));});
  app.get('/api/routing/context',async(req,res)=>{const actor=await auth(req) as Actor;res.json(await relayRouting(req,actor,store.kind,'/context')??await routing.context(actor));});
  app.get('/api/routing/orders',async(req,res)=>res.json(await routing.orders(await auth(req) as Actor,String(req.query.date??''),queryString(req.query.clientId),req.query.reservedOnly==='true')));
  app.post('/api/routing/points',async(req,res)=>res.json(await routing.point(await auth(req) as Actor,req.body)));
  app.post('/api/routing/matrix',async(req,res)=>res.json(await routing.matrix(await auth(req) as Actor,req.body)));
  app.post('/api/routing/search',async(req,res)=>{const actor=await auth(req) as Actor;res.json(await relayRouting(req,actor,store.kind,'/search')??await routing.search(actor,req.body));});
  app.post('/api/routing/preview',async(req,res)=>{const actor=await auth(req) as Actor;res.json(await relayRouting(req,actor,store.kind,'/preview')??await routing.preview(actor,req.body));});
  app.post('/api/routing/apply',async(req,res)=>res.json(await routing.apply(await auth(req) as Actor,req.body)));
  app.get('/api/inventory/receipts/template.xlsx',async(req,res)=>{
    const file=receipts.template(await actorForInventory(auth,req));
    res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="nexora-stock-template.xlsx"'}).send(file);
  });
  app.post('/api/inventory/receipts/read',async(req,res)=>res.json(receipts.read(await actorForInventory(auth,req),req.body)));
  app.post('/api/inventory/receipts/preview',async(req,res)=>res.json(await receipts.preview(await actorForInventory(auth,req),req.body)));
  app.post('/api/inventory/receipts/batch',async(req,res)=>res.status(201).json(await receipts.commit(await actorForInventory(auth,req),req.body)));
  app.get('/api/inventory/receipts/imports',async(req,res)=>res.json(await receipts.history(await actorForInventory(auth,req),queryString(req.query.clientId))));
  app.post('/api/orders/import/xlsx',async(req,res)=>{const actor=await auth(req);authorize(actor as Actor,['ADMIN','OPERATIONS']);res.json(parseOrdersXlsx(req.body));});
  app.get('/api/inventory/products',async(req,res)=>res.json(await inventory.catalogPage(await actorForInventory(auth,req),req.query)));
  app.get('/api/inventory/stock',async(req,res)=>res.json(await inventory.stockPage(await actorForInventory(auth,req),req.query)));
  app.get('/api/inventory/lookup',async(req,res)=>res.json(await inventory.lookupCode(await actorForInventory(auth,req),req.query)));
  app.get('/api/inventory/catalog/template.csv', async (req, res) => {
    const csv = catalog.templateCsv(await actorForInventory(auth, req));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nexora-catalog-template.csv"' }).send(csv);
  });
  app.post('/api/inventory/catalog/preview', async (req, res) => res.json(await catalog.preview(await actorForInventory(auth, req), req.body ?? {})));
  app.post('/api/inventory/catalog/import', async (req, res) => res.status(201).json(await catalog.import(await actorForInventory(auth, req), req.body ?? {})));
  app.get('/api/inventory', async (req, res) => res.json(await inventory.bootstrap(await actorForInventory(auth, req), queryString(req.query.clientId))));
  app.get('/api/inventory/export.csv', async (req, res) => {
    const csv = await inventory.exportCsv(await actorForInventory(auth, req), queryString(req.query.clientId));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="nexora-inventory.csv"' }).send(csv);
  });
  app.post('/api/orders/import/preview', async (req, res) => res.json(await inventory.previewImport(await actorForInventory(auth, req), req.body ?? {})));
  app.get('/api/orders/imports', async (req, res) => res.json(await inventory.importHistory(await actorForInventory(auth, req))));
  app.post('/api/inventory/products', async (req, res) => res.status(201).json(await inventory.createProduct(await actorForInventory(auth, req), inventorySchemas.product.parse(req.body))));
  app.patch('/api/inventory/products/:id', async (req, res) => res.json(await inventory.updateProduct(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.productUpdate.parse(req.body))));
  app.post('/api/inventory/locations', async (req, res) => res.status(201).json(await inventory.createLocation(await actorForInventory(auth, req), inventorySchemas.location.parse(req.body))));
  app.patch('/api/inventory/locations/:id', async (req, res) => res.json(await inventory.updateLocation(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.locationUpdate.parse(req.body))));
  app.post('/api/inventory/receipts', async (req, res) => res.json(await inventory.receive(await actorForInventory(auth, req), inventorySchemas.receive.parse(req.body))));
  app.post('/api/inventory/movements', async (req, res) => res.json(await inventory.move(await actorForInventory(auth, req), inventorySchemas.move.parse(req.body))));
  app.post('/api/inventory/adjustments', async (req, res) => res.json(await inventory.adjust(await actorForInventory(auth, req), inventorySchemas.adjust.parse(req.body))));

  app.get(['/api/orders', '/api/orders/read'], async (req, res) => res.json(await inventory.orders(await actorForInventory(auth, req), queryString(req.query.clientId),req.query)));
  app.get('/api/orders/:id', async (req, res) => res.json(await inventory.order(await actorForInventory(auth, req), String(req.params.id))));
  app.post('/api/orders', async (req, res) => res.status(201).json(await inventory.createOrder(await actorForInventory(auth, req), inventorySchemas.order.parse(req.body))));
  app.patch('/api/orders/:id', async (req, res) => res.json(await inventory.updateOrder(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.orderUpdate.parse(req.body))));
  app.post('/api/orders/:id/cancel', async (req, res) => res.json(await inventory.cancelOrder(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.orderCancel.parse(req.body))));
  app.post('/api/orders/import', async (req, res) => {
    const actor = await actorForInventory(auth, req);
    if (typeof req.body?.csv === 'string') return res.status(201).json(await inventory.importCsv(actor, req.body));
    return res.status(201).json(await inventory.importOrders(actor, req.body ?? {}));
  });
  app.post('/api/orders/:id/reserve', async (req, res) => res.json(await inventory.reserveOrder(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.reserve.parse(req.body))));
  app.post('/api/orders/:id/unreserve', async (req, res) => res.json(await inventory.unreserveOrder(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.unreserve.parse(req.body))));
  app.post('/api/orders/:id/load', async (req, res) => res.json(await inventory.loadOrder(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.load.parse(req.body))));
  app.post('/api/orders/:id/return', async (req, res) => res.json(await inventory.returnOrder(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.return.parse(req.body))));
  app.post('/api/orders/:id/release', async (req, res) => res.json(await inventory.release(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.release.parse(req.body))));
  return inventory;
}
