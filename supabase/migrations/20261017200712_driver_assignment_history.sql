SET search_path TO nexora, pg_catalog;
CREATE INDEX route_assignments_parcel_owner ON route_assignments(org_id,parcel_id,_sequence);
