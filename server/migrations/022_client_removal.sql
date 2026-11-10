-- The scope lives only during the deletion transaction.
CREATE TABLE client_purge_scope (
 org_id TEXT NOT NULL, client_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 PRIMARY KEY(org_id,client_id)
);

DROP TRIGGER inventory_movements_no_delete;
CREATE TRIGGER inventory_movements_no_delete BEFORE DELETE ON inventory_movements
WHEN NOT EXISTS (SELECT 1 FROM client_purge_scope WHERE org_id=OLD.org_id AND client_id=OLD.client_id)
BEGIN SELECT RAISE(ABORT,'INVENTORY_LEDGER_APPEND_ONLY'); END;
DROP TRIGGER inventory_receipt_batches_no_delete;
CREATE TRIGGER inventory_receipt_batches_no_delete BEFORE DELETE ON inventory_receipt_batches
WHEN NOT EXISTS (SELECT 1 FROM client_purge_scope WHERE org_id=OLD.org_id AND client_id=OLD.client_id)
BEGIN SELECT RAISE(ABORT,'INVENTORY_RECEIPTS_APPEND_ONLY'); END;
DROP TRIGGER return_dispositions_no_delete;
CREATE TRIGGER return_dispositions_no_delete BEFORE DELETE ON return_dispositions
WHEN NOT EXISTS (
 SELECT 1 FROM client_purge_scope scope
 JOIN shipments s ON s.org_id=scope.org_id AND s.client_id=scope.client_id
 JOIN parcels p ON p.org_id=s.org_id AND p.shipment_id=s.id
 JOIN returns r ON r.org_id=p.org_id AND r.parcel_id=p.id
 WHERE r.org_id=OLD.org_id AND r.id=OLD.return_id
)
BEGIN SELECT RAISE(ABORT,'RETURN_DISPOSITION_APPEND_ONLY'); END;

