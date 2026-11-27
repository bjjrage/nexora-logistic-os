SET LOCAL search_path TO nexora,pg_catalog;

CREATE TABLE procurement_parties (
 org_id TEXT NOT NULL REFERENCES organizations(id),
 id TEXT NOT NULL,
 name TEXT NOT NULL,
 ruc TEXT,
 contact TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('SUPPLIER','BENEFICIARY')),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(org_id,id)
);
CREATE UNIQUE INDEX procurement_parties_ruc ON procurement_parties(org_id,ruc) WHERE ruc IS NOT NULL;
CREATE INDEX procurement_parties_name ON procurement_parties(org_id,name,id);

CREATE TABLE procurement_categories (
 org_id TEXT NOT NULL REFERENCES organizations(id),
 id TEXT NOT NULL,
 name TEXT NOT NULL,
 PRIMARY KEY(org_id,id)
);
CREATE UNIQUE INDEX procurement_categories_name ON procurement_categories(org_id,lower(name));

CREATE TABLE procurement_centers (
 org_id TEXT NOT NULL REFERENCES organizations(id),
 id TEXT NOT NULL,
 name TEXT NOT NULL,
 PRIMARY KEY(org_id,id)
);
CREATE UNIQUE INDEX procurement_centers_name ON procurement_centers(org_id,lower(name));

CREATE TABLE procurement_accounts (
 org_id TEXT NOT NULL REFERENCES organizations(id),
 id TEXT NOT NULL,
 name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('CASH','BANK')),
 PRIMARY KEY(org_id,id)
);
CREATE UNIQUE INDEX procurement_accounts_name ON procurement_accounts(org_id,lower(name));

CREATE TABLE procurement_import_batches (
 org_id TEXT NOT NULL REFERENCES organizations(id),
 id TEXT NOT NULL,
 filename TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 sheet TEXT NOT NULL,
 source_key TEXT NOT NULL,
 original_file BYTEA NOT NULL,
 summary_json TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(org_id,id),
 UNIQUE(org_id,sha256)
);
CREATE INDEX procurement_import_source ON procurement_import_batches(org_id,source_key);

CREATE TABLE procurement_import_rows (
 org_id TEXT NOT NULL,
 id TEXT NOT NULL,
 batch_id TEXT NOT NULL,
 row_number INTEGER NOT NULL CHECK(row_number>0),
 original_json TEXT NOT NULL,
 normalized_json TEXT NOT NULL,
 issues_json TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 match_key TEXT,
 receipt_key TEXT,
 prior_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('PENDING','PROMOTED','SKIPPED')),
 outcome_json TEXT,
 resolution_reason TEXT,
 resolved_by TEXT,
 resolved_at TEXT,
 PRIMARY KEY(org_id,id),
 UNIQUE(org_id,batch_id,row_number),
 FOREIGN KEY(org_id,batch_id) REFERENCES procurement_import_batches(org_id,id)
);
CREATE INDEX procurement_import_fingerprint ON procurement_import_rows(org_id,fingerprint);
CREATE INDEX procurement_import_match ON procurement_import_rows(org_id,match_key);
CREATE INDEX procurement_import_receipt ON procurement_import_rows(org_id,receipt_key);

CREATE TABLE procurement_documents (
 org_id TEXT NOT NULL,
 id TEXT NOT NULL,
 party_id TEXT NOT NULL,
 nature TEXT NOT NULL CHECK(nature IN ('EXPENSE','PURCHASE','ASSET','REMUNERATION')),
 category_id TEXT,
 center_id TEXT,
 document_date TEXT NOT NULL,
 due_date TEXT NOT NULL CHECK(due_date>=document_date),
 condition TEXT NOT NULL CHECK(condition IN ('CASH','CREDIT')),
 reference TEXT,
 description TEXT NOT NULL,
 total_pyg BIGINT NOT NULL CHECK(total_pyg>0),
 vat_pyg BIGINT NOT NULL CHECK(vat_pyg>=0),
 net_pyg BIGINT NOT NULL CHECK(net_pyg>=0 AND net_pyg+vat_pyg=total_pyg),
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 voided_at TEXT,
 import_row_id TEXT,
 PRIMARY KEY(org_id,id),
 UNIQUE(org_id,id,party_id),
 UNIQUE(org_id,import_row_id),
 FOREIGN KEY(org_id,party_id) REFERENCES procurement_parties(org_id,id),
 FOREIGN KEY(org_id,category_id) REFERENCES procurement_categories(org_id,id),
 FOREIGN KEY(org_id,center_id) REFERENCES procurement_centers(org_id,id),
 FOREIGN KEY(org_id,import_row_id) REFERENCES procurement_import_rows(org_id,id)
);
CREATE INDEX procurement_docs_date ON procurement_documents(org_id,document_date,id);
CREATE INDEX procurement_docs_party ON procurement_documents(org_id,party_id,document_date,id);
CREATE INDEX procurement_docs_due ON procurement_documents(org_id,due_date,id) WHERE voided_at IS NULL;
CREATE INDEX procurement_docs_budget ON procurement_documents(org_id,category_id,document_date);

