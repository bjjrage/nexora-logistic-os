SET search_path TO nexora, pg_catalog;
CREATE TABLE inventory_import_runs (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, actor_id TEXT NOT NULL, command_id TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('CSV','JSON')),
 body_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('IMPORTED','REJECTED')),
 row_count INTEGER NOT NULL CHECK(row_count >= 0), accepted_count INTEGER NOT NULL CHECK(accepted_count >= 0),
 errors TEXT NOT NULL DEFAULT '[]', result TEXT, created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(org_id,command_id),
 FOREIGN KEY(org_id) REFERENCES organizations(id),
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE INDEX inventory_import_runs_history ON inventory_import_runs(org_id,created_at DESC,id);
ALTER TABLE inventory_import_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inventory_import_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON inventory_import_runs TO nexora_runtime;
CREATE POLICY runtime_select ON inventory_import_runs FOR SELECT TO nexora_runtime USING (true);
CREATE POLICY runtime_insert ON inventory_import_runs FOR INSERT TO nexora_runtime WITH CHECK (true);
INSERT INTO schema_migrations(version,applied_at) VALUES(7,now());

