CREATE TABLE traccar_devices (
 device_id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
 unique_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(device_id,org_id)
);
CREATE TABLE traccar_vehicle_bindings (
 org_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, device_id TEXT NOT NULL UNIQUE,
 revision TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(org_id,vehicle_id),
 FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id),
 FOREIGN KEY(device_id,org_id) REFERENCES traccar_devices(device_id,org_id)
);
CREATE TABLE traccar_latest (
 org_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, device_id TEXT NOT NULL, revision TEXT NOT NULL,
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy REAL CHECK(accuracy>=0), measured_at TEXT NOT NULL, received_at TEXT NOT NULL,
 PRIMARY KEY(org_id,vehicle_id), FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id)
);
CREATE TABLE route_tracking_settings (
 org_id TEXT NOT NULL, route_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN('QUADMINDS','TRACCAR')),
 updated_at TEXT NOT NULL, PRIMARY KEY(org_id,route_id), FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id)
);
CREATE TABLE client_delivery_policies (
 org_id TEXT NOT NULL, client_id TEXT NOT NULL, delivery_provider TEXT NOT NULL CHECK(delivery_provider IN('QUADMINDS','NEXORA')),
 updated_at TEXT NOT NULL, PRIMARY KEY(org_id,client_id), FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id)
);
CREATE TABLE tracking_source_state (
 source TEXT PRIMARY KEY CHECK(source='TRACCAR'), connected INTEGER NOT NULL CHECK(connected IN(0,1)),
 checked_at TEXT NOT NULL
);
