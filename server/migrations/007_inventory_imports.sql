CREATE TABLE inventory_import_runs (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, actor_id TEXT NOT NULL, command_id TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('CSV','JSON')),
 body_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('IMPORTED','REJECTED')),
 row_count INTEGER NOT NULL CHECK(row_count >= 0), accepted_count INTEGER NOT NULL CHECK(accepted_count >= 0),
 errors TEXT NOT NULL DEFAULT '[]', result TEXT, created_at TEXT NOT NULL,
 UNIQUE(org_id,command_id),
 FOREIGN KEY(org_id) REFERENCES organizations(id),
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX inventory_import_runs_history ON inventory_import_runs(org_id,created_at DESC,id);
