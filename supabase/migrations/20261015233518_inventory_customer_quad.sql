-- Inventory, customer read access and QuadMinds operation integration.
SET search_path TO nexora, pg_catalog;

-- 004_inventory.sql
CREATE TABLE inventory_products (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL,
 sku TEXT NOT NULL, barcode TEXT, name TEXT NOT NULL,
 tracking TEXT NOT NULL CHECK(tracking IN ('QUANTITY','SERIAL')),
 unit TEXT NOT NULL DEFAULT 'unit', weight_grams INTEGER CHECK(weight_grams > 0),
 volume_cm3 INTEGER CHECK(volume_cm3 > 0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 UNIQUE(id,org_id), UNIQUE(id,client_id,org_id), UNIQUE(org_id,client_id,sku),
 FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id)
);
CREATE UNIQUE INDEX inventory_products_barcode ON inventory_products(org_id,client_id,barcode) WHERE barcode IS NOT NULL;

CREATE TABLE inventory_locations (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'STORAGE' CHECK(kind IN ('DEPOT','STORAGE','QUARANTINE')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(id,org_id), UNIQUE(org_id,code), FOREIGN KEY(org_id) REFERENCES organizations(id)
);

CREATE TABLE inventory_balances (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, product_id TEXT NOT NULL,
 location_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('AVAILABLE','RESERVED','VEHICLE','QUARANTINE')),
 custody_id TEXT NOT NULL DEFAULT '', order_id TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL CHECK(quantity >= 0), updated_at TIMESTAMPTZ NOT NULL,
 UNIQUE(org_id,client_id,product_id,location_id,status,custody_id,order_id),
 FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id),
 FOREIGN KEY(product_id,client_id,org_id) REFERENCES inventory_products(id,client_id,org_id),
 FOREIGN KEY(location_id,org_id) REFERENCES inventory_locations(id,org_id)
);
CREATE INDEX inventory_balances_lookup ON inventory_balances(org_id,client_id,product_id,status,location_id);
CREATE INDEX inventory_balances_order ON inventory_balances(org_id,order_id,status,product_id);

CREATE TABLE inventory_units (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, product_id TEXT NOT NULL,
 serial TEXT NOT NULL, barcode TEXT, location_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('AVAILABLE','RESERVED','VEHICLE','DELIVERED','QUARANTINE','ADJUSTED')),
 custody_id TEXT NOT NULL DEFAULT '', order_id TEXT NOT NULL DEFAULT '', parcel_id TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 UNIQUE(id,org_id), UNIQUE(id,client_id,org_id), UNIQUE(org_id,client_id,product_id,serial),
 FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id),
 FOREIGN KEY(product_id,client_id,org_id) REFERENCES inventory_products(id,client_id,org_id),
 FOREIGN KEY(location_id,org_id) REFERENCES inventory_locations(id,org_id),
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id)
);
CREATE UNIQUE INDEX inventory_units_barcode ON inventory_units(org_id,barcode) WHERE barcode IS NOT NULL;
CREATE INDEX inventory_units_lookup ON inventory_units(org_id,client_id,product_id,status,location_id);

CREATE TABLE inventory_orders (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, external_id TEXT NOT NULL,
 order_date TEXT NOT NULL, destination TEXT NOT NULL, recipient_name TEXT NOT NULL,
 recipient_phone TEXT NOT NULL DEFAULT '', origin_text TEXT NOT NULL DEFAULT '',
 window_start TEXT, window_end TEXT, service_minutes INTEGER CHECK(service_minutes IS NULL OR service_minutes BETWEEN 1 AND 480), restrictions TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('DRAFT','RESERVED','PARTIALLY_LOADED','LOADED','IN_TRANSIT','PARTIAL','DELIVERED','CANCELLED','EXCEPTION')),
 shipment_id TEXT NOT NULL, proof_policy TEXT NOT NULL DEFAULT 'RECEIVER' CHECK(proof_policy IN ('RECEIVER','RECEIVER_PHOTO')),
 created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 UNIQUE(id,org_id), UNIQUE(id,client_id,org_id), UNIQUE(org_id,client_id,external_id), UNIQUE(shipment_id),
 FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id),
 FOREIGN KEY(shipment_id,org_id) REFERENCES shipments(id,org_id)
);
CREATE INDEX inventory_orders_day ON inventory_orders(org_id,order_date,status);

