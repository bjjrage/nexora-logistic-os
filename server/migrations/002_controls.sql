CREATE TABLE driver_documents (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,driver_id TEXT NOT NULL,name TEXT NOT NULL,
 expires_at TEXT NOT NULL,blocks_dispatch INTEGER NOT NULL CHECK(blocks_dispatch IN(0,1)),created_at TEXT NOT NULL,
 UNIQUE(id,org_id),FOREIGN KEY(driver_id,org_id) REFERENCES drivers(id,org_id)
);
CREATE TABLE driver_document_events (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,document_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 previous_expires_at TEXT,expires_at TEXT NOT NULL,command_id TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(document_id,org_id) REFERENCES driver_documents(id,org_id),FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE TABLE return_evidence (
 return_id TEXT NOT NULL,org_id TEXT NOT NULL,stage TEXT NOT NULL CHECK(stage IN('DEPOT','SENDER')),
 evidence_id TEXT NOT NULL,actor_id TEXT NOT NULL,recorded_at TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN('RECEIPT','CORRECTION','SENDER_HANDOVER')),note TEXT,
 PRIMARY KEY(return_id,stage),UNIQUE(return_id,evidence_id),
 FOREIGN KEY(return_id,org_id) REFERENCES returns(id,org_id),FOREIGN KEY(evidence_id,org_id) REFERENCES evidence(id,org_id),
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
