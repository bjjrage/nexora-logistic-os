import type { Express, Request } from 'express';
import type { Database } from './database.ts';
import type { Actor } from './auth.ts';
import { Inventory, inventorySchemas, type InventoryActor } from './inventory.ts';
import { CatalogImport } from './catalog-import.ts';

export type InventoryAuth = (req: Request) => Promise<Actor | InventoryActor>;
const actorForInventory = async (auth: InventoryAuth, req: Request) => await auth(req) as InventoryActor;
const queryString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Mount the inventory and client-order APIs before the application's legacy-role guard. */
export function installInventoryRoutes(app: Express, store: Database, auth: InventoryAuth) {
  const inventory = new Inventory(store);
  const catalog = new CatalogImport(store);
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
  app.post('/api/orders/:id/load', async (req, res) => res.json(await inventory.loadOrder(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.load.parse(req.body))));
  app.post('/api/orders/:id/return', async (req, res) => res.json(await inventory.returnOrder(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.return.parse(req.body))));
  app.post('/api/orders/:id/release', async (req, res) => res.json(await inventory.release(await actorForInventory(auth, req), String(req.params.id), inventorySchemas.release.parse(req.body))));
  return inventory;
}
