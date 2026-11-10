SET search_path TO nexora, pg_catalog;

-- The scope table is private to the owner of the narrowly scoped deletion function.
CREATE TABLE client_purge_scope (
 org_id TEXT NOT NULL, client_id TEXT NOT NULL,
 PRIMARY KEY(org_id,client_id)
);
ALTER TABLE client_purge_scope ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON client_purge_scope FROM PUBLIC, anon, authenticated, service_role, nexora_runtime, nexora_tracking_worker;

CREATE OR REPLACE FUNCTION reject_return_dispositions_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS (
   SELECT 1 FROM nexora.client_purge_scope scope
   JOIN nexora.shipments s ON s.org_id=scope.org_id AND s.client_id=scope.client_id
   JOIN nexora.parcels p ON p.org_id=s.org_id AND p.shipment_id=s.id
   JOIN nexora.returns r ON r.org_id=p.org_id AND r.parcel_id=p.id
   WHERE r.org_id=OLD.org_id AND r.id=OLD.return_id
  ) THEN
   RETURN OLD;
  END IF;
 END IF;
 RAISE EXCEPTION 'RETURN_DISPOSITION_APPEND_ONLY' USING ERRCODE='55000';
END;
$$;

-- Historical ledgers and the public portal remain inaccessible to ordinary runtime deletes.
-- The function's input, actor check, and dependency predicates limit this exception to one client.
CREATE FUNCTION purge_client(p_org text,p_client text,p_actor text,p_name text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, nexora, pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('nexora-commands:nexora'));
 IF NOT EXISTS (SELECT 1 FROM users WHERE org_id=p_org AND id=p_actor AND enabled=1 AND role='ADMIN') THEN
  RETURN 'FORBIDDEN';
 END IF;
 PERFORM 1 FROM clients WHERE org_id=p_org AND id=p_client AND name=p_name FOR UPDATE;
 IF NOT FOUND THEN RETURN 'CLIENT_CHANGED'; END IF;
 IF EXISTS (
  SELECT 1 FROM shipments s JOIN parcels p ON p.org_id=s.org_id AND p.shipment_id=s.id
  WHERE s.org_id=p_org AND s.client_id=p_client AND (
   p.custody_type='VEHICLE' OR p.state IN ('LOADED','IN_TRANSIT','RETURN_PENDING') OR EXISTS (
    SELECT 1 FROM route_assignments a JOIN routes r ON r.org_id=a.org_id AND r.id=a.route_id
    WHERE a.org_id=s.org_id AND a.parcel_id=p.id AND a.active=1 AND r.state='IN_PROGRESS'
   )
  )
 ) OR EXISTS (
  SELECT 1 FROM shipments s JOIN stops t ON t.org_id=s.org_id AND t.shipment_id=s.id
  JOIN routes r ON r.org_id=t.org_id AND r.id=t.route_id
  WHERE s.org_id=p_org AND s.client_id=p_client AND r.state='IN_PROGRESS' AND t.state IN ('PENDING','PARTIAL')
 ) OR EXISTS (
  SELECT 1 FROM inventory_balances b WHERE b.org_id=p_org AND b.client_id=p_client AND b.status='VEHICLE' AND b.quantity>0
 ) OR EXISTS (
  SELECT 1 FROM inventory_units u WHERE u.org_id=p_org AND u.client_id=p_client AND u.status='VEHICLE'
 ) THEN
  RETURN 'IN_TRANSIT';
 END IF;

 INSERT INTO client_purge_scope VALUES(p_org,p_client);

 -- Remove portal records for this client while preserving the identity provider's shared account.
 DELETE FROM public.portal_shipping_requests
 WHERE company_id IN (SELECT id FROM public.portal_companies WHERE os_org_id=p_org AND os_client_id=p_client)
 OR shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client);
 DELETE FROM public.portal_memberships
 WHERE company_id IN (SELECT id FROM public.portal_companies WHERE os_org_id=p_org AND os_client_id=p_client);
 DELETE FROM public.individual_customers WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM public.portal_companies WHERE os_org_id=p_org AND os_client_id=p_client;

 -- Retain mixed import receipts for the other customers, with this client's lines removed.
 DELETE FROM inventory_import_runs
 WHERE org_id=p_org AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(result::jsonb->'orders') entry WHERE entry->>'clientId'=p_client
 ) AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(result::jsonb->'orders') entry WHERE entry->>'clientId' IS DISTINCT FROM p_client
 );
 UPDATE inventory_import_runs
 SET result=(
  SELECT jsonb_build_object('imported',count(*),'orders',jsonb_agg(entry ORDER BY position))::text
   FROM jsonb_array_elements(result::jsonb->'orders')
   WITH ORDINALITY AS entries(entry,position) WHERE entry->>'clientId' IS DISTINCT FROM p_client
 ), accepted_count=accepted_count-(
  SELECT count(*)::int FROM jsonb_array_elements(result::jsonb->'orders') entry WHERE entry->>'clientId'=p_client
 )
 WHERE org_id=p_org AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(result::jsonb->'orders') entry WHERE entry->>'clientId'=p_client
 );

 DELETE FROM customer_sessions WHERE account_id IN (SELECT id FROM customer_accounts WHERE org_id=p_org AND client_id=p_client);
 DELETE FROM password_recovery WHERE org_id=p_org AND account_id IN (SELECT id FROM customer_accounts WHERE org_id=p_org AND client_id=p_client);
 DELETE FROM customer_accounts WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM billing_shipment_links WHERE org_id=p_org AND (document_id IN (SELECT id FROM billing_documents WHERE org_id=p_org AND client_id=p_client) OR shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM billing_documents WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM client_delivery_locks WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM client_delivery_policies WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM inventory_receipt_batches WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM routing_points WHERE org_id=p_org AND entity_kind='ORDER' AND entity_id IN (SELECT id FROM inventory_orders WHERE org_id=p_org AND client_id=p_client);
 DELETE FROM routing_plans WHERE org_id=p_org AND (strpos(input, '"'||p_client||'"')>0 OR EXISTS(
   SELECT 1 FROM inventory_orders io WHERE io.org_id=p_org AND io.client_id=p_client
    AND (strpos(routing_plans.input, '"'||io.id||'"')>0 OR strpos(routing_plans.proposal, '"'||io.id||'"')>0)));
 DELETE FROM inventory_movements WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM inventory_order_parcels WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM inventory_order_lines WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM inventory_units WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM inventory_balances WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM inventory_orders WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM inventory_products WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM quad_webhook_events WHERE org_id=p_org AND external_code IN (SELECT external_code FROM quad_parcel_links WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client)));
 DELETE FROM quad_proofs WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM quad_parcel_links WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM test_delivery_proofs WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM return_dispositions WHERE org_id=p_org AND return_id IN (SELECT id FROM returns WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client)));
 DELETE FROM return_evidence WHERE org_id=p_org AND return_id IN (SELECT id FROM returns WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client)));
 DELETE FROM returns WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM incidents WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM attempt_items WHERE attempt_id IN (SELECT id FROM attempts WHERE org_id=p_org AND stop_id IN (SELECT id FROM stops WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client))) OR parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM attempts WHERE org_id=p_org AND stop_id IN (SELECT id FROM stops WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM receipt_items WHERE receipt_id IN (SELECT id FROM receipts WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client)) OR parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM receipts WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client);
 DELETE FROM custody_events WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 UPDATE routes SET version=version+1, state=CASE WHEN state='READY' THEN 'DRAFT' ELSE state END
  WHERE org_id=p_org AND (id IN (SELECT route_id FROM stops WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client))
  OR id IN (SELECT route_id FROM route_assignments WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client))));
 DELETE FROM route_assignments WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM stops WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client);
 UPDATE evidence SET parcel_id=NULL WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client)) AND (
  EXISTS (SELECT 1 FROM defects d WHERE d.org_id=p_org AND d.evidence_id=evidence.id)
  OR EXISTS (SELECT 1 FROM maintenance m WHERE m.org_id=p_org AND m.evidence_id=evidence.id)
  OR EXISTS (SELECT 1 FROM returns r WHERE r.org_id=p_org AND r.sender_evidence_id=evidence.id)
  OR EXISTS (SELECT 1 FROM return_evidence re WHERE re.org_id=p_org AND re.evidence_id=evidence.id)
  OR EXISTS (SELECT 1 FROM quad_proofs q WHERE q.org_id=p_org AND q.evidence_id=evidence.id));
 DELETE FROM evidence WHERE org_id=p_org AND parcel_id IN (SELECT id FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client));
 DELETE FROM parcels WHERE org_id=p_org AND shipment_id IN (SELECT id FROM shipments WHERE org_id=p_org AND client_id=p_client);
 DELETE FROM shipments WHERE org_id=p_org AND client_id=p_client;
 DELETE FROM clients WHERE org_id=p_org AND id=p_client;
 DELETE FROM client_purge_scope WHERE org_id=p_org AND client_id=p_client;
 RETURN 'DELETED';
END;
$$;
REVOKE ALL ON FUNCTION purge_client(text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, nexora_tracking_worker;
GRANT EXECUTE ON FUNCTION purge_client(text,text,text,text) TO nexora_runtime;
INSERT INTO schema_migrations(version,applied_at) VALUES(22,now());
