-- Preserve FIFO priority when an import inserts several orders in one millisecond.
-- Existing orders and all stock/custody records are preserved.
SET LOCAL search_path TO nexora,pg_catalog;
ALTER TABLE inventory_orders ADD COLUMN _sequence BIGINT GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX inventory_orders_ingress_sequence ON inventory_orders(_sequence);
DO $$ DECLARE sequence_name regclass; BEGIN
  SELECT pg_get_serial_sequence('nexora.inventory_orders','_sequence')::regclass INTO sequence_name;
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %s TO nexora_runtime',sequence_name);
END $$;
INSERT INTO schema_migrations(version,applied_at) VALUES(20,CURRENT_TIMESTAMP);
