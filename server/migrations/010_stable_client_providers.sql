-- One-time conversion of the legacy name exception to an immutable client identity.
-- Refuse ambiguous or contradictory legacy data rather than guessing a client.
CREATE TEMP TABLE provider_migration_guard (valid INTEGER CHECK(valid=1));
INSERT INTO provider_migration_guard
SELECT CASE WHEN
 EXISTS (SELECT org_id FROM clients WHERE lower(trim(name))='universo' GROUP BY org_id HAVING count(*)>1)
 OR EXISTS (SELECT 1 FROM clients c JOIN client_delivery_policies p ON p.org_id=c.org_id AND p.client_id=c.id WHERE lower(trim(c.name))='universo' AND p.delivery_provider<>'QUADMINDS')
 THEN 0 ELSE 1 END;
DROP TABLE provider_migration_guard;
INSERT INTO client_delivery_policies(org_id,client_id,delivery_provider,updated_at)
SELECT org_id,id,'QUADMINDS',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM clients WHERE lower(trim(name))='universo'
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