CREATE TABLE inventory_order_lines (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, order_id TEXT NOT NULL, product_id TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity > 0), reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity >= 0 AND reserved_quantity <= quantity),
 loaded_quantity INTEGER NOT NULL DEFAULT 0 CHECK(loaded_quantity >= 0 AND loaded_quantity <= reserved_quantity), delivered_quantity INTEGER NOT NULL DEFAULT 0 CHECK(delivered_quantity >= 0 AND delivered_quantity <= loaded_quantity),
 returned_quantity INTEGER NOT NULL DEFAULT 0 CHECK(returned_quantity >= 0 AND returned_quantity <= loaded_quantity),
 UNIQUE(id,org_id), UNIQUE(id,client_id,org_id), UNIQUE(order_id,product_id),
 FOREIGN KEY(order_id,client_id,org_id) REFERENCES inventory_orders(id,client_id,org_id),
 FOREIGN KEY(product_id,client_id,org_id) REFERENCES inventory_products(id,client_id,org_id)
);

CREATE TABLE inventory_order_parcels (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, order_id TEXT NOT NULL, line_id TEXT NOT NULL,
 product_id TEXT NOT NULL, parcel_id TEXT NOT NULL, serial_id TEXT, location_id TEXT NOT NULL, custody_id TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL CHECK(state IN ('RESERVED','VEHICLE','DELIVERED','QUARANTINE','RELEASED')),
 created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 UNIQUE(parcel_id),
 FOREIGN KEY(order_id,client_id,org_id) REFERENCES inventory_orders(id,client_id,org_id),
 FOREIGN KEY(line_id,client_id,org_id) REFERENCES inventory_order_lines(id,client_id,org_id),
 FOREIGN KEY(product_id,client_id,org_id) REFERENCES inventory_products(id,client_id,org_id),
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id),
 FOREIGN KEY(serial_id,client_id,org_id) REFERENCES inventory_units(id,client_id,org_id),
 FOREIGN KEY(location_id,org_id) REFERENCES inventory_locations(id,org_id)
);
CREATE INDEX inventory_order_parcels_order ON inventory_order_parcels(org_id,order_id,state);

CREATE TABLE inventory_movements (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, product_id TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity > 0), serial_id TEXT, from_location_id TEXT, to_location_id TEXT,
 from_status TEXT, to_status TEXT, from_custody_id TEXT, to_custody_id TEXT, order_id TEXT,
 parcel_id TEXT, action TEXT NOT NULL CHECK(action IN ('RECEIVE','MOVE','RESERVE','LOAD','DELIVER','RETURN','RELEASE','ADJUST')),
 reference TEXT, reason TEXT, actor_id TEXT NOT NULL, command_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
 FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id),
 FOREIGN KEY(product_id,client_id,org_id) REFERENCES inventory_products(id,client_id,org_id),
 FOREIGN KEY(serial_id,client_id,org_id) REFERENCES inventory_units(id,client_id,org_id),
 FOREIGN KEY(from_location_id,org_id) REFERENCES inventory_locations(id,org_id),
 FOREIGN KEY(to_location_id,org_id) REFERENCES inventory_locations(id,org_id),
 FOREIGN KEY(order_id,org_id) REFERENCES inventory_orders(id,org_id),
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id),
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX inventory_movements_client ON inventory_movements(org_id,client_id,created_at);
CREATE INDEX inventory_movements_product ON inventory_movements(org_id,product_id,created_at);

CREATE UNIQUE INDEX inventory_order_serial_active ON inventory_order_parcels(org_id,serial_id)
 WHERE serial_id IS NOT NULL AND state<>'RELEASED';

CREATE TABLE inventory_commands (
 org_id TEXT NOT NULL, actor_id TEXT NOT NULL, command_id TEXT NOT NULL, operation TEXT NOT NULL,
 body_hash TEXT NOT NULL, response TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(org_id,command_id), FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);