CREATE TABLE procurement_lines (
 org_id TEXT NOT NULL,
 id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position>0),
 description TEXT NOT NULL,
 total_pyg BIGINT NOT NULL CHECK(total_pyg>0),
 vat_rate INTEGER NOT NULL CHECK(vat_rate BETWEEN 0 AND 100),
 vat_pyg BIGINT NOT NULL CHECK(vat_pyg>=0 AND (vat_rate>0 OR vat_pyg=0)),
 net_pyg BIGINT NOT NULL CHECK(net_pyg>=0 AND net_pyg+vat_pyg=total_pyg),
 PRIMARY KEY(org_id,id),
 UNIQUE(org_id,document_id,position),
 FOREIGN KEY(org_id,document_id) REFERENCES procurement_documents(org_id,id)
);

CREATE TABLE procurement_settlements (
 org_id TEXT NOT NULL,
 id TEXT NOT NULL,
 party_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('PAYMENT','ADVANCE','CREDIT')),
 amount_pyg BIGINT NOT NULL CHECK(amount_pyg>0),
 event_date TEXT NOT NULL,
 account_id TEXT,
 method TEXT,
 reference TEXT,
 description TEXT,
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 reversed_at TEXT,
 import_row_id TEXT,
 vat_rate INTEGER CHECK(vat_rate BETWEEN 0 AND 100),
 vat_pyg BIGINT CHECK(vat_pyg>=0),
 net_pyg BIGINT CHECK(net_pyg>=0),
 CHECK((kind='CREDIT' AND account_id IS NULL AND method IS NULL) OR
       (kind<>'CREDIT' AND account_id IS NOT NULL AND method IS NOT NULL
        AND vat_rate IS NULL AND vat_pyg IS NULL AND net_pyg IS NULL)),
 CHECK((vat_rate IS NULL AND vat_pyg IS NULL AND net_pyg IS NULL) OR
       (vat_rate IS NOT NULL AND vat_pyg IS NOT NULL AND net_pyg IS NOT NULL
        AND (vat_rate>0 OR vat_pyg=0) AND net_pyg+vat_pyg=amount_pyg)),
 PRIMARY KEY(org_id,id),
 UNIQUE(org_id,id,party_id),
 UNIQUE(org_id,import_row_id),
 FOREIGN KEY(org_id,party_id) REFERENCES procurement_parties(org_id,id),
 FOREIGN KEY(org_id,account_id) REFERENCES procurement_accounts(org_id,id),
 FOREIGN KEY(org_id,import_row_id) REFERENCES procurement_import_rows(org_id,id)
);
CREATE INDEX procurement_settlements_date ON procurement_settlements(org_id,event_date,id);
CREATE INDEX procurement_settlements_party ON procurement_settlements(org_id,party_id,event_date,id);

CREATE TABLE procurement_applications (
 org_id TEXT NOT NULL,
 id TEXT NOT NULL,
 party_id TEXT NOT NULL,
 settlement_id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 amount_pyg BIGINT NOT NULL CHECK(amount_pyg>0),
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 reversed_at TEXT,
 PRIMARY KEY(org_id,id),
 FOREIGN KEY(org_id,settlement_id,party_id) REFERENCES procurement_settlements(org_id,id,party_id),
 FOREIGN KEY(org_id,document_id,party_id) REFERENCES procurement_documents(org_id,id,party_id)
);
CREATE INDEX procurement_applications_settlement ON procurement_applications(org_id,settlement_id,id);
CREATE INDEX procurement_applications_document ON procurement_applications(org_id,document_id,id);

