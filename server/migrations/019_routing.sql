CREATE TABLE routing_points (
 org_id TEXT NOT NULL REFERENCES organizations(id), entity_kind TEXT NOT NULL CHECK(entity_kind IN('ORDER','LOCATION')),
 entity_id TEXT NOT NULL, address TEXT NOT NULL, latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180), updated_at TEXT NOT NULL,
 PRIMARY KEY(org_id,entity_kind,entity_id)
);
CREATE TABLE routing_plans (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), actor_id TEXT NOT NULL,
 input TEXT NOT NULL, snapshot_hash TEXT NOT NULL, proposal TEXT NOT NULL,
 created_at TEXT NOT NULL, applied_at TEXT, result TEXT,
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX routing_plans_org_created ON routing_plans(org_id,created_at);
