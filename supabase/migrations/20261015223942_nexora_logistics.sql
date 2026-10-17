-- Nexora OS: private PostgreSQL schema; accessible only through the trusted API server.
CREATE SCHEMA IF NOT EXISTS nexora;
REVOKE ALL ON SCHEMA nexora FROM PUBLIC, anon, authenticated;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nexora_runtime') THEN
  CREATE ROLE nexora_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
END $$;
SET LOCAL search_path TO nexora, pg_catalog, extensions;
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE drivers (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
 available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)), UNIQUE(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE users (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), username TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ADMIN','OPERATIONS','DEPOT','DRIVER')),
 driver_id TEXT, UNIQUE(id,org_id), FOREIGN KEY(driver_id,org_id) REFERENCES drivers(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE clients (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL, UNIQUE(id,org_id),
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE shipments (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, reference TEXT NOT NULL,
 origin_text TEXT NOT NULL,destination_text TEXT NOT NULL,recipient_name TEXT NOT NULL,recipient_phone TEXT NOT NULL,
 proof_policy TEXT NOT NULL CHECK(proof_policy IN ('RECEIVER','RECEIVER_PHOTO')),created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(org_id,client_id,reference),UNIQUE(id,org_id),FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE parcels (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,shipment_id TEXT NOT NULL,code TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('EXPECTED','RECEIVED','LOADED','IN_TRANSIT','DELIVERED','RETURN_PENDING','RETURNED_TO_DEPOT','RETURNED_TO_SENDER')),
 custody_type TEXT NOT NULL CHECK(custody_type IN ('SENDER','DEPOT','VEHICLE','RECIPIENT')),
 custody_id TEXT NOT NULL,weight_grams INTEGER CHECK(weight_grams > 0),volume_cm3 INTEGER CHECK(volume_cm3 > 0),
 UNIQUE(id,org_id),FOREIGN KEY(shipment_id,org_id) REFERENCES shipments(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE vehicles (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),plate TEXT NOT NULL,
 capacity_weight_grams INTEGER NOT NULL CHECK(capacity_weight_grams>0),capacity_volume_cm3 INTEGER NOT NULL CHECK(capacity_volume_cm3>0),
 odometer INTEGER NOT NULL CHECK(odometer>=0),available INTEGER NOT NULL DEFAULT 1 CHECK(available IN(0,1)),
 UNIQUE(org_id,plate),UNIQUE(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE routes (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),name TEXT NOT NULL,driver_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,
 start_at TIMESTAMPTZ NOT NULL,end_at TIMESTAMPTZ NOT NULL CHECK(end_at>start_at),
 state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','READY','IN_PROGRESS','OPERATIONALLY_CLOSED')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),UNIQUE(id,org_id),
 FOREIGN KEY(driver_id,org_id) REFERENCES drivers(id,org_id),FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);


CREATE TABLE stops (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,route_id TEXT NOT NULL,shipment_id TEXT NOT NULL,sequence INTEGER NOT NULL,
 kind TEXT NOT NULL DEFAULT 'DELIVERY' CHECK(kind IN('PICKUP','DELIVERY')),state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','PARTIAL','COMPLETED','FAILED')),
 UNIQUE(id,org_id),UNIQUE(route_id,shipment_id,kind),UNIQUE(route_id,sequence),
 FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id),FOREIGN KEY(shipment_id,org_id) REFERENCES shipments(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE route_assignments (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,route_id TEXT NOT NULL,parcel_id TEXT NOT NULL,
 pickup INTEGER NOT NULL DEFAULT 0 CHECK(pickup IN(0,1)),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 UNIQUE(route_id,parcel_id),FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id),FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_assignment ON route_assignments(parcel_id) WHERE active=1;
CREATE TABLE receipts (id TEXT PRIMARY KEY,org_id TEXT NOT NULL,shipment_id TEXT NOT NULL,location TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,FOREIGN KEY(shipment_id,org_id) REFERENCES shipments(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id),
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE receipt_items (receipt_id TEXT NOT NULL REFERENCES receipts(id),parcel_id TEXT NOT NULL REFERENCES parcels(id),PRIMARY KEY(receipt_id,parcel_id),
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE custody_events (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,parcel_id TEXT NOT NULL,actor_id TEXT NOT NULL,from_type TEXT NOT NULL,from_id TEXT NOT NULL,
 to_type TEXT NOT NULL,to_id TEXT NOT NULL,action TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,command_id TEXT NOT NULL,
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE evidence (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,parcel_id TEXT,actor_id TEXT NOT NULL,filename TEXT NOT NULL,mime_type TEXT NOT NULL,
 data BYTEA NOT NULL,sha256 TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,UNIQUE(id,org_id),
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE attempts (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,stop_id TEXT NOT NULL,actor_id TEXT NOT NULL,receiver_name TEXT NOT NULL,
 reason_code TEXT NOT NULL,next_action TEXT NOT NULL,evidence_ids TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,
 FOREIGN KEY(stop_id,org_id) REFERENCES stops(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE attempt_items (attempt_id TEXT NOT NULL REFERENCES attempts(id),parcel_id TEXT NOT NULL REFERENCES parcels(id),result TEXT NOT NULL CHECK(result IN('DELIVERED','FAILED')),PRIMARY KEY(attempt_id,parcel_id),
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE incidents (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,parcel_id TEXT NOT NULL,route_id TEXT NOT NULL,reason_code TEXT NOT NULL,next_action TEXT NOT NULL,
 owner_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','RETURN_AUTHORIZED','RESOLVED')),
 UNIQUE(id,org_id),FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id),FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id),FOREIGN KEY(owner_id,org_id) REFERENCES users(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE returns (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,parcel_id TEXT NOT NULL,route_id TEXT NOT NULL,incident_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'AUTHORIZED' CHECK(state IN('AUTHORIZED','AT_DEPOT','SENT_TO_SENDER')),
 depot_receipt_id TEXT, sender_evidence_id TEXT,receiver_name TEXT,
 UNIQUE(id,org_id),FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id),FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id),
 FOREIGN KEY(incident_id,org_id) REFERENCES incidents(id,org_id),FOREIGN KEY(sender_evidence_id,org_id) REFERENCES evidence(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_return ON returns(parcel_id) WHERE state<>'SENT_TO_SENDER';
CREATE TABLE inspections (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,odometer INTEGER NOT NULL CHECK(odometer>=0),fuel_percent INTEGER NOT NULL CHECK(fuel_percent BETWEEN 0 AND 100),
 items TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE defects (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,inspection_id TEXT NOT NULL REFERENCES inspections(id),severity TEXT NOT NULL CHECK(severity IN('MINOR','CRITICAL')),
 note TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','RESOLVED')),resolution_note TEXT,evidence_id TEXT,
 UNIQUE(id,org_id),FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id),FOREIGN KEY(evidence_id,org_id) REFERENCES evidence(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE vehicle_documents (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,name TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,blocks_dispatch INTEGER NOT NULL CHECK(blocks_dispatch IN(0,1)),
 FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE audit (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT NOT NULL,command_id TEXT NOT NULL,details TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE idempotency (
 org_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,operation TEXT NOT NULL,body_hash TEXT NOT NULL,response TEXT NOT NULL,
 PRIMARY KEY(org_id,command_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE maintenance (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,description TEXT NOT NULL,due_at TIMESTAMPTZ,due_odometer INTEGER CHECK(due_odometer>=0),
 state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','COMPLETED')),completion_note TEXT,evidence_id TEXT,
 CHECK(due_at IS NOT NULL OR due_odometer IS NOT NULL),FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id),FOREIGN KEY(evidence_id,org_id) REFERENCES evidence(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);

CREATE TABLE driver_documents (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,driver_id TEXT NOT NULL,name TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,blocks_dispatch INTEGER NOT NULL CHECK(blocks_dispatch IN(0,1)),created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(id,org_id),FOREIGN KEY(driver_id,org_id) REFERENCES drivers(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE driver_document_events (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,document_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 previous_expires_at TIMESTAMPTZ,expires_at TIMESTAMPTZ NOT NULL,command_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,
 FOREIGN KEY(document_id,org_id) REFERENCES driver_documents(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE return_evidence (
 return_id TEXT NOT NULL,org_id TEXT NOT NULL,stage TEXT NOT NULL CHECK(stage IN('DEPOT','SENDER')),
 evidence_id TEXT NOT NULL,actor_id TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL,
 source TEXT NOT NULL CHECK(source IN('RECEIPT','CORRECTION','SENDER_HANDOVER')),note TEXT,
 PRIMARY KEY(return_id,stage),UNIQUE(return_id,evidence_id),
 FOREIGN KEY(return_id,org_id) REFERENCES returns(id,org_id),FOREIGN KEY(evidence_id,org_id) REFERENCES evidence(id,org_id),
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);

CREATE TABLE vehicle_tracking_bindings (
 org_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, external_vehicle_id TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(org_id,vehicle_id), UNIQUE(org_id,external_vehicle_id),
 FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE vehicle_tracking_latest (
 org_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, external_vehicle_id TEXT NOT NULL,
 latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 measured_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(org_id,vehicle_id),
 FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id)
,
 _sequence BIGINT GENERATED ALWAYS AS IDENTITY
);

ALTER TABLE routes ADD CONSTRAINT routes_driver_window EXCLUDE USING gist
 (org_id WITH =, driver_id WITH =,
 (CASE WHEN state='IN_PROGRESS' THEN tstzrange(NULL,NULL,'()') ELSE tstzrange(start_at,end_at,'[)') END) WITH &&)
 WHERE (state IN ('READY','IN_PROGRESS'));
ALTER TABLE routes ADD CONSTRAINT routes_vehicle_window EXCLUDE USING gist
 (org_id WITH =, vehicle_id WITH =,
 (CASE WHEN state='IN_PROGRESS' THEN tstzrange(NULL,NULL,'()') ELSE tstzrange(start_at,end_at,'[)') END) WITH &&)
 WHERE (state IN ('READY','IN_PROGRESS'));
INSERT INTO schema_migrations(version,applied_at) VALUES(1,now()),(2,now()),(3,now());
GRANT USAGE ON SCHEMA nexora TO nexora_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA nexora TO nexora_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA nexora TO nexora_runtime;
REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM nexora_runtime;
REVOKE UPDATE,DELETE ON audit,custody_events,driver_document_events,idempotency FROM nexora_runtime;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON schema_migrations FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON schema_migrations FROM PUBLIC,anon,authenticated;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON organizations FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON organizations FROM PUBLIC,anon,authenticated;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON drivers FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON drivers FROM PUBLIC,anon,authenticated;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON users FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON users FROM PUBLIC,anon,authenticated;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON sessions FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON sessions FROM PUBLIC,anon,authenticated;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON clients FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON clients FROM PUBLIC,anon,authenticated;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON shipments FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON shipments FROM PUBLIC,anon,authenticated;
ALTER TABLE parcels ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON parcels FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON parcels FROM PUBLIC,anon,authenticated;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON vehicles FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON vehicles FROM PUBLIC,anon,authenticated;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON routes FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON routes FROM PUBLIC,anon,authenticated;
ALTER TABLE stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON stops FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON stops FROM PUBLIC,anon,authenticated;
ALTER TABLE route_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON route_assignments FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON route_assignments FROM PUBLIC,anon,authenticated;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON receipts FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON receipts FROM PUBLIC,anon,authenticated;
ALTER TABLE receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON receipt_items FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON receipt_items FROM PUBLIC,anon,authenticated;
ALTER TABLE custody_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON custody_events FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON custody_events FROM PUBLIC,anon,authenticated;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON evidence FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON evidence FROM PUBLIC,anon,authenticated;
ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON attempts FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON attempts FROM PUBLIC,anon,authenticated;
ALTER TABLE attempt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON attempt_items FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON attempt_items FROM PUBLIC,anon,authenticated;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON incidents FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON incidents FROM PUBLIC,anon,authenticated;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON returns FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON returns FROM PUBLIC,anon,authenticated;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON inspections FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON inspections FROM PUBLIC,anon,authenticated;
ALTER TABLE defects ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON defects FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON defects FROM PUBLIC,anon,authenticated;
ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON vehicle_documents FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON vehicle_documents FROM PUBLIC,anon,authenticated;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON audit FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON audit FROM PUBLIC,anon,authenticated;
ALTER TABLE idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON idempotency FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON idempotency FROM PUBLIC,anon,authenticated;
ALTER TABLE maintenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON maintenance FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON maintenance FROM PUBLIC,anon,authenticated;
ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON driver_documents FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON driver_documents FROM PUBLIC,anon,authenticated;
ALTER TABLE driver_document_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON driver_document_events FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON driver_document_events FROM PUBLIC,anon,authenticated;
ALTER TABLE return_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON return_evidence FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON return_evidence FROM PUBLIC,anon,authenticated;
ALTER TABLE vehicle_tracking_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON vehicle_tracking_bindings FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON vehicle_tracking_bindings FROM PUBLIC,anon,authenticated;
ALTER TABLE vehicle_tracking_latest ENABLE ROW LEVEL SECURITY;
CREATE POLICY runtime_access ON vehicle_tracking_latest FOR ALL TO nexora_runtime USING (true) WITH CHECK (true);
REVOKE ALL ON vehicle_tracking_latest FROM PUBLIC,anon,authenticated;
CREATE INDEX drivers_org_idx ON drivers(org_id);
CREATE INDEX users_org_idx ON users(org_id);
CREATE INDEX clients_org_idx ON clients(org_id);
CREATE INDEX shipments_org_idx ON shipments(org_id);
CREATE INDEX parcels_org_idx ON parcels(org_id);
CREATE INDEX vehicles_org_idx ON vehicles(org_id);
CREATE INDEX routes_org_idx ON routes(org_id);
CREATE INDEX stops_org_idx ON stops(org_id);
CREATE INDEX route_assignments_org_idx ON route_assignments(org_id);
CREATE INDEX receipts_org_idx ON receipts(org_id);
CREATE INDEX custody_events_org_idx ON custody_events(org_id);
CREATE INDEX evidence_org_idx ON evidence(org_id);
CREATE INDEX attempts_org_idx ON attempts(org_id);
CREATE INDEX incidents_org_idx ON incidents(org_id);
CREATE INDEX returns_org_idx ON returns(org_id);
CREATE INDEX inspections_org_idx ON inspections(org_id);
CREATE INDEX defects_org_idx ON defects(org_id);
CREATE INDEX vehicle_documents_org_idx ON vehicle_documents(org_id);
CREATE INDEX audit_org_idx ON audit(org_id);
CREATE INDEX idempotency_org_idx ON idempotency(org_id);
CREATE INDEX maintenance_org_idx ON maintenance(org_id);
CREATE INDEX driver_documents_org_idx ON driver_documents(org_id);
CREATE INDEX driver_document_events_org_idx ON driver_document_events(org_id);
CREATE INDEX return_evidence_org_idx ON return_evidence(org_id);
CREATE INDEX vehicle_tracking_bindings_org_idx ON vehicle_tracking_bindings(org_id);
CREATE INDEX vehicle_tracking_latest_org_idx ON vehicle_tracking_latest(org_id);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiration_idx ON sessions(expires_at);
CREATE INDEX parcels_shipment_idx ON parcels(shipment_id);
CREATE INDEX routes_driver_idx ON routes(driver_id);
CREATE INDEX routes_vehicle_idx ON routes(vehicle_id);
CREATE INDEX route_assignments_route_idx ON route_assignments(route_id);
CREATE INDEX stops_shipment_idx ON stops(shipment_id);
CREATE INDEX custody_events_parcel_idx ON custody_events(parcel_id);
CREATE INDEX vehicle_documents_vehicle_idx ON vehicle_documents(vehicle_id);
CREATE INDEX driver_documents_driver_idx ON driver_documents(driver_id);
CREATE INDEX maintenance_vehicle_idx ON maintenance(vehicle_id);
CREATE INDEX inspections_vehicle_idx ON inspections(vehicle_id);
CREATE INDEX defects_vehicle_idx ON defects(vehicle_id);
CREATE INDEX evidence_parcel_idx ON evidence(parcel_id);
CREATE INDEX attempts_stop_idx ON attempts(stop_id);
CREATE INDEX return_evidence_evidence_idx ON return_evidence(evidence_id);
CREATE INDEX driver_document_events_document_idx ON driver_document_events(document_id);
