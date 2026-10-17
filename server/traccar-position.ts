import type { Database } from './database.ts';
export function normalizeTraccarPosition(value: any, clock = Date.now()) {
  if (!value || value.valid !== true || !Number.isSafeInteger(value.deviceId) || value.deviceId <= 0 ||
      !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180 ||
      typeof value.fixTime !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value.fixTime) || !Number.isFinite(Date.parse(value.fixTime)) || Date.parse(value.fixTime) > clock + 60_000 ||
      value.accuracy != null && (!Number.isFinite(value.accuracy) || value.accuracy < 0)) return null;
  return { deviceId: String(value.deviceId), latitude: value.latitude, longitude: value.longitude,
    accuracy: value.accuracy ?? null, measuredAt: new Date(value.fixTime).toISOString() };
}
export async function ingestTraccarPosition(store: Database, value: unknown, clock = Date.now()) {
  const p=normalizeTraccarPosition(value,clock);
  if(!p)return false;
  return store.transaction(async()=>{
    const binding=await store.one('SELECT * FROM traccar_vehicle_bindings WHERE device_id=?',p.deviceId);
    if(!binding||p.measuredAt<new Date(binding.updated_at).toISOString())return false;
    const saved=await store.run(`INSERT INTO traccar_latest(org_id,vehicle_id,device_id,revision,latitude,longitude,accuracy,measured_at,received_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(org_id,vehicle_id) DO UPDATE SET device_id=excluded.device_id,revision=excluded.revision,latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,measured_at=excluded.measured_at,received_at=excluded.received_at
      WHERE excluded.measured_at>traccar_latest.measured_at OR excluded.revision<>traccar_latest.revision`,binding.org_id,binding.vehicle_id,p.deviceId,binding.revision,p.latitude,p.longitude,p.accuracy,p.measuredAt,new Date(clock).toISOString());
    return Number(saved.changes)>0;
  });
}
