SET LOCAL search_path TO nexora,pg_catalog;
CREATE TABLE inventory_receipt_batches (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 command_id TEXT NOT NULL, body_hash TEXT NOT NULL, content_hash TEXT NOT NULL,
 reference TEXT NOT NULL, reference_key TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('XLSX','CSV','MANUAL')), filename TEXT,
 status TEXT NOT NULL CHECK(status IN ('IMPORTED','REJECTED')),
 row_count INTEGER NOT NULL CHECK(row_count>=0), product_count INTEGER NOT NULL CHECK(product_count>=0),
 unit_count INTEGER NOT NULL CHECK(unit_count>=0), result TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(org_id,command_id),
 FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id),
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE UNIQUE INDEX inventory_receipt_reference ON inventory_receipt_batches(org_id,client_id,reference_key) WHERE status='IMPORTED';
CREATE INDEX inventory_receipt_content ON inventory_receipt_batches(org_id,client_id,content_hash,status);
CREATE INDEX inventory_receipt_history ON inventory_receipt_batches(org_id,created_at DESC,id);
ALTER TABLE inventory_receipt_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_receipt_batches FROM PUBLIC,anon,authenticated,nexora_tracking_worker,nexora_runtime;
GRANT SELECT,INSERT ON inventory_receipt_batches TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_receipt_batches FOR SELECT TO nexora_runtime USING(true);
CREATE POLICY runtime_insert ON inventory_receipt_batches FOR INSERT TO nexora_runtime WITH CHECK(true);
INSERT INTO schema_migrations(version,applied_at) VALUES(17,now());
