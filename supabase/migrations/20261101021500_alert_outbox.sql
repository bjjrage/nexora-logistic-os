SET search_path TO nexora, pg_catalog;

CREATE TABLE alert_outbox (
 id TEXT PRIMARY KEY,
 event TEXT NOT NULL CHECK(event IN ('server.error','server.fatal','inventory.mismatch')),
 request_id TEXT,
 payload JSONB NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 created_at TIMESTAMPTZ NOT NULL,
 next_attempt_at TIMESTAMPTZ NOT NULL,
 lease_until TIMESTAMPTZ,
 delivered_at TIMESTAMPTZ,
 failed_at TIMESTAMPTZ,
 last_status INTEGER,
 last_error_type TEXT,
 CHECK(delivered_at IS NULL OR failed_at IS NULL)
);
CREATE INDEX alert_outbox_due ON alert_outbox(delivered_at,failed_at,next_attempt_at,lease_until,created_at);
ALTER TABLE alert_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_alert_outbox ON alert_outbox FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON alert_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON alert_outbox TO nexora_runtime;
INSERT INTO schema_migrations(version,applied_at) VALUES(22,now());
