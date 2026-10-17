SET LOCAL search_path TO nexora,pg_catalog;
-- Measured listing/bootstrapping paths on 100k shipments + parcels, not blanket FK indexing.
CREATE INDEX shipments_listing ON shipments(org_id,created_at DESC,id);
CREATE INDEX shipments_bootstrap ON shipments(org_id,_sequence DESC);
CREATE INDEX parcels_bootstrap ON parcels(org_id,_sequence DESC);
CREATE INDEX inventory_orders_listing ON inventory_orders(org_id,order_date DESC,created_at DESC,id);
INSERT INTO schema_migrations(version,applied_at) VALUES(12,now());
