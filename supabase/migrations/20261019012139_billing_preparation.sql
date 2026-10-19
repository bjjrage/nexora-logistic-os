SET LOCAL search_path TO nexora,pg_catalog;
CREATE TABLE billing_issuers (
 org_id TEXT PRIMARY KEY REFERENCES organizations(id), data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE billing_documents (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), client_id TEXT NOT NULL,
 reference TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('DRAFT','READY','VOID')),
 revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL, total BIGINT NOT NULL CHECK(total>0),
 created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, UNIQUE(id,org_id), UNIQUE(org_id,reference),
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

ALTER TABLE billing_issuers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_issuers FROM PUBLIC,anon,authenticated,nexora_tracking_worker;
GRANT SELECT,INSERT,UPDATE ON billing_issuers TO nexora_runtime;
CREATE POLICY runtime_access ON billing_issuers TO nexora_runtime USING (true) WITH CHECK (true);

ALTER TABLE billing_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_documents FROM PUBLIC,anon,authenticated,nexora_tracking_worker;
GRANT SELECT,INSERT,UPDATE ON billing_documents TO nexora_runtime;
CREATE POLICY runtime_access ON billing_documents TO nexora_runtime USING (true) WITH CHECK (true);

ALTER TABLE billing_shipment_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_shipment_links FROM PUBLIC,anon,authenticated,nexora_tracking_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON billing_shipment_links TO nexora_runtime;
CREATE POLICY runtime_access ON billing_shipment_links TO nexora_runtime USING (true) WITH CHECK (true);
INSERT INTO schema_migrations(version,applied_at) VALUES(15,now());
