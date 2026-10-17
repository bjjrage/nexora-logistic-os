CREATE INDEX shipments_listing ON shipments(org_id,created_at DESC,id);
CREATE INDEX inventory_orders_listing ON inventory_orders(org_id,order_date DESC,created_at DESC,id);
