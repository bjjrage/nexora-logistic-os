-- Constraint-only correction: the runtime table contract stays at version 16.
SET LOCAL search_path = nexora, public;
ALTER TABLE routes DROP CONSTRAINT routes_driver_window;
ALTER TABLE routes DROP CONSTRAINT routes_vehicle_window;
ALTER TABLE routes ADD CONSTRAINT routes_driver_window EXCLUDE USING gist
 (org_id WITH =, driver_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&)
 WHERE (state IN ('READY','IN_PROGRESS'));
ALTER TABLE routes ADD CONSTRAINT routes_vehicle_window EXCLUDE USING gist
 (org_id WITH =, vehicle_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&)
 WHERE (state IN ('READY','IN_PROGRESS'));
-- Physical occupancy is independent of a route's scheduled return time.
CREATE UNIQUE INDEX routes_driver_in_progress ON routes(org_id,driver_id) WHERE state='IN_PROGRESS';
CREATE UNIQUE INDEX routes_vehicle_in_progress ON routes(org_id,vehicle_id) WHERE state='IN_PROGRESS';