CREATE TRIGGER purge_client AFTER INSERT ON client_purge_scope
BEGIN
 SELECT RAISE(ABORT,'CLIENT_PURGE_FORBIDDEN')
 WHERE NOT EXISTS (SELECT 1 FROM users WHERE org_id=NEW.org_id AND id=NEW.actor_id AND enabled=1 AND role='ADMIN');
 SELECT RAISE(ABORT,'CLIENT_PURGE_IN_TRANSIT') WHERE EXISTS (
  SELECT 1 FROM shipments s JOIN parcels p ON p.org_id=s.org_id AND p.shipment_id=s.id
  WHERE s.org_id=NEW.org_id AND s.client_id=NEW.client_id AND (
   p.custody_type='VEHICLE' OR p.state IN ('LOADED','IN_TRANSIT','RETURN_PENDING') OR EXISTS (
    SELECT 1 FROM route_assignments a JOIN routes r ON r.org_id=a.org_id AND r.id=a.route_id
    WHERE a.org_id=s.org_id AND a.parcel_id=p.id AND a.active=1 AND r.state='IN_PROGRESS'
   )
  )
 ) OR EXISTS (
  SELECT 1 FROM shipments s JOIN stops t ON t.org_id=s.org_id AND t.shipment_id=s.id
  JOIN routes r ON r.org_id=t.org_id AND r.id=t.route_id
  WHERE s.org_id=NEW.org_id AND s.client_id=NEW.client_id AND r.state='IN_PROGRESS' AND t.state IN ('PENDING','PARTIAL')
 ) OR EXISTS (
  SELECT 1 FROM inventory_balances b WHERE b.org_id=NEW.org_id AND b.client_id=NEW.client_id AND b.status='VEHICLE' AND b.quantity>0
 ) OR EXISTS (
  SELECT 1 FROM inventory_units u WHERE u.org_id=NEW.org_id AND u.client_id=NEW.client_id AND u.status='VEHICLE'
 );

 -- Retain mixed import receipts for the other customers, with this client's lines removed.
 DELETE FROM inventory_import_runs
 WHERE org_id=NEW.org_id AND EXISTS (
  SELECT 1 FROM json_each(result,'$.orders') WHERE json_extract(value,'$.clientId')=NEW.client_id
 ) AND NOT EXISTS (
  SELECT 1 FROM json_each(result,'$.orders') WHERE json_extract(value,'$.clientId') IS NOT NEW.client_id
 );
 UPDATE inventory_import_runs
 SET result=(
  SELECT json_object('imported',count(*),'orders',json_group_array(json(value))) FROM json_each(result,'$.orders')
  WHERE json_extract(value,'$.clientId') IS NOT NEW.client_id
 ), accepted_count=accepted_count-(
  SELECT COUNT(*) FROM json_each(result,'$.orders') WHERE json_extract(value,'$.clientId')=NEW.client_id
 )
 WHERE org_id=NEW.org_id AND EXISTS (
  SELECT 1 FROM json_each(result,'$.orders') WHERE json_extract(value,'$.clientId')=NEW.client_id
 );

 DELETE FROM customer_sessions WHERE account_id IN (SELECT id FROM customer_accounts WHERE org_id=NEW.org_id AND client_id=NEW.client_id);
 DELETE FROM password_recovery WHERE org_id=NEW.org_id AND account_id IN (SELECT id FROM customer_accounts WHERE org_id=NEW.org_id AND client_id=NEW.client_id);
 DELETE FROM customer_accounts WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM billing_shipment_links WHERE org_id=NEW.org_id AND (document_id IN (SELECT id FROM billing_documents WHERE org_id=NEW.org_id AND client_id=NEW.client_id) OR shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM billing_documents WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM client_delivery_locks WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM client_delivery_policies WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM inventory_receipt_batches WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM routing_points WHERE org_id=NEW.org_id AND entity_kind='ORDER' AND entity_id IN (SELECT id FROM inventory_orders WHERE org_id=NEW.org_id AND client_id=NEW.client_id);
 DELETE FROM routing_plans WHERE org_id=NEW.org_id AND (instr(input, '"'||NEW.client_id||'"')>0 OR EXISTS(
   SELECT 1 FROM inventory_orders io WHERE io.org_id=NEW.org_id AND io.client_id=NEW.client_id
    AND (instr(routing_plans.input, '"'||io.id||'"')>0 OR instr(routing_plans.proposal, '"'||io.id||'"')>0)));
 DELETE FROM inventory_movements WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM inventory_order_parcels WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM inventory_order_lines WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM inventory_units WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM inventory_balances WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM inventory_orders WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM inventory_products WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM quad_webhook_events WHERE org_id=NEW.org_id AND external_code IN (SELECT external_code FROM quad_parcel_links WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id)));
 DELETE FROM quad_proofs WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM quad_parcel_links WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM test_delivery_proofs WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM return_dispositions WHERE org_id=NEW.org_id AND return_id IN (SELECT id FROM returns WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id)));
 DELETE FROM return_evidence WHERE org_id=NEW.org_id AND return_id IN (SELECT id FROM returns WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id)));
 DELETE FROM returns WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM incidents WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM attempt_items WHERE attempt_id IN (SELECT id FROM attempts WHERE org_id=NEW.org_id AND stop_id IN (SELECT id FROM stops WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id))) OR parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM attempts WHERE org_id=NEW.org_id AND stop_id IN (SELECT id FROM stops WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM receipt_items WHERE receipt_id IN (SELECT id FROM receipts WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id)) OR parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM receipts WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id);
 DELETE FROM custody_events WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 UPDATE routes SET version=version+1, state=CASE WHEN state='READY' THEN 'DRAFT' ELSE state END
  WHERE org_id=NEW.org_id AND (id IN (SELECT route_id FROM stops WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id))
  OR id IN (SELECT route_id FROM route_assignments WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id))));
 DELETE FROM route_assignments WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM stops WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id);
 UPDATE evidence SET parcel_id=NULL WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id)) AND (
  EXISTS (SELECT 1 FROM defects d WHERE d.org_id=NEW.org_id AND d.evidence_id=evidence.id)
  OR EXISTS (SELECT 1 FROM maintenance m WHERE m.org_id=NEW.org_id AND m.evidence_id=evidence.id)
  OR EXISTS (SELECT 1 FROM returns r WHERE r.org_id=NEW.org_id AND r.sender_evidence_id=evidence.id)
  OR EXISTS (SELECT 1 FROM return_evidence re WHERE re.org_id=NEW.org_id AND re.evidence_id=evidence.id)
  OR EXISTS (SELECT 1 FROM quad_proofs q WHERE q.org_id=NEW.org_id AND q.evidence_id=evidence.id));
 DELETE FROM evidence WHERE org_id=NEW.org_id AND parcel_id IN (SELECT id FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id));
 DELETE FROM parcels WHERE org_id=NEW.org_id AND shipment_id IN (SELECT id FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id);
 DELETE FROM shipments WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
 DELETE FROM clients WHERE org_id=NEW.org_id AND id=NEW.client_id;
 DELETE FROM client_purge_scope WHERE org_id=NEW.org_id AND client_id=NEW.client_id;
END;
