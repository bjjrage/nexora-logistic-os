CREATE TABLE vehicle_tracking_bindings (
 org_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, external_vehicle_id TEXT NOT NULL,
 updated_at TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(org_id,vehicle_id), UNIQUE(org_id,external_vehicle_id),
 FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id)
);
CREATE TABLE vehicle_tracking_latest (
 org_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, external_vehicle_id TEXT NOT NULL,
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 measured_at TEXT NOT NULL, received_at TEXT NOT NULL,
 PRIMARY KEY(org_id,vehicle_id),
 FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id)
);
