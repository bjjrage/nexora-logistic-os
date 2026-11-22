SET LOCAL search_path TO nexora, pg_catalog;
-- N-03 · Transacciones comerciales del cliente: jamás modifica stock ni custodia.
CREATE TABLE customer_order_requests (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'MINIOS' CHECK (source_kind='MINIOS'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  rejection_reason TEXT NOT NULL DEFAULT '',
  order_id TEXT,
  PRIMARY KEY (org_id,id),
  UNIQUE (org_id,client_id,external_id),
  FOREIGN KEY (client_id,org_id) REFERENCES clients(id,org_id),
  FOREIGN KEY (account_id,org_id) REFERENCES customer_accounts(id,org_id),
  FOREIGN KEY (decided_by,org_id) REFERENCES users(id,org_id),
  FOREIGN KEY (order_id,org_id) REFERENCES inventory_orders(id,org_id)
);
CREATE INDEX minios_requests_client ON customer_order_requests(org_id,client_id,created_at DESC,id);
CREATE INDEX minios_requests_queue ON customer_order_requests(org_id,status,created_at DESC,id);

-- La tabla es accesible solo al backend; se exige tenant del request verificado.
REVOKE ALL ON customer_order_requests
 FROM PUBLIC, anon, authenticated, service_role, nexora_tracking_worker, nexora_runtime;
ALTER TABLE customer_order_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY minios_organization ON customer_order_requests TO nexora_runtime
 USING (org_id=current_setting('nexora.minios_org_id',true))
 WITH CHECK (org_id=current_setting('nexora.minios_org_id',true));
GRANT SELECT,INSERT,UPDATE ON customer_order_requests TO nexora_runtime;