CREATE TABLE procurement_movements (
 org_id TEXT NOT NULL,
 id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('OPENING','ENTRY','EXIT','TRANSFER','REVERSAL')),
 amount_pyg BIGINT NOT NULL,
 event_date TEXT NOT NULL,
 reference TEXT NOT NULL,
 settlement_id TEXT,
 transfer_id TEXT,
 reversal_of TEXT,
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 CHECK((kind='OPENING') OR (kind='ENTRY' AND amount_pyg>0) OR
       (kind='EXIT' AND amount_pyg<0) OR (kind='TRANSFER' AND amount_pyg<>0) OR kind='REVERSAL'),
 CHECK((kind='REVERSAL')=(reversal_of IS NOT NULL)),
 CHECK((kind='TRANSFER')=(transfer_id IS NOT NULL)),
 PRIMARY KEY(org_id,id),
 UNIQUE(org_id,reversal_of),
 FOREIGN KEY(org_id,account_id) REFERENCES procurement_accounts(org_id,id),
 FOREIGN KEY(org_id,settlement_id) REFERENCES procurement_settlements(org_id,id),
 FOREIGN KEY(org_id,reversal_of) REFERENCES procurement_movements(org_id,id)
);
CREATE INDEX procurement_movements_account ON procurement_movements(org_id,account_id,event_date,id);
CREATE INDEX procurement_movements_transfer ON procurement_movements(org_id,transfer_id);
CREATE UNIQUE INDEX procurement_movements_settlement ON procurement_movements(org_id,settlement_id) WHERE kind='EXIT' AND settlement_id IS NOT NULL;

CREATE TABLE procurement_budgets (
 org_id TEXT NOT NULL,
 category_id TEXT NOT NULL,
 month TEXT NOT NULL,
 amount_pyg BIGINT CHECK(amount_pyg>=0),
 PRIMARY KEY(org_id,category_id,month),
 FOREIGN KEY(org_id,category_id) REFERENCES procurement_categories(org_id,id)
);

CREATE TABLE procurement_events (
 org_id TEXT NOT NULL REFERENCES organizations(id),
 id TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 action TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 reason TEXT,
 created_at TEXT NOT NULL,
 PRIMARY KEY(org_id,id)
);
CREATE INDEX procurement_events_subject ON procurement_events(org_id,subject_id,created_at,id);

CREATE TABLE procurement_attachments (
 org_id TEXT NOT NULL,
 id TEXT NOT NULL,
 document_id TEXT,
 settlement_id TEXT,
 filename TEXT NOT NULL,
 mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
 data BYTEA NOT NULL,
 sha256 TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880),
 actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 CHECK((document_id IS NULL)<>(settlement_id IS NULL)),
 PRIMARY KEY(org_id,id),
 UNIQUE(org_id,document_id,sha256),
 UNIQUE(org_id,settlement_id,sha256),
 FOREIGN KEY(org_id,document_id) REFERENCES procurement_documents(org_id,id),
 FOREIGN KEY(org_id,settlement_id) REFERENCES procurement_settlements(org_id,id)
);

-- These tables are behind the authenticated OS server, outside the Data API.
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['procurement_parties','procurement_categories','procurement_centers','procurement_accounts','procurement_import_batches','procurement_import_rows','procurement_documents','procurement_lines','procurement_settlements','procurement_applications','procurement_movements','procurement_budgets','procurement_events','procurement_attachments'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,anon,authenticated,nexora_tracking_worker,service_role',table_name);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO nexora_runtime',table_name);
  IF table_name IN ('procurement_parties','procurement_documents','procurement_settlements','procurement_applications','procurement_budgets','procurement_import_rows') THEN
   EXECUTE format('GRANT UPDATE ON %I TO nexora_runtime',table_name);
  END IF;
  EXECUTE format('CREATE POLICY procurement_runtime ON %I TO nexora_runtime USING (true) WITH CHECK (true)',table_name);
 END LOOP;
END;
$$;

INSERT INTO schema_migrations(version,applied_at) VALUES(29,now());
