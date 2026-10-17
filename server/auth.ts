import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Database } from './database.ts';
import { ensure } from './errors.ts';
export type Role = 'ADMIN' | 'OPERATIONS' | 'DEPOT' | 'DRIVER' | 'CUSTOMER';
export interface Actor {
    id: string;
    orgId: string;
    name: string;
    role: Role;
    driverId: string | null;
    clientId?: string | null;
}
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function passwordHash(password: string) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function checkPassword(password: string, encoded: string) {
    const [salt, digest] = encoded.split(':');
    if (!salt || !digest)
        return false;
    const expected = Buffer.from(digest, 'hex');
    const actual = scryptSync(password, salt, 64);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
// Verified against when the username is unknown, so login takes the same scrypt time either way.
const decoyHash = passwordHash(randomBytes(16).toString('hex'));
export function checkLogin(password: string, encoded: string | undefined) {
    const ok = checkPassword(password, encoded ?? decoyHash);
    return ok && encoded !== undefined;
}
export async function actorFromRequest(store: Database, req: Request): Promise<Actor | null> {
    const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('logistics_session='))?.split('=')[1];
    if (!token || !/^[a-f0-9]{64}$/.test(token))
        return null;
    const user = await store.one('SELECT u.id,u.org_id,u.name,u.role,u.driver_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1', hash(token), new Date().toISOString());
    if(user) return { id: user.id, orgId: user.org_id, name: user.name, role: user.role, driverId: user.driver_id, clientId:null };
    const account=await store.one('SELECT a.id,a.org_id,a.name,a.client_id FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>? AND a.enabled=1',hash(token),new Date().toISOString());
    return account ? {id:account.id,orgId:account.org_id,name:account.name,role:'CUSTOMER',driverId:null,clientId:account.client_id} : null;
}
export async function createSession(store: Database, userId: string, res: Response, customer=false) {
    const token = randomBytes(32).toString('hex');
    const table=customer?'customer_sessions':'sessions';
    await store.transaction(async()=>{
        ensure(await store.one(`SELECT id FROM ${customer?'customer_accounts':'users'} WHERE id=? AND enabled=1`,userId),'FORBIDDEN','Usuario o contraseña incorrectos.',401);
        await store.run(`DELETE FROM ${table} WHERE expires_at<=?`, new Date().toISOString());
        await store.run(`INSERT INTO ${table} VALUES(?,?,?)`, hash(token), userId, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString());
    });
    res.cookie('logistics_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV==='production'||process.env.COOKIE_SECURE === 'true', maxAge: 12 * 60 * 60 * 1000, path: '/' });
}
export async function setup(store: Database, input: {
    organizationName: string;
    timezone: string;
    username: string;
    password: string;
}) {
    return await store.transaction(async () => {
        ensure(!await store.one('SELECT id FROM users LIMIT 1'), 'INVALID_TRANSITION', 'La instalación ya tiene administrador.');
        try {
            new Intl.DateTimeFormat('es', { timeZone: input.timezone });
        }
        catch {
            ensure(false, 'VALIDATION_ERROR', 'La zona horaria IANA no es válida.', 400);
        }
        const orgId = randomUUID(), userId = randomUUID();
        await store.run('INSERT INTO organizations VALUES(?,?,?)', orgId, input.organizationName, input.timezone);
        await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)', userId, orgId, input.username, 'Administración', passwordHash(input.password), 'ADMIN');
        return { userId, orgId };
    });
}
export function authorize(actor: Actor, roles: Role[]) { ensure(roles.includes(actor.role), 'FORBIDDEN', 'Tu rol no permite esta operación.', 403); }
