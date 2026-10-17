import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db.ts';
import { setup, type Actor } from '../server/auth.ts';
import { Logistics } from '../server/domain.ts';
const path = resolve('.local/demo.sqlite');
if (existsSync(path)) {
    console.log('La base DEMO ya existe. Se conserva sin cambios: .local/demo.sqlite');
}
else {
    const store = new Store(path);
    try {
        const { orgId, userId } = await setup(store, { organizationName: 'DEMO · OS de Logística', timezone: 'UTC', username: 'demo.admin', password: 'Demo-Logistica-2026!' });
        const actor: Actor = { id: userId, orgId, name: 'Administrador DEMO', role: 'ADMIN', driverId: null };
        const domain = new Logistics(store), command = () => ({ commandId: randomUUID() });
        const client = (await domain.createClient(actor, { ...await command(), name: 'Cliente ficticio · QA' })).id;
        const driver = (await domain.createDriver(actor, { ...await command(), name: 'Chofer de demostración', username: 'demo.chofer', password: 'Demo-Chofer-2026!' })).id;
        const vehicle = (await domain.createVehicle(actor, { ...await command(), plate: 'DEMO-001', capacityWeightGrams: 500000, capacityVolumeCm3: 2000000, odometer: 12000 })).id;
        const shipment = (await domain.createShipment(actor, { ...await command(), clientId: client, reference: 'QA-P1-P5', originText: 'Remitente ficticio · Origen QA', destinationText: 'Dirección ficticia · Destino QA', recipientName: 'Destinatario ficticio', recipientPhone: '', parcelCount: 5, weightGrams: 1000, volumeCm3: 2000, proofPolicy: 'RECEIVER_PHOTO' })).id;
        const parcels = await store.all('SELECT * FROM parcels WHERE shipment_id=? ORDER BY rowid', shipment);
        await domain.receive(actor, { ...await command(), shipmentId: shipment, codes: parcels.slice(0, 4).map(p => p.code), location: 'Depósito DEMO' });
        const route = (await domain.createRoute(actor, { ...await command(), name: 'Ruta DEMO · recepción parcial', driverId: driver, vehicleId: vehicle, startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date(Date.now() + 8 * 3600000).toISOString() })).id;
        await domain.assign(actor, route, { ...await command(), expectedVersion: 1, parcelIds: parcels.slice(0, 4).map(p => p.id), pickup: false });
        console.log('Base DEMO creada con datos ficticios. No se modificó la base operativa.');
    }
    finally {
        await store.close();
    }
}
console.log('Usuario DEMO: demo.admin · Contraseña DEMO: Demo-Logistica-2026!');
console.log('Chofer DEMO: demo.chofer · Contraseña DEMO: Demo-Chofer-2026!');
console.log('Vista previa DEMO aislada: npm run preview:demo · http://127.0.0.1:5174');
