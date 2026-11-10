import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Database } from './database.ts';
import { ensure } from './errors.ts';
import { accountUsernameSchema, accountPasswordSchema } from './credential-contract.ts';
export type Role = 'ADMIN' | 'OPERATIONS' | 'DEPOT' | 'DRIVER' | 'CUSTOMER';
export interface Actor {
    id: string;
    orgId: string;
    name: string;
    role: Role;
    driverId: string | null;
    clientId?: string | null;
    isSuperAdmin?: boolean;
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
const sessionCookie = (customer: boolean) => customer ? 'nexora_customer_session' : 'logistics_session';
const sessionTable = (customer: boolean) => customer ? 'customer_sessions' : 'sessions';
function sessionToken(req: Request, customer: boolean) {
    const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(sessionCookie(customer)+'='))?.split('=')[1];
    return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export const staffSessionToken = (req: Request) => sessionToken(req, false);
export async function actorFromRequest(store: Database, req: Request, scope?: 'STAFF' | 'CUSTOMER'): Promise<Actor | null> {
    const staffToken = scope === 'CUSTOMER' ? null : sessionToken(req, false);
    const user = staffToken && await store.one('SELECT u.id,u.org_id,u.name,u.role,u.driver_id,CASE WHEN EXISTS(SELECT 1 FROM org_owners o WHERE o.org_id=u.org_id AND o.user_id=u.id) THEN 1 ELSE 0 END AS is_super_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1', hash(staffToken), new Date().toISOString());
    if(user) return { id: user.id, orgId: user.org_id, name: user.name, role: user.role, driverId: user.driver_id, clientId:null, isSuperAdmin:!!user.is_super_admin };
    const customerToken = scope === 'STAFF' ? null : sessionToken(req, true);
    const account=customerToken && await store.one('SELECT a.id,a.org_id,a.name,a.client_id FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>? AND a.enabled=1',hash(customerToken),new Date().toISOString());
    return account ? {id:account.id,orgId:account.org_id,name:account.name,role:'CUSTOMER',driverId:null,clientId:account.client_id} : null;
}
export async function createSession(store: Database, userId: string, res: Response, customer=false) {
    const token = randomBytes(32).toString('hex');
    const table=sessionTable(customer);
    await store.transaction(async()=>{
        ensure(await store.one(`SELECT id FROM ${customer?'customer_accounts':'users'} WHERE id=? AND enabled=1`,userId),'FORBIDDEN','Usuario o contraseña incorrectos.',401);
        await store.run(`DELETE FROM ${table} WHERE expires_at<=?`, new Date().toISOString());
        await store.run(`INSERT INTO ${table} VALUES(?,?,?)`, hash(token), userId, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString());
    });
    res.cookie(sessionCookie(customer), token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV==='production'||process.env.COOKIE_SECURE === 'true', maxAge: 12 * 60 * 60 * 1000, path: '/' });
}
export async function endSession(store: Database, req: Request, res: Response, customer: boolean) {
    const token = sessionToken(req, customer);
    if (token) await store.run(`DELETE FROM ${sessionTable(customer)} WHERE token_hash=?`, hash(token));
    res.clearCookie(sessionCookie(customer), { path: '/' });
}
export async function setup(store: Database, input: {
    organizationName: string;
    timezone: string;
    username: string;
    password: string;
}) {
    const username = accountUsernameSchema.parse(input.username);
    const password = accountPasswordSchema.parse(input.password);
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
        await store.run('INSERT INTO users(id,org_id,username,name,password_hash,role,driver_id) VALUES(?,?,?,?,?,?,NULL)', userId, orgId, username, 'Administración', passwordHash(password), 'ADMIN');
        return { userId, orgId };
    });
}
export function authorize(actor: Actor, roles: Role[]) { ensure(roles.includes(actor.role), 'FORBIDDEN', 'Tu rol no permite esta operación.', 403); }
