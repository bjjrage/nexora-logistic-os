CREATE TABLE org_owners (
 org_id TEXT PRIMARY KEY REFERENCES organizations(id),
 user_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 FOREIGN KEY(user_id,org_id) REFERENCES users(id,org_id)
);
