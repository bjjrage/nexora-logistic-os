SET search_path TO nexora, pg_catalog;
CREATE TABLE traccar_devices (
 device_id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
 unique_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(device_id,org_id)
);
CREATE TABLE traccar_vehicle_bindings (
 org_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, device_id TEXT NOT NULL UNIQUE,
 revision TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(org_id,vehicle_id),
 FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id),
 FOREIGN KEY(device_id,org_id) REFERENCES traccar_devices(device_id,org_id)
);
CREATE TABLE traccar_latest (
 org_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, device_id TEXT NOT NULL, revision TEXT NOT NULL,
 latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 accuracy DOUBLE PRECISION CHECK(accuracy>=0), measured_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(org_id,vehicle_id), FOREIGN KEY(vehicle_id,org_id) REFERENCES vehicles(id,org_id)
);
CREATE TABLE route_tracking_settings (
 org_id TEXT NOT NULL, route_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN('QUADMINDS','TRACCAR')),
 updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(org_id,route_id), FOREIGN KEY(route_id,org_id) REFERENCES routes(id,org_id)
);
CREATE TABLE client_delivery_policies (
 org_id TEXT NOT NULL, client_id TEXT NOT NULL, delivery_provider TEXT NOT NULL CHECK(delivery_provider IN('QUADMINDS','NEXORA')),
 updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(org_id,client_id), FOREIGN KEY(client_id,org_id) REFERENCES clients(id,org_id)
);
CREATE TABLE tracking_source_state (
 source TEXT PRIMARY KEY CHECK(source='TRACCAR'), connected INTEGER NOT NULL CHECK(connected IN(0,1)),
 checked_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE traccar_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON traccar_devices FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON traccar_devices TO nexora_runtime;
CREATE POLICY runtime_access ON traccar_devices TO nexora_runtime USING(true) WITH CHECK(true);

ALTER TABLE traccar_vehicle_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON traccar_vehicle_bindings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON traccar_vehicle_bindings TO nexora_runtime;
CREATE POLICY runtime_access ON traccar_vehicle_bindings TO nexora_runtime USING(true) WITH CHECK(true);

ALTER TABLE traccar_latest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON traccar_latest FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON traccar_latest TO nexora_runtime;
CREATE POLICY runtime_access ON traccar_latest TO nexora_runtime USING(true) WITH CHECK(true);

ALTER TABLE route_tracking_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON route_tracking_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON route_tracking_settings TO nexora_runtime;
CREATE POLICY runtime_access ON route_tracking_settings TO nexora_runtime USING(true) WITH CHECK(true);

ALTER TABLE client_delivery_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON client_delivery_policies FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON client_delivery_policies TO nexora_runtime;
CREATE POLICY runtime_access ON client_delivery_policies TO nexora_runtime USING(true) WITH CHECK(true);

ALTER TABLE tracking_source_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tracking_source_state FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON tracking_source_state TO nexora_runtime;
CREATE POLICY runtime_access ON tracking_source_state TO nexora_runtime USING(true) WITH CHECK(true);

GRANT USAGE ON SCHEMA nexora TO nexora_tracking_worker;
GRANT SELECT(id) ON organizations TO nexora_tracking_worker;
CREATE POLICY tracking_worker_org_lookup ON organizations FOR SELECT TO nexora_tracking_worker USING(true);
GRANT SELECT ON traccar_devices TO nexora_tracking_worker;
CREATE POLICY worker_read ON traccar_devices FOR SELECT TO nexora_tracking_worker USING(true);
GRANT SELECT ON traccar_vehicle_bindings TO nexora_tracking_worker;
CREATE POLICY worker_read ON traccar_vehicle_bindings FOR SELECT TO nexora_tracking_worker USING(true);
GRANT SELECT ON traccar_latest TO nexora_tracking_worker;
CREATE POLICY worker_read ON traccar_latest FOR SELECT TO nexora_tracking_worker USING(true);
GRANT SELECT ON tracking_source_state TO nexora_tracking_worker;
CREATE POLICY worker_read ON tracking_source_state FOR SELECT TO nexora_tracking_worker USING(true);
GRANT INSERT ON traccar_devices TO nexora_tracking_worker;
CREATE POLICY worker_insert ON traccar_devices FOR INSERT TO nexora_tracking_worker WITH CHECK(true);
GRANT INSERT ON traccar_latest TO nexora_tracking_worker;
CREATE POLICY worker_insert ON traccar_latest FOR INSERT TO nexora_tracking_worker WITH CHECK(true);
GRANT INSERT ON tracking_source_state TO nexora_tracking_worker;
CREATE POLICY worker_insert ON tracking_source_state FOR INSERT TO nexora_tracking_worker WITH CHECK(true);
GRANT UPDATE ON traccar_latest TO nexora_tracking_worker;
CREATE POLICY worker_update ON traccar_latest FOR UPDATE TO nexora_tracking_worker USING(true) WITH CHECK(true);
GRANT UPDATE ON tracking_source_state TO nexora_tracking_worker;
CREATE POLICY worker_update ON tracking_source_state FOR UPDATE TO nexora_tracking_worker USING(true) WITH CHECK(true);
INSERT INTO schema_migrations(version,applied_at) VALUES(8,now());
CREATE OR REPLACE FUNCTION tracking_private.lookup_public_gps(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_point record; v_age double precision; v_source record;
BEGIN
  IF p_code IS NULL OR length(p_code)>64 OR upper(btrim(p_code)) !~ '^B-[0-9A-F]{20}$' THEN RETURN NULL; END IF;
  SELECT l.*,b.updated_at AS bound_at INTO v_point
  FROM nexora.parcels p
  JOIN nexora.shipments s ON s.id=p.shipment_id AND s.org_id=p.org_id
  JOIN nexora.client_delivery_policies c ON c.client_id=s.client_id AND c.org_id=s.org_id AND c.delivery_provider='NEXORA'
  JOIN nexora.route_assignments a ON a.parcel_id=p.id AND a.org_id=p.org_id AND a.active=1
  JOIN nexora.routes r ON r.id=a.route_id AND r.org_id=a.org_id AND r.state='IN_PROGRESS' AND r.vehicle_id=p.custody_id
  JOIN nexora.route_tracking_settings rt ON rt.route_id=r.id AND rt.org_id=r.org_id AND rt.provider='TRACCAR'
  JOIN nexora.traccar_vehicle_bindings b ON b.vehicle_id=r.vehicle_id AND b.org_id=r.org_id
  LEFT JOIN nexora.traccar_latest l ON l.vehicle_id=b.vehicle_id AND l.org_id=b.org_id AND l.device_id=b.device_id AND l.revision=b.revision
    AND l.measured_at>=b.updated_at AND l.measured_at>=rt.updated_at
    AND l.measured_at>=(SELECT max(e.created_at) FROM nexora.custody_events e WHERE e.parcel_id=p.id AND e.org_id=p.org_id AND e.action IN('DISPATCHED','DIRECT_PICKUP'))
  WHERE p.code=upper(btrim(p_code)) AND p.state='IN_TRANSIT' AND p.custody_type='VEHICLE';
  IF NOT FOUND THEN RETURN jsonb_build_object('status','INACTIVE','position',NULL); END IF;
  IF v_point.measured_at IS NULL THEN RETURN jsonb_build_object('status','NO_POSITION','position',NULL); END IF;
  v_age:=extract(epoch FROM (now()-v_point.measured_at));
  IF v_age< -60 OR v_age>600 THEN RETURN jsonb_build_object('status','NO_POSITION','position',NULL); END IF;
  SELECT connected,checked_at INTO v_source FROM nexora.tracking_source_state WHERE source='TRACCAR';
  RETURN jsonb_build_object('status',CASE WHEN v_age>180 OR v_source.connected IS DISTINCT FROM 1 OR v_source.checked_at<now()-interval '90 seconds' THEN 'STALE' ELSE 'FRESH' END,
    'position',jsonb_build_object('latitude',v_point.latitude,'longitude',v_point.longitude,'accuracy',v_point.accuracy,'measuredAt',v_point.measured_at,'receivedAt',v_point.received_at));
END;
$$;
REVOKE ALL ON FUNCTION tracking_private.lookup_public_gps(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tracking_private.lookup_public_gps(text) TO anon,authenticated;
COMMENT ON FUNCTION tracking_private.lookup_public_gps(text) IS 'Bearer-code lookup for one in-transit parcel, its current active assignment and binding revision. No fleet identity or historical track is exposed.';
CREATE OR REPLACE FUNCTION public.track_order(p_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT tracking_private.lookup_public_tracking(p_code) || jsonb_build_object('gps',tracking_private.lookup_public_gps(p_code)); $$;
REVOKE ALL ON FUNCTION public.track_order(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_order(text) TO anon,authenticated;
