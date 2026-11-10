SET LOCAL search_path TO nexora, pg_catalog;

ALTER TABLE clients ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE routes ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1));

CREATE VIEW client_history WITH (security_invoker=true) AS
 SELECT c.org_id,c.id AS client_id
 FROM clients c
 WHERE EXISTS (SELECT 1 FROM billing_documents h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM inventory_orders h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM shipments h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM inventory_movements h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM inventory_receipt_batches h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM inventory_units h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM inventory_balances h WHERE h.org_id=c.org_id AND h.client_id=c.id AND h.quantity>0)
    OR EXISTS (SELECT 1 FROM public.portal_companies p JOIN public.portal_shipping_requests r ON r.company_id=p.id WHERE p.os_org_id=c.org_id AND p.os_client_id=c.id);
REVOKE ALL ON client_history FROM PUBLIC, anon, authenticated, service_role, nexora_tracking_worker;
GRANT SELECT ON client_history TO nexora_runtime;

CREATE FUNCTION protect_client_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, nexora, pg_temp AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM client_history h WHERE h.org_id=OLD.org_id AND h.client_id=OLD.id) THEN
  RAISE EXCEPTION 'CLIENT_HAS_HISTORY' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER client_history_no_delete BEFORE DELETE ON clients
 FOR EACH ROW EXECUTE FUNCTION protect_client_history();

CREATE FUNCTION require_active_client_for_new_work() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, nexora, pg_temp AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM clients c WHERE c.org_id=NEW.org_id AND c.id=NEW.client_id AND c.archived_at IS NOT NULL) THEN
  RAISE EXCEPTION 'CLIENT_ARCHIVED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_orders_active_client BEFORE INSERT ON inventory_orders
 FOR EACH ROW EXECUTE FUNCTION require_active_client_for_new_work();
CREATE TRIGGER shipments_active_client BEFORE INSERT ON shipments
 FOR EACH ROW EXECUTE FUNCTION require_active_client_for_new_work();
CREATE TRIGGER inventory_products_active_client BEFORE INSERT ON inventory_products
 FOR EACH ROW EXECUTE FUNCTION require_active_client_for_new_work();
CREATE TRIGGER inventory_receipt_batches_active_client BEFORE INSERT ON inventory_receipt_batches
 FOR EACH ROW EXECUTE FUNCTION require_active_client_for_new_work();
CREATE TRIGGER customer_accounts_active_client BEFORE INSERT ON customer_accounts
 FOR EACH ROW EXECUTE FUNCTION require_active_client_for_new_work();
CREATE TRIGGER inventory_receiving_active_client BEFORE INSERT ON inventory_movements
 FOR EACH ROW WHEN (NEW.action='RECEIVE') EXECUTE FUNCTION require_active_client_for_new_work();

CREATE FUNCTION require_test_route_for_delivery_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, nexora, pg_temp AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM route_assignments a
  JOIN routes r ON r.org_id=a.org_id AND r.id=a.route_id
  JOIN organization_test_mode m ON m.org_id=a.org_id AND m.enabled=1
  WHERE a.org_id=NEW.org_id AND a.parcel_id=NEW.parcel_id AND a.active=1 AND r.is_test=1 AND r.state='IN_PROGRESS'
 ) THEN
  RAISE EXCEPTION 'TEST_PROOF_REQUIRES_TEST_ROUTE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER test_delivery_proofs_test_route BEFORE INSERT ON test_delivery_proofs
 FOR EACH ROW EXECUTE FUNCTION require_test_route_for_delivery_proof();

CREATE FUNCTION protect_departed_route_test_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF OLD.is_test<>NEW.is_test AND OLD.state NOT IN ('DRAFT','READY') THEN
  RAISE EXCEPTION 'TEST_ROUTE_ALREADY_DEPARTED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER route_test_status_before_departure BEFORE UPDATE OF is_test ON routes
 FOR EACH ROW EXECUTE FUNCTION protect_departed_route_test_status();

-- Old application processes get a safe denial until they use authenticated proof.
CREATE OR REPLACE FUNCTION purge_client(p_org text,p_client text,p_actor text,p_name text) RETURNS text
LANGUAGE sql SET search_path = pg_catalog AS $$ SELECT 'FORBIDDEN'::text; $$;

CREATE FUNCTION purge_client(p_org text,p_client text,p_actor text,p_name text,p_session text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, nexora, pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('nexora-commands:nexora'));
 IF p_session IS NULL OR p_session !~ '^[0-9a-f]{64}$' OR NOT EXISTS (
  SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
  WHERE s.token_hash=encode(sha256(convert_to(p_session,'UTF8')),'hex') AND s.expires_at>now()
    AND u.org_id=p_org AND u.id=p_actor AND u.enabled=1 AND u.role='ADMIN'
 ) THEN
  RETURN 'FORBIDDEN';
 END IF;
 PERFORM 1 FROM clients WHERE org_id=p_org AND id=p_client AND name=p_name FOR UPDATE;
 IF NOT FOUND THEN RETURN 'CLIENT_CHANGED'; END IF;
 IF EXISTS (SELECT 1 FROM client_history WHERE org_id=p_org AND client_id=p_client) THEN
  RETURN 'CLIENT_HAS_HISTORY';
 END IF;

 DELETE FROM public.portal_memberships
  WHERE company_id IN (SELECT id FROM public.portal_companies WHERE os_org_id=p_org AND os_client_id=p_client);
 DELETE FROM public.individual_customers WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM public.portal_companies WHERE os_org_id=p_org AND os_client_id=p_client;
 DELETE FROM customer_sessions WHERE account_id IN (SELECT id FROM customer_accounts WHERE org_id=p_org AND client_id=p_client);
 DELETE FROM password_recovery WHERE org_id=p_org AND account_id IN (SELECT id FROM customer_accounts WHERE org_id=p_org AND client_id=p_client);
 DELETE FROM customer_accounts WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM client_delivery_locks WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM client_delivery_policies WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM routing_plans WHERE org_id=p_org AND strpos(input,'"'||p_client||'"')>0;
 DELETE FROM inventory_balances WHERE org_id=p_org AND client_id=p_client AND quantity=0;
 DELETE FROM inventory_products WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM clients WHERE org_id=p_org AND id=p_client;
 RETURN 'DELETED';
END;
$$;
REVOKE ALL ON FUNCTION purge_client(text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, nexora_tracking_worker;
GRANT EXECUTE ON FUNCTION purge_client(text,text,text,text,text) TO nexora_runtime;

CREATE OR REPLACE FUNCTION reject_return_dispositions_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'RETURN_DISPOSITION_APPEND_ONLY' USING ERRCODE='55000';
END;
$$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM client_purge_scope) THEN RAISE EXCEPTION 'CLIENT_PURGE_SCOPE_NOT_EMPTY'; END IF;
END $$;
DROP TABLE client_purge_scope;
INSERT INTO schema_migrations(version,applied_at) VALUES(23,now());
