CREATE TABLE organization_test_mode (org_id TEXT PRIMARY KEY REFERENCES organizations(id), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)));
CREATE TABLE test_delivery_proofs (org_id TEXT NOT NULL, parcel_id TEXT NOT NULL, command_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(org_id,parcel_id,command_id));
