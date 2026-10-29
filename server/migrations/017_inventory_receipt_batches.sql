CREATE TABLE inventory_receipt_batches (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 command_id TEXT NOT NULL, body_hash TEXT NOT NULL, content_hash TEXT NOT NULL,
 reference TEXT NOT NULL, reference_key TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('XLSX','CSV','MANUAL')), filename TEXT,
 status TEXT NOT NULL CHECK(status IN ('IMPORTED','REJECTED')),
 row_count INTEGER NOT NULL CHECK(row_count>=0), product_count INTEGER NOT NULL CHECK(product_count>=0),
 unit_count INTEGER NOT NULL CHECK(unit_count>=0), result TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(org_id,command_id),
 FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id),
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE UNIQUE INDEX inventory_receipt_reference ON inventory_receipt_batches(org_id,client_id,reference_key) WHERE status='IMPORTED';
CREATE INDEX inventory_receipt_content ON inventory_receipt_batches(org_id,client_id,content_hash,status);
CREATE INDEX inventory_receipt_history ON inventory_receipt_batches(org_id,created_at DESC,id);
CREATE TRIGGER inventory_receipt_batches_no_update BEFORE UPDATE ON inventory_receipt_batches
 BEGIN SELECT RAISE(ABORT,'INVENTORY_RECEIPTS_APPEND_ONLY'); END;
CREATE TRIGGER inventory_receipt_batches_no_delete BEFORE DELETE ON inventory_receipt_batches
 BEGIN SELECT RAISE(ABORT,'INVENTORY_RECEIPTS_APPEND_ONLY'); END;
