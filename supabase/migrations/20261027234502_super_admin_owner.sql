SET LOCAL search_path TO nexora,pg_catalog;
CREATE TABLE org_owners (
 org_id TEXT PRIMARY KEY REFERENCES organizations(id),
 user_id TEXT NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL,
 FOREIGN KEY(user_id,org_id) REFERENCES users(id,org_id)
);
ALTER TABLE org_owners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_owners FROM PUBLIC,anon,authenticated,nexora_tracking_worker,nexora_runtime;
GRANT SELECT ON org_owners TO nexora_runtime;
CREATE POLICY runtime_select ON org_owners FOR SELECT TO nexora_runtime USING(true);
INSERT INTO schema_migrations(version,applied_at) VALUES(16,now());
