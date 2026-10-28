import {randomUUID} from 'node:crypto';
import type {Database} from './database.ts';
import {ensure} from './errors.ts';

export async function bindVehiclePhone(store:Database,orgId:string,vehicleId:string,deviceId:string|null,clock=Date.now){
 const vehicle=await store.one('SELECT id FROM vehicles WHERE id=? AND org_id=?',vehicleId,orgId);
 ensure(vehicle,'NOT_FOUND','Vehículo no encontrado.',404);
 const current=await store.one('SELECT device_id FROM traccar_vehicle_bindings WHERE org_id=? AND vehicle_id=?',orgId,vehicleId);
 if((current?.device_id??null)===deviceId)return;
 ensure(!await store.one("SELECT id FROM routes WHERE org_id=? AND vehicle_id=? AND state='IN_PROGRESS'",orgId,vehicleId),'INVALID_TRANSITION','El vehículo está en reparto. Cambiá su celular después de finalizar la ruta.');
 if(deviceId){
  ensure(await store.one('SELECT device_id FROM traccar_devices WHERE device_id=? AND org_id=?',deviceId,orgId),'NOT_FOUND','Celular no autorizado.',404);
  const other=await store.one('SELECT b.vehicle_id,v.plate FROM traccar_vehicle_bindings b JOIN vehicles v ON v.id=b.vehicle_id AND v.org_id=b.org_id WHERE b.org_id=? AND b.device_id=? AND b.vehicle_id<>?',orgId,deviceId,vehicleId);
  if(other){
   ensure(!await store.one("SELECT id FROM routes WHERE org_id=? AND vehicle_id=? AND state IN('READY','IN_PROGRESS')",orgId,other.vehicle_id),'INVALID_TRANSITION',`Ese celular está vinculado al vehículo ${other.plate}, que tiene una ruta confirmada o en reparto.`);
   await store.run('DELETE FROM traccar_latest WHERE org_id=? AND vehicle_id=?',orgId,other.vehicle_id);
   await store.run('DELETE FROM traccar_vehicle_bindings WHERE org_id=? AND vehicle_id=?',orgId,other.vehicle_id);
  }
 }
 await store.run('DELETE FROM traccar_latest WHERE org_id=? AND vehicle_id=?',orgId,vehicleId);
 await store.run('DELETE FROM traccar_vehicle_bindings WHERE org_id=? AND vehicle_id=?',orgId,vehicleId);
 if(deviceId)await store.run('INSERT INTO traccar_vehicle_bindings VALUES(?,?,?,?,?)',orgId,vehicleId,deviceId,randomUUID(),new Date(clock()).toISOString());
}
