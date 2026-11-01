CREATE TABLE alert_outbox (
 id TEXT PRIMARY KEY, event TEXT NOT NULL CHECK(event IN ('server.error','server.fatal','inventory.mismatch')),
 request_id TEXT, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 created_at TEXT NOT NULL, next_attempt_at TEXT NOT NULL, lease_until TEXT,
 delivered_at TEXT, failed_at TEXT, last_status INTEGER, last_error_type TEXT,
 CHECK(delivered_at IS NULL OR failed_at IS NULL)
);
CREATE INDEX alert_outbox_due ON alert_outbox(delivered_at,failed_at,next_attempt_at,lease_until,created_at);
