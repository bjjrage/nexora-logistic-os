CREATE TABLE quad_parcel_links (
 org_id TEXT NOT NULL, parcel_id TEXT NOT NULL, external_code TEXT NOT NULL,
 external_order_id TEXT, poi_id INTEGER NOT NULL CHECK(poi_id>0), delivery_date TEXT NOT NULL,
 payload TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('QUEUED','PROCESSING','EXPORTED','ERROR')),
 attempts INTEGER NOT NULL DEFAULT 0, lease_until TEXT, error_code TEXT, updated_at TEXT NOT NULL,
 provider_result TEXT NOT NULL DEFAULT 'PENDING' CHECK(provider_result IN('PENDING','DELIVERED','FAILED')),
 evidence_state TEXT NOT NULL DEFAULT 'PENDING' CHECK(evidence_state IN('PENDING','MISSING','COMPLETE')),
 reported_at TEXT, receiver_name TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(org_id,parcel_id), UNIQUE(org_id,external_code), UNIQUE(org_id,external_order_id),
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id)
);
CREATE INDEX quad_parcel_queue_idx ON quad_parcel_links(org_id,state,lease_until);
CREATE TABLE quad_route_links (
 org_id TEXT NOT NULL, route_id TEXT NOT NULL, external_route_id TEXT NOT NULL,
 synced_at TEXT, error_code TEXT, snapshot TEXT, PRIMARY KEY(org_id,route_id), UNIQUE(org_id,external_route_id),
 FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id)
);
CREATE TABLE quad_proofs (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, parcel_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('PHOTO','SIGNATURE')), evidence_id TEXT NOT NULL,
 source_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(org_id,parcel_id,kind,source_hash),
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id), FOREIGN KEY(evidence_id,org_id) REFERENCES evidence(id,org_id)
);
CREATE INDEX quad_proofs_parcel_idx ON quad_proofs(org_id,parcel_id);
CREATE INDEX quad_proofs_evidence_idx ON quad_proofs(evidence_id);
CREATE TABLE quad_webhook_events (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), body_hash TEXT NOT NULL,
 event_type TEXT NOT NULL, external_code TEXT NOT NULL, payload TEXT NOT NULL,
 received_at TEXT NOT NULL, processed_at TEXT, state TEXT NOT NULL CHECK(state IN('PENDING','REPORTED','UNMATCHED')),
 UNIQUE(org_id,body_hash)
);
CREATE INDEX quad_webhooks_pending_idx ON quad_webhook_events(org_id,state);
