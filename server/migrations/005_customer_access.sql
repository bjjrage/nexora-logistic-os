CREATE TABLE customer_accounts (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL,
 name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)), created_at TEXT NOT NULL,
 UNIQUE(id,org_id), FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id)
);
CREATE TABLE customer_sessions (
 token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES customer_accounts(id), expires_at TEXT NOT NULL
);
CREATE INDEX customer_accounts_client_idx ON customer_accounts(org_id,client_id);
CREATE INDEX customer_sessions_account_idx ON customer_sessions(account_id);
CREATE INDEX customer_sessions_expiration_idx ON customer_sessions(expires_at);
