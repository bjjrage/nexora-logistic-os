CREATE TABLE password_recovery (
 token_hash TEXT PRIMARY KEY,org_id TEXT NOT NULL,user_id TEXT,account_id TEXT,
 expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL,
 CHECK((user_id IS NULL) <> (account_id IS NULL)),
 FOREIGN KEY(org_id) REFERENCES organizations(id),
 FOREIGN KEY(user_id,org_id) REFERENCES users(id,org_id),
 FOREIGN KEY(account_id,org_id) REFERENCES customer_accounts(id,org_id)
);
CREATE INDEX password_recovery_expiration ON password_recovery(expires_at);
