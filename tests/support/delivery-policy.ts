import { randomUUID } from 'node:crypto';
import type { Database } from '../../server/database.ts';
import type { Actor } from '../../server/auth.ts';
import { TraccarTracking } from '../../server/traccar.ts';

/** Positive business fixtures must declare their delivery circuit explicitly. */
export async function configureDelivery(store: Database, actor: Actor, clientId: string, deliveryProvider: 'QUADMINDS' | 'NEXORA' = 'QUADMINDS') {
  await new TraccarTracking(store, {}).clientPolicy(actor, clientId, { commandId: randomUUID(), deliveryProvider });
}
