CREATE TABLE inventory_products (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL,
 sku TEXT NOT NULL, barcode TEXT, name TEXT NOT NULL,
 tracking TEXT NOT NULL CHECK(tracking IN ('QUANTITY','SERIAL')),
 unit TEXT NOT NULL DEFAULT 'unit', weight_grams INTEGER CHECK(weight_grams > 0),
 volume_cm3 INTEGER CHECK(volume_cm3 > 0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,org_id), UNIQUE(id,client_id,org_id), UNIQUE(org_id,client_id,sku),
 FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id)
);
CREATE UNIQUE INDEX inventory_products_barcode ON inventory_products(org_id,client_id,barcode) WHERE barcode IS NOT NULL;

CREATE TABLE inventory_locations (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'STORAGE' CHECK(kind IN ('DEPOT','STORAGE','QUARANTINE')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL,
 UNIQUE(id,org_id), UNIQUE(org_id,code), FOREIGN KEY(org_id) REFERENCES organizations(id)
);

CREATE TABLE inventory_balances (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, product_id TEXT NOT NULL,
 location_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('AVAILABLE','RESERVED','VEHICLE','QUARANTINE')),
 custody_id TEXT NOT NULL DEFAULT '', order_id TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL CHECK(quantity >= 0), updated_at TEXT NOT NULL,
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
 custody_id TEXT NOT NULL DEFAULT '', order_id TEXT NOT NULL DEFAULT '', parcel_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
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
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
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
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
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
 reference TEXT, reason TEXT, actor_id TEXT NOT NULL, command_id TEXT NOT NULL, created_at TEXT NOT NULL,
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
 body_hash TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(org_id,command_id), FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);

CREATE TRIGGER inventory_movements_no_update BEFORE UPDATE ON inventory_movements
 BEGIN SELECT RAISE(ABORT,'INVENTORY_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER inventory_movements_no_delete BEFORE DELETE ON inventory_movements
 BEGIN SELECT RAISE(ABORT,'INVENTORY_LEDGER_APPEND_ONLY'); END;
