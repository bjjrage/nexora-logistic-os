-- Convert the existing legacy exception once. Runtime rules never infer identity from a name.
SET LOCAL search_path TO nexora,pg_catalog;
DO $$
BEGIN
 IF EXISTS (SELECT org_id FROM clients WHERE lower(trim(name))='universo' GROUP BY org_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Ambiguous Universo identity: review client IDs before migration';
 END IF;
 IF EXISTS (SELECT 1 FROM clients c JOIN client_delivery_policies p ON p.org_id=c.org_id AND p.client_id=c.id WHERE lower(trim(c.name))='universo' AND p.delivery_provider<>'QUADMINDS') THEN
  RAISE EXCEPTION 'Conflicting Universo policy: review before migration';
 END IF;
END $$;
INSERT INTO client_delivery_policies(org_id,client_id,delivery_provider,updated_at)
SELECT org_id,id,'QUADMINDS',now() FROM clients WHERE lower(trim(name))='universo'
ON CONFLICT(org_id,client_id) DO NOTHING;
CREATE UNIQUE INDEX client_delivery_policy_identity ON client_delivery_policies(org_id,client_id,delivery_provider);
CREATE TABLE client_delivery_locks (
 org_id TEXT NOT NULL, client_id TEXT NOT NULL,
 delivery_provider TEXT NOT NULL CHECK(delivery_provider IN('QUADMINDS','NEXORA')),
 PRIMARY KEY(org_id,client_id),
 FOREIGN KEY(org_id,client_id,delivery_provider) REFERENCES client_delivery_policies(org_id,client_id,delivery_provider)
);
INSERT INTO client_delivery_locks(org_id,client_id,delivery_provider)
SELECT org_id,id,'QUADMINDS' FROM clients WHERE lower(trim(name))='universo';
ALTER TABLE client_delivery_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON client_delivery_locks FROM PUBLIC,anon,authenticated,nexora_tracking_worker;
GRANT SELECT ON client_delivery_locks TO nexora_runtime;
CREATE POLICY runtime_select ON client_delivery_locks FOR SELECT TO nexora_runtime USING(true);
INSERT INTO schema_migrations(version,applied_at) VALUES(10,now());
