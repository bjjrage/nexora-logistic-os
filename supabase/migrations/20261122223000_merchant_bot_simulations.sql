SET LOCAL search_path TO nexora, pg_catalog;
CREATE TABLE customer_bot_simulations (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  order_json TEXT NOT NULL,
  stock_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version IN (1,2)),
  confirmation_id TEXT,
  request_id TEXT,
  PRIMARY KEY(org_id,id),
  UNIQUE(org_id,confirmation_id),
  CHECK((request_id IS NULL)=(confirmation_id IS NULL)),
  FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id),
  FOREIGN KEY(account_id,org_id) REFERENCES customer_accounts(id,org_id),
  FOREIGN KEY(org_id,request_id) REFERENCES customer_order_requests(org_id,id)
);
CREATE INDEX minios_bot_account ON customer_bot_simulations(org_id,client_id,account_id,observed_at DESC);

REVOKE ALL ON customer_bot_simulations FROM PUBLIC,anon,authenticated,service_role,nexora_tracking_worker,nexora_runtime;
ALTER TABLE customer_bot_simulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY minios_organization ON customer_bot_simulations TO nexora_runtime
 USING (org_id=current_setting('nexora.minios_org_id',true)) WITH CHECK (org_id=current_setting('nexora.minios_org_id',true));
GRANT SELECT,INSERT,UPDATE ON customer_bot_simulations TO nexora_runtime;