-- 005_customer_access.sql
CREATE TABLE customer_accounts (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL,
 name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)), created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(id,org_id), FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id)
);
CREATE TABLE customer_sessions (
 token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES customer_accounts(id), expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX customer_accounts_client_idx ON customer_accounts(org_id,client_id);
CREATE INDEX customer_sessions_account_idx ON customer_sessions(account_id);
CREATE INDEX customer_sessions_expiration_idx ON customer_sessions(expires_at);

-- 006_quad_operations.sql
CREATE TABLE quad_parcel_links (
 org_id TEXT NOT NULL, parcel_id TEXT NOT NULL, external_code TEXT NOT NULL,
 external_order_id TEXT, poi_id INTEGER NOT NULL CHECK(poi_id>0), delivery_date TEXT NOT NULL,
 payload TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('QUEUED','PROCESSING','EXPORTED','ERROR')),
 attempts INTEGER NOT NULL DEFAULT 0, lease_until TIMESTAMPTZ, error_code TEXT, updated_at TIMESTAMPTZ NOT NULL,
 provider_result TEXT NOT NULL DEFAULT 'PENDING' CHECK(provider_result IN('PENDING','DELIVERED','FAILED')),
 evidence_state TEXT NOT NULL DEFAULT 'PENDING' CHECK(evidence_state IN('PENDING','MISSING','COMPLETE')),
 reported_at TIMESTAMPTZ, receiver_name TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(org_id,parcel_id), UNIQUE(org_id,external_code), UNIQUE(org_id,external_order_id),
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id)
);
CREATE INDEX quad_parcel_queue_idx ON quad_parcel_links(org_id,state,lease_until);
CREATE TABLE quad_route_links (
 org_id TEXT NOT NULL, route_id TEXT NOT NULL, external_route_id TEXT NOT NULL,
 synced_at TIMESTAMPTZ, error_code TEXT, snapshot TEXT, PRIMARY KEY(org_id,route_id), UNIQUE(org_id,external_route_id),
 FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id)
);
CREATE TABLE quad_proofs (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, parcel_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('PHOTO','SIGNATURE')), evidence_id TEXT NOT NULL,
 source_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, UNIQUE(org_id,parcel_id,kind,source_hash),
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id), FOREIGN KEY(evidence_id,org_id) REFERENCES evidence(id,org_id)
);
CREATE INDEX quad_proofs_parcel_idx ON quad_proofs(org_id,parcel_id);
CREATE INDEX quad_proofs_evidence_idx ON quad_proofs(evidence_id);
CREATE TABLE quad_webhook_events (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), body_hash TEXT NOT NULL,
 event_type TEXT NOT NULL, external_code TEXT NOT NULL, payload TEXT NOT NULL,
 received_at TIMESTAMPTZ NOT NULL, processed_at TIMESTAMPTZ, state TEXT NOT NULL CHECK(state IN('PENDING','REPORTED','UNMATCHED')),
 UNIQUE(org_id,body_hash)
);
CREATE INDEX quad_webhooks_pending_idx ON quad_webhook_events(org_id,state);

ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_products FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON inventory_products TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_products FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON inventory_products FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON inventory_products FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON inventory_products FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_locations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON inventory_locations TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_locations FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON inventory_locations FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON inventory_locations FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON inventory_locations FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_balances FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON inventory_balances TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_balances FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON inventory_balances FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON inventory_balances FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON inventory_balances FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE inventory_units ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_units FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON inventory_units TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_units FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON inventory_units FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON inventory_units FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON inventory_units FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE inventory_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_orders FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON inventory_orders TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_orders FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON inventory_orders FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON inventory_orders FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON inventory_orders FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE inventory_order_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_order_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON inventory_order_lines TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_order_lines FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON inventory_order_lines FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON inventory_order_lines FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON inventory_order_lines FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE inventory_order_parcels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_order_parcels FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON inventory_order_parcels TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_order_parcels FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON inventory_order_parcels FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON inventory_order_parcels FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON inventory_order_parcels FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_movements FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON inventory_movements TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_movements FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON inventory_movements FOR INSERT TO nexora_runtime WITH CHECK (true);

ALTER TABLE inventory_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON inventory_commands TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_commands FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON inventory_commands FOR INSERT TO nexora_runtime WITH CHECK (true);

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_accounts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON customer_accounts TO nexora_runtime;
CREATE POLICY runtime_select ON customer_accounts FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON customer_accounts FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON customer_accounts FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON customer_accounts FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE customer_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON customer_sessions TO nexora_runtime;
CREATE POLICY runtime_select ON customer_sessions FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON customer_sessions FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON customer_sessions FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON customer_sessions FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE quad_parcel_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quad_parcel_links FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON quad_parcel_links TO nexora_runtime;
CREATE POLICY runtime_select ON quad_parcel_links FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON quad_parcel_links FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON quad_parcel_links FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON quad_parcel_links FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE quad_route_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quad_route_links FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON quad_route_links TO nexora_runtime;
CREATE POLICY runtime_select ON quad_route_links FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON quad_route_links FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON quad_route_links FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON quad_route_links FOR DELETE TO nexora_runtime USING (true);

ALTER TABLE quad_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quad_proofs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON quad_proofs TO nexora_runtime;
CREATE POLICY runtime_select ON quad_proofs FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON quad_proofs FOR INSERT TO nexora_runtime WITH CHECK (true);

ALTER TABLE quad_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quad_webhook_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON quad_webhook_events TO nexora_runtime;
CREATE POLICY runtime_select ON quad_webhook_events FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON quad_webhook_events FOR INSERT TO nexora_runtime WITH CHECK (true);
CREATE POLICY runtime_update ON quad_webhook_events FOR UPDATE TO nexora_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_delete ON quad_webhook_events FOR DELETE TO nexora_runtime USING (true);

INSERT INTO schema_migrations(version,applied_at) VALUES(4,now()),(5,now()),(6,now());
