import { randomUUID } from 'node:crypto';
import type { Actor, Role } from './auth.ts';
import type { Logistics } from './domain.ts';
import { ensure } from './errors.ts';
import type { Row } from './db.ts';
const OPS: Role[] = ['ADMIN', 'OPERATIONS'];
const now = () => new Date().toISOString();
function expiration(value: unknown): {
    iso: string;
    milliseconds: number;
} {
    ensure(typeof value === 'string' && value.length > 0, 'VALIDATION_ERROR', 'Indicá una fecha de vencimiento válida.', 400);
    const date = new Date(value);
    ensure(Number.isFinite(date.getTime()), 'VALIDATION_ERROR', 'Indicá una fecha de vencimiento válida.', 400);
    return { iso: date.toISOString(), milliseconds: date.getTime() };
}
export async function createDriverDocument(domain: Logistics, actor: Actor, driverId: string, b: Row) {
    return await domain.command(actor, `drivers.${driverId}.documents.create`, b, OPS, async () => {
        await domain.record('drivers', driverId, actor);
        ensure(typeof b.name === 'string' && b.name.trim().length > 0, 'VALIDATION_ERROR', 'Indicá el nombre del requisito.', 400);
        ensure(typeof b.blocksDispatch === 'boolean', 'VALIDATION_ERROR', 'Indicá si el requisito bloquea el despacho.', 400);
        const expiresAt = expiration(b.expiresAt).iso;
        const id = randomUUID();
        const createdAt = now();
        await domain.store.run('INSERT INTO driver_documents(id,org_id,driver_id,name,expires_at,blocks_dispatch,created_at) VALUES(?,?,?,?,?,?,?)', id, actor.orgId, driverId, b.name.trim(), expiresAt, b.blocksDispatch ? 1 : 0, createdAt);
        await domain.store.run('INSERT INTO driver_document_events(id,org_id,document_id,actor_id,previous_expires_at,expires_at,command_id,created_at) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, id, actor.id, null, expiresAt, b.commandId, createdAt);
        return { id };
    });
}
export async function renewDriverDocument(domain: Logistics, actor: Actor, documentId: string, b: Row) {
    return await domain.command(actor, `driver-documents.${documentId}.renew`, b, OPS, async () => {
        const document = await domain.record('driver_documents', documentId, actor);
        const next = expiration(b.expiresAt);
        ensure(next.milliseconds > Date.now(), 'VALIDATION_ERROR', 'La nueva fecha de vencimiento debe ser futura.', 400);
        const previous = expiration(document.expires_at);
        ensure(next.milliseconds > previous.milliseconds, 'VALIDATION_ERROR', 'La nueva fecha debe ser posterior al vencimiento registrado.', 400);
        const createdAt = now();
        await domain.store.run('UPDATE driver_documents SET expires_at=? WHERE id=? AND org_id=?', next.iso, documentId, actor.orgId);
        await domain.store.run('INSERT INTO driver_document_events(id,org_id,document_id,actor_id,previous_expires_at,expires_at,command_id,created_at) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), actor.orgId, documentId, actor.id, previous.iso, next.iso, b.commandId, createdAt);
        return { id: documentId };
    });
}
