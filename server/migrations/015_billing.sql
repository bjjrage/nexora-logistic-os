CREATE TABLE billing_issuers (
 org_id TEXT PRIMARY KEY REFERENCES organizations(id), data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL
);
CREATE TABLE billing_documents (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), client_id TEXT NOT NULL,
 reference TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('DRAFT','READY','VOID')),
 revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, total INTEGER NOT NULL CHECK(total>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,org_id), UNIQUE(org_id,reference),
 FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id)
);
CREATE INDEX billing_documents_listing ON billing_documents(org_id,created_at DESC,id);
CREATE TABLE billing_shipment_links (
 org_id TEXT NOT NULL, document_id TEXT NOT NULL, shipment_id TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN(0,1)),
 PRIMARY KEY(org_id,document_id,shipment_id),
 FOREIGN KEY(document_id,org_id) REFERENCES billing_documents(id,org_id),
 FOREIGN KEY(shipment_id,org_id) REFERENCES shipments(id,org_id)
);
CREATE UNIQUE INDEX billing_shipment_once ON billing_shipment_links(org_id,shipment_id) WHERE active=1;
