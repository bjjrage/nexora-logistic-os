ALTER TABLE users ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1));
CREATE INDEX route_assignments_parcel_owner ON route_assignments(org_id,parcel_id);
