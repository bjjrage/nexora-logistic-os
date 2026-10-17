PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drivers (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
 available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)), UNIQUE(id,org_id)
);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), username TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ADMIN','OPERATIONS','DEPOT','DRIVER')),
 driver_id TEXT, UNIQUE(id,org_id), FOREIGN KEY(driver_id,org_id) REFERENCES drivers(id,org_id)
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL, UNIQUE(id,org_id));
CREATE TABLE IF NOT EXISTS shipments (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, client_id TEXT NOT NULL, reference TEXT NOT NULL,
 origin_text TEXT NOT NULL,destination_text TEXT NOT NULL,recipient_name TEXT NOT NULL,recipient_phone TEXT NOT NULL,
 proof_policy TEXT NOT NULL CHECK(proof_policy IN ('RECEIVER','RECEIVER_PHOTO')),created_at TEXT NOT NULL,
 UNIQUE(org_id,client_id,reference),UNIQUE(id,org_id),FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id)
);
CREATE TABLE IF NOT EXISTS parcels (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,shipment_id TEXT NOT NULL,code TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('EXPECTED','RECEIVED','LOADED','IN_TRANSIT','DELIVERED','RETURN_PENDING','RETURNED_TO_DEPOT','RETURNED_TO_SENDER')),
 custody_type TEXT NOT NULL CHECK(custody_type IN ('SENDER','DEPOT','VEHICLE','RECIPIENT')),
 custody_id TEXT NOT NULL,weight_grams INTEGER CHECK(weight_grams > 0),volume_cm3 INTEGER CHECK(volume_cm3 > 0),
 UNIQUE(id,org_id),FOREIGN KEY(shipment_id,org_id) REFERENCES shipments(id,org_id)
);
CREATE TABLE IF NOT EXISTS vehicles (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),plate TEXT NOT NULL,
 capacity_weight_grams INTEGER NOT NULL CHECK(capacity_weight_grams>0),capacity_volume_cm3 INTEGER NOT NULL CHECK(capacity_volume_cm3>0),
 odometer INTEGER NOT NULL CHECK(odometer>=0),available INTEGER NOT NULL DEFAULT 1 CHECK(available IN(0,1)),
 UNIQUE(org_id,plate),UNIQUE(id,org_id)
);
CREATE TABLE IF NOT EXISTS routes (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),name TEXT NOT NULL,driver_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,
 start_at TEXT NOT NULL,end_at TEXT NOT NULL CHECK(end_at>start_at),
 state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN('DRAFT','READY','IN_PROGRESS','OPERATIONALLY_CLOSED')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),UNIQUE(id,org_id),
 FOREIGN KEY(driver_id,org_id) REFERENCES drivers(id,org_id),FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id)
);
CREATE TRIGGER IF NOT EXISTS route_overlap_insert BEFORE INSERT ON routes
 WHEN NEW.state IN ('READY','IN_PROGRESS') AND EXISTS(SELECT 1 FROM routes r WHERE r.org_id=NEW.org_id AND r.state IN('READY','IN_PROGRESS') AND (r.driver_id=NEW.driver_id OR r.vehicle_id=NEW.vehicle_id) AND (r.state='IN_PROGRESS' OR NEW.state='IN_PROGRESS' OR (r.start_at<NEW.end_at AND r.end_at>NEW.start_at)))
 BEGIN SELECT RAISE(ABORT,'ROUTE_RESOURCE_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS route_overlap_update BEFORE UPDATE ON routes
 WHEN NEW.state IN ('READY','IN_PROGRESS') AND EXISTS(SELECT 1 FROM routes r WHERE r.id<>NEW.id AND r.org_id=NEW.org_id AND r.state IN('READY','IN_PROGRESS') AND (r.driver_id=NEW.driver_id OR r.vehicle_id=NEW.vehicle_id) AND (r.state='IN_PROGRESS' OR NEW.state='IN_PROGRESS' OR (r.start_at<NEW.end_at AND r.end_at>NEW.start_at)))
 BEGIN SELECT RAISE(ABORT,'ROUTE_RESOURCE_CONFLICT'); END;
CREATE TABLE IF NOT EXISTS stops (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,route_id TEXT NOT NULL,shipment_id TEXT NOT NULL,sequence INTEGER NOT NULL,
 kind TEXT NOT NULL DEFAULT 'DELIVERY' CHECK(kind IN('PICKUP','DELIVERY')),state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','PARTIAL','COMPLETED','FAILED')),
 UNIQUE(id,org_id),UNIQUE(route_id,shipment_id,kind),UNIQUE(route_id,sequence),
 FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id),FOREIGN KEY(shipment_id,org_id) REFERENCES shipments(id,org_id)
);
CREATE TABLE IF NOT EXISTS route_assignments (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,route_id TEXT NOT NULL,parcel_id TEXT NOT NULL,
 pickup INTEGER NOT NULL DEFAULT 0 CHECK(pickup IN(0,1)),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 UNIQUE(route_id,parcel_id),FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id),FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_assignment ON route_assignments(parcel_id) WHERE active=1;
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY,org_id TEXT NOT NULL,shipment_id TEXT NOT NULL,location TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(shipment_id,org_id) REFERENCES shipments(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id));
CREATE TABLE IF NOT EXISTS receipt_items (receipt_id TEXT NOT NULL REFERENCES receipts(id),parcel_id TEXT NOT NULL REFERENCES parcels(id),PRIMARY KEY(receipt_id,parcel_id));
CREATE TABLE IF NOT EXISTS custody_events (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,parcel_id TEXT NOT NULL,actor_id TEXT NOT NULL,from_type TEXT NOT NULL,from_id TEXT NOT NULL,
 to_type TEXT NOT NULL,to_id TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL,command_id TEXT NOT NULL,
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE TABLE IF NOT EXISTS evidence (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,parcel_id TEXT,actor_id TEXT NOT NULL,filename TEXT NOT NULL,mime_type TEXT NOT NULL,
 data BLOB NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(id,org_id),
 FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE TABLE IF NOT EXISTS attempts (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,stop_id TEXT NOT NULL,actor_id TEXT NOT NULL,receiver_name TEXT NOT NULL,
 reason_code TEXT NOT NULL,next_action TEXT NOT NULL,evidence_ids TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(stop_id,org_id) REFERENCES stops(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE TABLE IF NOT EXISTS attempt_items (attempt_id TEXT NOT NULL REFERENCES attempts(id),parcel_id TEXT NOT NULL REFERENCES parcels(id),result TEXT NOT NULL CHECK(result IN('DELIVERED','FAILED')),PRIMARY KEY(attempt_id,parcel_id));
CREATE TABLE IF NOT EXISTS incidents (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,parcel_id TEXT NOT NULL,route_id TEXT NOT NULL,reason_code TEXT NOT NULL,next_action TEXT NOT NULL,
 owner_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','RETURN_AUTHORIZED','RESOLVED')),
 UNIQUE(id,org_id),FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id),FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id),FOREIGN KEY(owner_id,org_id) REFERENCES users(id,org_id)
);
CREATE TABLE IF NOT EXISTS returns (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,parcel_id TEXT NOT NULL,route_id TEXT NOT NULL,incident_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'AUTHORIZED' CHECK(state IN('AUTHORIZED','AT_DEPOT','SENT_TO_SENDER')),
 depot_receipt_id TEXT, sender_evidence_id TEXT,receiver_name TEXT,
 UNIQUE(id,org_id),FOREIGN KEY(parcel_id,org_id) REFERENCES parcels(id,org_id),FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id),
 FOREIGN KEY(incident_id,org_id) REFERENCES incidents(id,org_id),FOREIGN KEY(sender_evidence_id,org_id) REFERENCES evidence(id,org_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_return ON returns(parcel_id) WHERE state<>'SENT_TO_SENDER';
CREATE TABLE IF NOT EXISTS inspections (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,odometer INTEGER NOT NULL CHECK(odometer>=0),fuel_percent INTEGER NOT NULL CHECK(fuel_percent BETWEEN 0 AND 100),
 items TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE TABLE IF NOT EXISTS defects (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,inspection_id TEXT NOT NULL REFERENCES inspections(id),severity TEXT NOT NULL CHECK(severity IN('MINOR','CRITICAL')),
 note TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','RESOLVED')),resolution_note TEXT,evidence_id TEXT,
 UNIQUE(id,org_id),FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id),FOREIGN KEY(evidence_id,org_id) REFERENCES evidence(id,org_id)
);
CREATE TABLE IF NOT EXISTS vehicle_documents (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,name TEXT NOT NULL,expires_at TEXT NOT NULL,blocks_dispatch INTEGER NOT NULL CHECK(blocks_dispatch IN(0,1)),
 FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id)
);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT NOT NULL,command_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE TABLE IF NOT EXISTS idempotency (
 org_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,operation TEXT NOT NULL,body_hash TEXT NOT NULL,response TEXT NOT NULL,
 PRIMARY KEY(org_id,command_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE TABLE IF NOT EXISTS maintenance (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,description TEXT NOT NULL,due_at TEXT,due_odometer INTEGER CHECK(due_odometer>=0),
 state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','COMPLETED')),completion_note TEXT,evidence_id TEXT,
 CHECK(due_at IS NOT NULL OR due_odometer IS NOT NULL),FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id),FOREIGN KEY(evidence_id,org_id) REFERENCES evidence(id,org_id)
);
