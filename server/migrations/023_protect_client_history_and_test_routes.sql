ALTER TABLE clients ADD COLUMN archived_at TEXT;
ALTER TABLE routes ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1));

CREATE VIEW client_history AS
 SELECT c.org_id,c.id AS client_id
 FROM clients c
 WHERE EXISTS (SELECT 1 FROM billing_documents h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM inventory_orders h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM shipments h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM inventory_movements h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM inventory_receipt_batches h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM inventory_units h WHERE h.org_id=c.org_id AND h.client_id=c.id)
    OR EXISTS (SELECT 1 FROM inventory_balances h WHERE h.org_id=c.org_id AND h.client_id=c.id AND h.quantity>0);

CREATE TRIGGER client_history_no_delete BEFORE DELETE ON clients
WHEN EXISTS (SELECT 1 FROM client_history h WHERE h.org_id=OLD.org_id AND h.client_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'CLIENT_HAS_HISTORY'); END;

CREATE TRIGGER client_purge_no_history BEFORE INSERT ON client_purge_scope
WHEN EXISTS (SELECT 1 FROM client_history h WHERE h.org_id=NEW.org_id AND h.client_id=NEW.client_id)
BEGIN SELECT RAISE(ABORT,'CLIENT_HAS_HISTORY'); END;

CREATE TRIGGER inventory_orders_active_client BEFORE INSERT ON inventory_orders
WHEN EXISTS (SELECT 1 FROM clients c WHERE c.org_id=NEW.org_id AND c.id=NEW.client_id AND c.archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'CLIENT_ARCHIVED'); END;
CREATE TRIGGER shipments_active_client BEFORE INSERT ON shipments
WHEN EXISTS (SELECT 1 FROM clients c WHERE c.org_id=NEW.org_id AND c.id=NEW.client_id AND c.archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'CLIENT_ARCHIVED'); END;
CREATE TRIGGER inventory_products_active_client BEFORE INSERT ON inventory_products
WHEN EXISTS (SELECT 1 FROM clients c WHERE c.org_id=NEW.org_id AND c.id=NEW.client_id AND c.archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'CLIENT_ARCHIVED'); END;
CREATE TRIGGER inventory_receipt_batches_active_client BEFORE INSERT ON inventory_receipt_batches
WHEN EXISTS (SELECT 1 FROM clients c WHERE c.org_id=NEW.org_id AND c.id=NEW.client_id AND c.archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'CLIENT_ARCHIVED'); END;
CREATE TRIGGER customer_accounts_active_client BEFORE INSERT ON customer_accounts
WHEN EXISTS (SELECT 1 FROM clients c WHERE c.org_id=NEW.org_id AND c.id=NEW.client_id AND c.archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'CLIENT_ARCHIVED'); END;
CREATE TRIGGER inventory_receiving_active_client BEFORE INSERT ON inventory_movements
WHEN NEW.action='RECEIVE' AND EXISTS (SELECT 1 FROM clients c WHERE c.org_id=NEW.org_id AND c.id=NEW.client_id AND c.archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'CLIENT_ARCHIVED'); END;

CREATE TRIGGER test_delivery_proofs_test_route BEFORE INSERT ON test_delivery_proofs
WHEN NOT EXISTS (
  SELECT 1 FROM route_assignments a
  JOIN routes r ON r.org_id=a.org_id AND r.id=a.route_id
  JOIN organization_test_mode m ON m.org_id=a.org_id AND m.enabled=1
  WHERE a.org_id=NEW.org_id AND a.parcel_id=NEW.parcel_id AND a.active=1 AND r.is_test=1 AND r.state='IN_PROGRESS'
 )
BEGIN SELECT RAISE(ABORT,'TEST_PROOF_REQUIRES_TEST_ROUTE'); END;

CREATE TRIGGER route_test_status_before_departure BEFORE UPDATE OF is_test ON routes
WHEN OLD.is_test<>NEW.is_test AND OLD.state NOT IN ('DRAFT','READY')
BEGIN SELECT RAISE(ABORT,'TEST_ROUTE_ALREADY_DEPARTED'); END;
