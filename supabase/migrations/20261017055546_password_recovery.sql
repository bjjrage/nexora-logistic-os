SET LOCAL search_path TO nexora,pg_catalog;
CREATE TABLE password_recovery (
 token_hash TEXT PRIMARY KEY,org_id TEXT NOT NULL,user_id TEXT,account_id TEXT,
 expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,
 CHECK((user_id IS NULL) <> (account_id IS NULL)),
 FOREIGN KEY(org_id) REFERENCES organizations(id),
 FOREIGN KEY(user_id,org_id) REFERENCES users(id,org_id),
 FOREIGN KEY(account_id,org_id) REFERENCES customer_accounts(id,org_id),
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX password_recovery_expiration ON password_recovery(expires_at);
ALTER TABLE password_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON password_recovery FROM PUBLIC,anon,authenticated,nexora_tracking_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON password_recovery TO nexora_runtime;
GRANT USAGE,SELECT ON SEQUENCE password_recovery__sequence_seq TO nexora_runtime;
CREATE POLICY runtime_access ON password_recovery FOR ALL TO nexora_runtime USING(true) WITH CHECK(true);
INSERT INTO schema_migrations(version,applied_at) VALUES(11,now());
