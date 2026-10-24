// Platform layer: routing, sign-in checks, database and phone alerts.
// On Netlify it uses Supabase (set SUPABASE_URL and SUPABASE_SECRET_KEY).
// Without those settings (npm run local) it keeps data in local-data.json for testing.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';

type Rec = Record<string, unknown>;

// ---------- user ids ----------

// Each person is identified by their verified email address.
export function userIdForEmail(email: string): string {
    return 'u' + createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24);
}

// ---------- errors ----------

type DbErrorCode = 'AppDatabaseDuplicateId' | 'AppDatabaseConditionFailed';

class AppDatabaseError extends Error {
    code: DbErrorCode;
    statusCode = 409;
    details: Record<string, unknown> = {};
    constructor(code: DbErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

export function isAppDatabaseError(e: unknown): e is AppDatabaseError {
    return e instanceof AppDatabaseError;
}

export function translateError(message: string): Error {
    if (message.includes('KV_DUPLICATE')) {
        return new AppDatabaseError('AppDatabaseDuplicateId', message);
    }
    if (message.includes('KV_CONDITION')) {
        return new AppDatabaseError('AppDatabaseConditionFailed', message);
    }
    return new Error(message);
}

// ---------- increment and wire format ----------

const INC = Symbol('increment');
type IncrementValue = { [INC]: number };

export function increment(amount: number): IncrementValue {
    return { [INC]: amount };
}

function isIncrement(v: unknown): v is IncrementValue {
    return typeof v === 'object' && v !== null && INC in v;
}

function encodeRecord(record: Rec): Rec {
    const out: Rec = {};
    for (const [k, v] of Object.entries(record)) {
        if (v === undefined) {
            out[k] = { $unset: true };
        } else if (isIncrement(v)) {
            out[k] = { $inc: v[INC] };
        } else {
            out[k] = v;
        }
    }
    return out;
}

function encodeCondition(cond?: Rec): Rec | undefined {
    if (!cond) {
        return undefined;
    }
    const out: Rec = {};
    for (const [k, v] of Object.entries(cond)) {
        out[k] = v === undefined ? { $absent: true } : v;
    }
    return out;
}

type WireOp = { kind: 'add' | 'update' | 'delete'; tbl: string; patch?: boolean; items: Rec[] };

// ---------- storage drivers ----------

export type Driver = {
    apply(ops: WireOp[], atomic: boolean): Promise<unknown[][]>;
    get(tbl: string, ids: string[]): Promise<Map<string, Rec>>;
    list(tbl: string, offset: number, limit: number): Promise<{ rows: { id: string; data: Rec }[]; more: boolean }>;
    dump(): Promise<Record<string, Rec[]>>;
    replaceAll(dump: Record<string, Rec[]>): Promise<number>;
    verifyToken(token: string): Promise<{ email: string; name: string } | null>;
};

function clone<T>(v: T): T {
    return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

// Same rules as kv_apply in supabase/schema.sql, kept in memory and saved to local-data.json.
function localDriver(): Driver {
    const file = resolve(process.cwd(), 'local-data.json');
    let store: Record<string, Record<string, Rec>> = {};
    if (existsSync(file)) {
        try {
            store = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
            store = {};
        }
    }
    const save = () => writeFileSync(file, JSON.stringify(store, null, 2));
    const table = (t: string) => (store[t] ??= {});

    function run(op: WireOp, atomic: boolean): unknown[] {
        const t = table(op.tbl);
        if (op.kind === 'add') {
            return op.items.map((it) => {
                const id = String(it.id);
                if (t[id]) {
                    if (atomic) {
                        throw translateError('KV_DUPLICATE:' + op.tbl + ':' + id);
                    }
                    return null;
                }
                t[id] = clone((it.record as Rec) ?? {});
                return id;
            });
        }
        if (op.kind === 'update') {
            return op.items.map((it) => {
                const id = String(it.id);
                const cur = t[id];
                let ok = !(op.patch && !cur);
                const cond = it.if as Rec | undefined;
                if (ok && cond) {
                    for (const [k, v] of Object.entries(cond)) {
                        const absent = typeof v === 'object' && v !== null && '$absent' in v;
                        if (absent ? cur && k in cur : !cur || !(k in cur) || JSON.stringify(cur[k]) !== JSON.stringify(v)) {
                            ok = false;
                        }
                    }
                }
                if (!ok) {
                    if (atomic) {
                        throw translateError('KV_CONDITION:' + op.tbl + ':' + id);
                    }
                    return false;
                }
                const next: Rec = op.patch && cur ? { ...cur } : {};
                for (const [k, v] of Object.entries((it.record as Rec) ?? {})) {
                    if (k === 'id') {
                        continue;
                    }
                    if (typeof v === 'object' && v !== null && '$inc' in v) {
                        next[k] = (typeof next[k] === 'number' ? (next[k] as number) : 0) + Number((v as Rec).$inc);
                    } else if (typeof v === 'object' && v !== null && '$unset' in v) {
                        delete next[k];
                    } else {
                        next[k] = clone(v);
                    }
                }
                t[id] = next;
                return true;
            });
        }
        return op.items.map((it) => {
            const id = String(it.id);
            const had = !!t[id];
            delete t[id];
            return had;
        });
    }

    return {
        async apply(ops, atomic) {
            const backup = atomic ? clone(store) : null;
            try {
                const out = ops.map((op) => run(op, atomic));
                save();
                return out;
            } catch (e) {
                if (backup) {
                    store = backup;
                }
                throw e;
            }
        },
        async get(tbl, ids) {
            const t = table(tbl);
            const m = new Map<string, Rec>();
            ids.forEach((id) => t[id] && m.set(id, clone(t[id])));
            return m;
        },
        async list(tbl, offset, limit) {
            const t = table(tbl);
            const ids = Object.keys(t).sort();
            return { rows: ids.slice(offset, offset + limit).map((id) => ({ id, data: clone(t[id]) })), more: offset + limit < ids.length };
        },
        async dump() {
            const out: Record<string, Rec[]> = {};
            for (const [tbl, rows] of Object.entries(store)) {
                const list = Object.keys(rows)
                    .sort()
                    .map((id) => ({ ...rows[id], id }));
                if (list.length) {
                    out[tbl] = list;
                }
            }
            return out;
        },
        async replaceAll(dump) {
            store = {};
            let n = 0;
            for (const [tbl, rows] of Object.entries(dump)) {
                for (const r of rows) {
                    const { id, ...data } = r;
                    if (typeof id === 'string' || typeof id === 'number') {
                        table(tbl)[String(id)] = data;
                        n++;
                    }
                }
            }
            save();
            return n;
        },
        // Local test sign-in: the browser sends "local:<email>".
        async verifyToken(token) {
            if (!token.startsWith('local:')) {
                return null;
            }
            const email = decodeURIComponent(token.slice(6)).trim().toLowerCase();
            return email ? { email, name: email.split('@')[0] } : null;
        },
    };
}

function supabaseDriver(url: string, key: string): Driver {
    const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const tokenCache = new Map<string, { at: number; user: { email: string; name: string } }>();

    return {
        async apply(ops, atomic) {
            const { data, error } = await sb.rpc('kv_apply', { ops, atomic });
            if (error) {
                throw translateError(error.message);
            }
            return data as unknown[][];
        },
        async get(tbl, ids) {
            const m = new Map<string, Rec>();
            for (let i = 0; i < ids.length; i += 100) {
                const chunk = ids.slice(i, i + 100);
                const { data, error } = await sb.from('kv').select('id,data').eq('tbl', tbl).in('id', chunk);
                if (error) {
                    throw new Error(error.message);
                }
                (data ?? []).forEach((r: { id: string; data: Rec }) => m.set(r.id, r.data));
            }
            return m;
        },
        async list(tbl, offset, limit) {
            const { data, error } = await sb
                .from('kv')
                .select('id,data')
                .eq('tbl', tbl)
                .order('id')
                .range(offset, offset + limit);
            if (error) {
                throw new Error(error.message);
            }
            const rows = (data ?? []) as { id: string; data: Rec }[];
            return { rows: rows.slice(0, limit), more: rows.length > limit };
        },
        async dump() {
            const { data, error } = await sb.rpc('kv_dump');
            if (error) {
                throw new Error(error.message);
            }
            return (data ?? {}) as Record<string, Rec[]>;
        },
        async replaceAll(dump) {
            const { data, error } = await sb.rpc('kv_replace_all', { dump });
            if (error) {
                throw new Error(error.message);
            }
            return Number(data);
        },
        async verifyToken(token) {
            const hit = tokenCache.get(token);
            if (hit && Date.now() - hit.at < 5 * 60 * 1000) {
                return hit.user;
            }
            const { data, error } = await sb.auth.getUser(token);
            if (error || !data.user || !data.user.email) {
                return null;
            }
            const meta = (data.user.user_metadata ?? {}) as Rec;
            const user = {
                email: data.user.email.toLowerCase(),
                name: String(meta.full_name || meta.name || data.user.email.split('@')[0]),
            };
            if (tokenCache.size > 500) {
                tokenCache.clear();
            }
            tokenCache.set(token, { at: Date.now(), user });
            return user;
        },
    };
}

let driverInstance: Driver | null = null;

// Used only by automated tests to plug in a different database.
export function setDriverForTests(d: Driver): void {
    driverInstance = d;
}
function driver(): Driver {
    if (!driverInstance) {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
        driverInstance = url && key ? supabaseDriver(url, key) : localDriver();
    }
    return driverInstance;
}

// ---------- db (same interface the app was written for) ----------

type UpdateItem = { id: string; record: Rec; if?: Rec };

class Operation<T> implements PromiseLike<T> {
    wire: WireOp;
    private promise: Promise<T> | null = null;
    constructor(wire: WireOp) {
        this.wire = wire;
    }
    private start(): Promise<T> {
        if (!this.promise) {
            this.promise = driver()
                .apply([this.wire], false)
                .then((r) => r[0] as T);
        }
        return this.promise;
    }
    then<A = T, B = never>(onOk?: ((v: T) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
        return this.start().then(onOk, onErr);
    }
    catch<B = never>(onErr?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<T | B> {
        return this.start().catch(onErr);
    }
    finally(fn?: (() => void) | null): Promise<T> {
        return this.start().finally(fn);
    }
}

function newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const db = {
    tx: {
        add(tbl: string, records: Rec[]) {
            return new Operation<(string | null)[]>({
                kind: 'add',
                tbl,
                items: records.map((r) => {
                    const { id, ...rest } = r;
                    return { id: typeof id === 'string' && id ? id : newId(), record: encodeRecord(rest) };
                }),
            });
        },
        update(tbl: string, items: UpdateItem[], options?: { patch?: boolean }) {
            return new Operation<boolean[]>({
                kind: 'update',
                tbl,
                patch: !!options?.patch,
                items: items.map((it) => {
                    const w: Rec = { id: it.id, record: encodeRecord(it.record) };
                    const c = encodeCondition(it.if);
                    if (c) {
                        w.if = c;
                    }
                    return w;
                }),
            });
        },
        delete(tbl: string, ids: string[]) {
            return new Operation<boolean[]>({ kind: 'delete', tbl, items: ids.map((id) => ({ id })) });
        },
    },

    // All operations succeed together or none are kept.
    async transact(ops: readonly Operation<unknown>[]): Promise<unknown[]> {
        return driver().apply(
            ops.map((o) => o.wire),
            true
        );
    },

    async add(tbl: string, records: Rec[]): Promise<(string | null)[]> {
        return db.tx.add(
            tbl,
            records.map(({ id: _id, ...r }) => r)
        );
    },

    async get<T = Rec>(tbl: string, ids: string[], _options?: { consistent?: boolean }): Promise<(T | null)[]> {
        const m = await driver().get(tbl, ids);
        return ids.map((id) => (m.has(id) ? (m.get(id) as T) : null));
    },

    async list<T = Rec>(tbl: string, options?: { nextToken?: string; limit?: number }): Promise<{ items: (T & { id: string })[]; nextToken?: string }> {
        const offset = options?.nextToken ? Number(options.nextToken) || 0 : 0;
        const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
        const { rows, more } = await driver().list(tbl, offset, limit);
        return {
            items: rows.map((r) => ({ ...(r.data as T), id: r.id })),
            nextToken: more ? String(offset + limit) : undefined,
        };
    },

    async delete(tbl: string, ids: string[]): Promise<boolean[]> {
        if (ids.length === 0) {
            return [];
        }
        return db.tx.delete(tbl, ids);
    },
};

// Whole-database backup and restore (used only by site-owner routes).
export const admin = {
    dump: () => driver().dump(),
    replaceAll: (tables: Record<string, Rec[]>) => driver().replaceAll(tables),
};

// ---------- phone alerts (web push) ----------

async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
    const [saved] = await db.get<{ publicKey: string; privateKey: string }>('meta', ['vapid']);
    if (saved) {
        return saved;
    }
    const keys = webpush.generateVAPIDKeys();
    await db.tx.add('meta', [{ id: 'vapid', ...keys }]);
    const [stored] = await db.get<{ publicKey: string; privateKey: string }>('meta', ['vapid']);
    return stored ?? keys;
}

function subId(endpoint: string): string {
    return createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
}

export const notifications = {
    async send(params: { userIds: string[]; notification?: { title: string; body: string; url?: string }; data?: Record<string, string>; ttlSeconds?: number }) {
        const n = params.notification;
        if (!n) {
            return { sent: 0, failed: 0 };
        }
        const keys = await vapidKeys();
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:linusomwoyo96@gmail.com', keys.publicKey, keys.privateKey);
        const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url || '/' });
        let sent = 0;
        let failed = 0;
        for (const uid of params.userIds) {
            const subs = await db.list<{ sub: webpush.PushSubscription }>('push_' + uid, { limit: 20 });
            for (const s of subs.items) {
                try {
                    await webpush.sendNotification(s.sub, payload, { TTL: params.ttlSeconds ?? 86400 });
                    sent++;
                } catch (e) {
                    failed++;
                    const status = (e as { statusCode?: number }).statusCode;
                    if (status === 404 || status === 410) {
                        await db.delete('push_' + uid, [s.id]);
                    }
                }
            }
        }
        if (!process.env.SUPABASE_URL) {
            console.log('[phone alert] ' + n.title + ' | ' + n.body);
        }
        return { sent, failed };
    },
};

// ---------- router ----------

export type AuthUser = { userId: string; email?: string; name?: string; scope: string };

export type LocalEvent = {
    method: string;
    rawPath: string;
    headers: Record<string, string | undefined>;
    query: Record<string, string>;
    body: unknown;
};

export type RouterContext = {
    body: unknown;
    query: Record<string, string>;
    params: Record<string, string>;
    event: LocalEvent;
    user?: AuthUser;
};

export type RouterResponse = { statusCode: number; headers: Record<string, string>; body: string };
export type RouterMiddleware = (ctx: RouterContext) => Promise<RouterResponse | void> | RouterResponse | void;

export function json(data: unknown, status = 200): RouterResponse {
    return { statusCode: status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(data) };
}

export function error(message: string, status = 400): RouterResponse {
    return json({ error: message }, status);
}

export function requireAuth(): RouterMiddleware {
    return async (ctx) => {
        const h = ctx.event.headers.authorization || '';
        const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
        const found = token ? await driver().verifyToken(token) : null;
        if (!found) {
            return error('Please sign in.', 401);
        }
        ctx.user = { userId: userIdForEmail(found.email), email: found.email, name: found.name, scope: 'openid email profile' };
        return undefined;
    };
}

export function requireAdminEmailAllowlist(adminEmails: string[]): RouterMiddleware {
    return (ctx) => {
        const email = (ctx.user?.email || '').toLowerCase();
        return adminEmails.map((e) => e.toLowerCase()).includes(email) ? undefined : error('Forbidden', 403);
    };
}

// Routes every page needs for phone alerts, added to the app's own routes.
const builtInRoutes: Record<string, RouterMiddleware[]> = {
    'GET /api/push/key': [requireAuth(), async () => json({ publicKey: (await vapidKeys()).publicKey })],
    'POST /api/push/subscribe': [
        requireAuth(),
        async (ctx) => {
            const sub = ((ctx.body ?? {}) as Rec).subscription as { endpoint?: string; keys?: Rec } | undefined;
            if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys) {
                return error('Invalid subscription.', 400);
            }
            await db.tx.update('push_' + ctx.user!.userId, [{ id: subId(sub.endpoint), record: { sub, at: Date.now() } }]);
            return json({ ok: true });
        },
    ],
};

export function router(routes: Record<string, RouterMiddleware[]>) {
    const compiled = Object.entries({ ...builtInRoutes, ...routes }).map(([key, chain]) => {
        const [method, pattern] = key.split(' ');
        const names: string[] = [];
        const re = new RegExp(
            '^' +
                pattern.replace(/:([A-Za-z_]+)/g, (_m, n: string) => {
                    names.push(n);
                    return '([^/]+)';
                }) +
                '$'
        );
        return { method, re, names, chain };
    });

    return async (event: LocalEvent): Promise<RouterResponse> => {
        for (const r of compiled) {
            if (r.method !== event.method) {
                continue;
            }
            const m = event.rawPath.match(r.re);
            if (!m) {
                continue;
            }
            const params: Record<string, string> = {};
            r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
            const ctx: RouterContext = { body: event.body, query: event.query, params, event };
            try {
                for (const mw of r.chain) {
                    const res = await mw(ctx);
                    if (res) {
                        return res;
                    }
                }
                return error('No response', 500);
            } catch (e) {
                console.error(e);
                return error('Something went wrong on the server. Please try again.', 500);
            }
        }
        return error('Not found', 404);
    };
}
