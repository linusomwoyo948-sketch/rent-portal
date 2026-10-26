import { router, json, error, requireAuth, db, notifications, increment, isAppDatabaseError, admin, userIdForEmail } from '../server/platform';

// The site owner admits landlords. Each landlord manages their own plots, tenants and payments.
const SITE_OWNER_EMAILS = ['linusomwoyo96@gmail.com'];
// The original landlord account. Its existing data moves into its first plot on the first run.
const FIRST_LANDLORD_EMAIL = 'linusomwoyo2@gmail.com';

type Role = 'owner' | 'landlord' | 'caretaker' | 'tenant' | 'suspended';
type TenantStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

type Tenant = {
    userId: string;
    email: string;
    name: string;
    phone: string;
    unit: string;
    monthlyRent: number;
    status: TenantStatus;
    createdAt: number;
    approvedAt?: number;
    decidedAt?: number;
    billedTotal?: number;
    paidTotal?: number;
    ledgerVersion?: number;
    lastBilledMonth?: string;
    landlordKey: string;
    plotId: string;
    plotName: string;
    accountNumber?: string;
    tenantPaybill?: string;
};

type PaymentStatus = 'processing' | 'pending' | 'confirmed' | 'rejected' | 'failed';

type Payment = {
    id: string;
    tenantId: string;
    tenantName: string;
    tenantEmail: string;
    unit: string;
    amount: number;
    month: string;
    method: string;
    reference: string;
    status: PaymentStatus;
    channel?: 'mpesa' | 'manual' | 'sms';
    landlordKey?: string;
    plotId?: string;
    plotName?: string;
    payerName?: string;
    smsText?: string;
    matchedBy?: string;
    recipient?: string;
    account?: string;
    warnings?: string[];
    checkoutRequestId?: string;
    mpesaReceipt?: string;
    payerPhone?: string;
    failureReason?: string;
    receiptNo?: string;
    paymentDate?: string;
    hiddenByTenant?: boolean;
    createdAt: number;
    paidAt?: number;
    decidedAt?: number;
};

type Bill = {
    id: string;
    tenantId: string;
    tenantName: string;
    unit: string;
    month: string;
    amount: number;
    createdAt: number;
    plotId?: string;
};

type LandlordRequest = {
    email: string;
    userId: string;
    name: string;
    phone: string;
    location: string;
    plots: string;
    units: string;
    message: string;
    status: 'pending' | 'rejected';
    reason?: string;
    createdAt: number;
    decidedAt?: number;
};

type Landlord = { email: string; name: string; phone: string; status: 'active' | 'suspended'; addedAt: number };

type Plot = {
    name: string;
    nameKey: string;
    landlordKey: string;
    paybillNumber: string;
    paybillName: string;
    paybillAccount: string;
    paymentInstructions: string;
    accountMode?: 'shared' | 'per_tenant' | 'per_tenant_paybill';
    createdAt: number;
};

type PlotName = { plotId: string; landlordKey: string };
type Staff = { email: string; role: 'caretaker'; landlordKey?: string; addedAt: number };
type AlertSubscriber = { email: string; landlordKey?: string; addedAt: number };
type Actor = { role: Role; landlordKey: string; email: string };
type OldSettings = { paymentInstructions?: string; propertyName?: string; paybillNumber?: string; paybillName?: string; paybillAccount?: string };

// ---------- small helpers ----------

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

function clean(value: unknown, max: number): string {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().slice(0, max);
}

function newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function randomToken(): string {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') {
        return c.randomUUID().replace(/-/g, '');
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
    for (let i = 0; i < items.length; i += size) {
        await Promise.all(items.slice(i, i + size).map(fn));
    }
}

async function pageThrough(table: string, maxPages: number): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
        const page = await db.list(table, { limit: 200, nextToken: token });
        out.push(...(page.items as unknown as Record<string, unknown>[]));
        token = page.nextToken;
        pages++;
    } while (token && pages < maxPages);
    return out;
}

function byNewest<T extends { createdAt: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

function compact(s: string): string {
    return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function plotNameKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
}

function fnv32(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}

function landlordKeyOf(email: string): string {
    const e = email.trim().toLowerCase();
    const base = e.replace(/[^a-z0-9]+/g, '_').replace(/^_+/, '').slice(0, 24).replace(/_+$/, '') || 'x';
    return 'll_' + base + '_' + fnv32(e);
}

function staffKey(email: string): string {
    return 'staff_' + email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function tenantKey(userId: string): string {
    return userId.replace(/[^A-Za-z0-9]/g, '');
}

function tenantTable(lk: string): string {
    return 'tenants_' + lk;
}
function plotTable(lk: string): string {
    return 'plots_' + lk;
}
function landlordPayTable(lk: string): string {
    return 'lpay_' + lk;
}
function monthBillTable(lk: string, month: string): string {
    return 'bm_' + lk + '_' + month.replace('-', '');
}
function paymentTable(userId: string): string {
    return 'payments_' + tenantKey(userId);
}
function billTable(userId: string): string {
    return 'bills_' + tenantKey(userId);
}

function makeReceiptNo(p: { id: string; month: string }): string {
    return 'RCT-' + p.month.replace('-', '') + '-' + p.id.slice(-6).toUpperCase();
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(month: string): string {
    const m = Number(month.slice(5, 7));
    return (MONTH_NAMES[m - 1] || month) + ' ' + month.slice(0, 4);
}

function monthOfEAT(ts: number): string {
    const d = new Date(ts + 3 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function nextMonth(m: string): string {
    const [y, mo] = m.split('-').map(Number);
    return mo === 12 ? y + 1 + '-01' : y + '-' + String(mo + 1).padStart(2, '0');
}

function allocate(bills: Bill[], paid: number) {
    const sorted = [...bills].sort((a, b) => a.month.localeCompare(b.month));
    let pool = paid;
    return sorted.map((b) => {
        const applied = Math.max(0, Math.min(pool, b.amount));
        pool -= applied;
        return { month: b.month, amount: b.amount, paid: applied, outstanding: b.amount - applied };
    });
}

// ---------- one-time move of the original single-landlord data ----------

let migrationDone = false;

async function migrateV2(): Promise<void> {
    const lk = landlordKeyOf(FIRST_LANDLORD_EMAIL);
    const [ll] = await db.get<Landlord>('landlords', [lk], { consistent: true });
    if (!ll) {
        await db.tx.update('landlords', [{ id: lk, record: { email: FIRST_LANDLORD_EMAIL, name: '', phone: '', status: 'active', addedAt: Date.now() } }]);
    }
    const [old] = await db.get<OldSettings>('settings', ['main'], { consistent: true });
    const existingPlots = await db.list<Plot>(plotTable(lk), { limit: 10 });
    let plotId: string;
    let plotName: string;
    if (existingPlots.items.length > 0) {
        plotId = existingPlots.items[0].id;
        plotName = existingPlots.items[0].name;
    } else {
        plotName = (old?.propertyName || 'Main Plot').slice(0, 60);
        let key = plotNameKey(plotName) || 'mainplot';
        const [taken] = await db.get<PlotName>('plot_names', [key], { consistent: true });
        if (taken) {
            plotName = plotName + ' ' + randomToken().slice(0, 4).toUpperCase();
            key = plotNameKey(plotName);
        }
        plotId = 'plot_' + newId();
        const plot: Plot = {
            name: plotName,
            nameKey: key,
            landlordKey: lk,
            paybillNumber: old?.paybillNumber ?? '',
            paybillName: old?.paybillName ?? '',
            paybillAccount: old?.paybillAccount ?? '',
            paymentInstructions: old?.paymentInstructions ?? '',
            createdAt: Date.now(),
        };
        await db.tx.update(plotTable(lk), [{ id: plotId, record: plot }]);
        await db.tx.update('plot_names', [{ id: key, record: { plotId, landlordKey: lk } }]);
    }

    const oldTenants = await pageThrough('tenants', 20);
    const tenantIds: string[] = [];
    for (let i = 0; i < oldTenants.length; i += 100) {
        const chunk = oldTenants.slice(i, i + 100).map((item) => {
            const rec: Record<string, unknown> = { ...item, landlordKey: lk, plotId, plotName };
            const userId = String(item.userId || item.id);
            rec.userId = userId;
            delete rec.id;
            tenantIds.push(userId);
            return { id: userId, record: rec };
        });
        await db.tx.update(tenantTable(lk), chunk);
        await db.tx.update(
            'tenant_index',
            chunk.map((c) => ({ id: c.id, record: { landlordKey: lk } }))
        );
    }

    for (const userId of tenantIds) {
        const bills = await db.list<Bill>(billTable(userId), { limit: 200 });
        for (const b of bills.items) {
            await db.tx.update(monthBillTable(lk, b.month), [
                {
                    id: tenantKey(userId),
                    record: { tenantId: b.tenantId, tenantName: b.tenantName, unit: b.unit, month: b.month, amount: b.amount, createdAt: b.createdAt, plotId },
                },
            ]);
        }
    }

    const oldPayments = await pageThrough('all_payments', 20);
    for (let i = 0; i < oldPayments.length; i += 100) {
        const chunk = oldPayments.slice(i, i + 100).map((item) => {
            const rec: Record<string, unknown> = { ...item, landlordKey: lk, plotId, plotName };
            const id = String(item.id);
            delete rec.id;
            return { id, record: rec };
        });
        await db.tx.update(landlordPayTable(lk), chunk);
    }

    const staff = await pageThrough('staff', 5);
    for (const s of staff) {
        if (!s.landlordKey) {
            await db.tx.update('staff', [{ id: String(s.id), record: { landlordKey: lk } }], { patch: true });
        }
    }
    const subs = await pageThrough('alert_subscribers', 5);
    for (const s of subs) {
        if (!s.landlordKey) {
            await db.tx.update('alert_subscribers', [{ id: String(s.id), record: { landlordKey: lk } }], { patch: true });
        }
    }
    const auditRows = await pageThrough('audit_log', 1);
    for (let i = 0; i < auditRows.length; i += 100) {
        const chunk = auditRows.slice(i, i + 100).map((item) => {
            const rec: Record<string, unknown> = { ...item };
            const id = String(item.id);
            delete rec.id;
            return { id, record: rec };
        });
        await db.tx.update('audit_' + lk, chunk);
    }
}

async function ensureMigrated(): Promise<void> {
    if (migrationDone) {
        return;
    }
    const [m] = await db.get<{ status: string; startedAt: number }>('meta', ['migration_v2'], { consistent: true });
    if (m && m.status === 'done') {
        migrationDone = true;
        return;
    }
    if (m && m.status === 'running' && Date.now() - m.startedAt < 120000) {
        return;
    }
    await db.tx.update('meta', [{ id: 'migration_v2', record: { status: 'running', startedAt: Date.now() } }]);
    try {
        await migrateV2();
        await db.tx.update('meta', [{ id: 'migration_v2', record: { status: 'done', startedAt: Date.now() } }]);
        migrationDone = true;
    } catch (e) {
        console.error('Data migration failed', e instanceof Error ? e.message : String(e));
        await db.tx.update('meta', [{ id: 'migration_v2', record: { status: 'failed', startedAt: 0 } }]);
    }
}

// ---------- who is signed in ----------

async function actorForEmail(rawEmail: string): Promise<Actor> {
    const email = rawEmail.trim().toLowerCase();
    if (!email) {
        return { role: 'tenant', landlordKey: '', email };
    }
    if (SITE_OWNER_EMAILS.includes(email)) {
        return { role: 'owner', landlordKey: '', email };
    }
    const lk = landlordKeyOf(email);
    const [ll] = await db.get<Landlord>('landlords', [lk], { consistent: true });
    if (ll) {
        return { role: ll.status === 'active' ? 'landlord' : 'suspended', landlordKey: lk, email };
    }
    const [st] = await db.get<Staff>('staff', [staffKey(email)], { consistent: true });
    if (st && st.landlordKey) {
        const [boss] = await db.get<Landlord>('landlords', [st.landlordKey], { consistent: true });
        return { role: boss && boss.status === 'active' ? 'caretaker' : 'suspended', landlordKey: st.landlordKey, email };
    }
    return { role: 'tenant', landlordKey: '', email };
}

const actorCache = new WeakMap<object, Actor>();

async function getActor(ctx: { user?: { email?: string } }): Promise<Actor> {
    const cached = actorCache.get(ctx);
    if (cached) {
        return cached;
    }
    await ensureMigrated();
    const actor = await actorForEmail(ctx.user?.email ?? '');
    actorCache.set(ctx, actor);
    return actor;
}

const requireSiteOwner = async (ctx: { user?: { email?: string } }) => {
    const a = await getActor(ctx);
    return a.role === 'owner' ? undefined : error('Only the site owner can do this.', 403);
};

const requireStaff = async (ctx: { user?: { email?: string } }) => {
    const a = await getActor(ctx);
    return a.role === 'landlord' || a.role === 'caretaker' ? undefined : error('Only the landlord or caretaker can do this.', 403);
};

const requireLandlord = async (ctx: { user?: { email?: string } }) => {
    const a = await getActor(ctx);
    return a.role === 'landlord' ? undefined : error('Only the landlord can do this.', 403);
};

// ---------- tenants, payments, alerts, audit ----------

async function getTenantIn(lk: string, userId: string): Promise<Tenant | null> {
    const [t] = await db.get<Tenant>(tenantTable(lk), [userId], { consistent: true });
    return t ? { ...t, userId, landlordKey: lk } : null;
}

async function findTenant(userId: string): Promise<Tenant | null> {
    const [idx] = await db.get<{ landlordKey: string }>('tenant_index', [userId], { consistent: true });
    if (!idx || !idx.landlordKey) {
        return null;
    }
    return getTenantIn(idx.landlordKey, userId);
}

async function getPlot(lk: string, plotId: string): Promise<(Plot & { id: string }) | null> {
    if (!plotId) {
        return null;
    }
    const [p] = await db.get<Plot>(plotTable(lk), [plotId], { consistent: true });
    return p ? { ...p, id: plotId } : null;
}

async function updatePayment(p: Payment, lk: string, record: Record<string, unknown>): Promise<void> {
    const ops = [db.tx.update(landlordPayTable(lk), [{ id: p.id, record }], { patch: true })];
    if (p.tenantId) {
        ops.push(db.tx.update(paymentTable(p.tenantId), [{ id: p.id, record }], { patch: true }));
    }
    await db.transact(ops);
}

async function bumpPaid(lk: string, tenantId: string, amount: number): Promise<void> {
    if (!tenantId) {
        return;
    }
    try {
        await db.tx.update(tenantTable(lk), [{ id: tenantId, record: { paidTotal: increment(amount) } }], { patch: true });
    } catch (e) {
        console.warn('Could not update paid total', e instanceof Error ? e.message : String(e));
    }
}

async function audit(scope: string, email: string | undefined, action: string, detail: string): Promise<void> {
    try {
        const now = Date.now();
        const id = String(9999999999999 - now).padStart(13, '0') + randomToken().slice(0, 6);
        await db.tx.add('audit_' + scope, [{ id, at: now, by: (email ?? '').toLowerCase(), action, detail: detail.slice(0, 300) }]);
    } catch (e) {
        console.warn('Audit log write failed', e instanceof Error ? e.message : String(e));
    }
}

async function sendStaffAlert(lk: string, title: string, body: string, ref: string): Promise<void> {
    try {
        const subs = await db.list<AlertSubscriber>('alert_subscribers', { limit: 200 });
        const userIds: string[] = [];
        for (const s of subs.items) {
            if (s.landlordKey !== lk) {
                continue;
            }
            const a = await actorForEmail(s.email);
            if ((a.role === 'landlord' || a.role === 'caretaker') && a.landlordKey === lk) {
                userIds.push(s.id);
            }
        }
        if (userIds.length === 0) {
            return;
        }
        await notifications.send({ userIds, notification: { title, body, url: '/' }, data: { ref }, ttlSeconds: 86400 });
    } catch (e) {
        console.warn('Alert failed', e instanceof Error ? e.message : String(e));
    }
}

// ---------- monthly bills ----------

async function ensureLedger(t: Tenant): Promise<Tenant> {
    if (t.ledgerVersion === 1) {
        return t;
    }
    const r = await db.list<Payment>(paymentTable(t.userId), { limit: 200 });
    const paid = r.items.filter((p) => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0);
    const record = { ledgerVersion: 1, paidTotal: paid, billedTotal: 0 };
    const [ok] = await db.tx.update(tenantTable(t.landlordKey), [{ id: t.userId, record, if: { ledgerVersion: undefined } }], { patch: true });
    if (!ok) {
        return (await getTenantIn(t.landlordKey, t.userId)) ?? t;
    }
    return { ...t, ...record };
}

async function ensureBills(t: Tenant): Promise<Tenant> {
    if ((t.status !== 'approved' && t.status !== 'suspended') || !(t.monthlyRent > 0)) {
        return t;
    }
    const now = monthOfEAT(Date.now());
    const start = monthOfEAT(t.approvedAt || t.createdAt);
    let m = t.lastBilledMonth ? nextMonth(t.lastBilledMonth) : start;
    if (m > now) {
        return t;
    }
    let changed = false;
    let guard = 0;
    while (m <= now && guard < 24) {
        guard++;
        const bill: Bill = {
            id: m,
            tenantId: t.userId,
            tenantName: t.name,
            unit: t.unit,
            month: m,
            amount: t.monthlyRent,
            createdAt: Date.now(),
            plotId: t.plotId,
        };
        try {
            await db.transact([
                db.tx.add(billTable(t.userId), [bill]),
                db.tx.add(monthBillTable(t.landlordKey, m), [{ ...bill, id: tenantKey(t.userId) }]),
                db.tx.update(tenantTable(t.landlordKey), [{ id: t.userId, record: { billedTotal: increment(bill.amount), lastBilledMonth: m } }], {
                    patch: true,
                }),
            ]);
            changed = true;
        } catch (e) {
            if (isAppDatabaseError(e) && (e.code === 'AppDatabaseDuplicateId' || e.code === 'AppDatabaseConditionFailed')) {
                await db.tx.update(tenantTable(t.landlordKey), [{ id: t.userId, record: { lastBilledMonth: m } }], { patch: true });
                changed = true;
            } else {
                console.warn('Billing failed for a tenant', e instanceof Error ? e.message : String(e));
                break;
            }
        }
        m = nextMonth(m);
    }
    if (!changed) {
        return t;
    }
    return (await getTenantIn(t.landlordKey, t.userId)) ?? t;
}

async function refreshTenant(t: Tenant): Promise<Tenant> {
    if (t.status !== 'approved' && t.status !== 'suspended') {
        return t;
    }
    return ensureBills(await ensureLedger(t));
}

async function landlordTenants(lk: string): Promise<Tenant[]> {
    const result = await db.list<Tenant>(tenantTable(lk), { limit: 200 });
    return result.items.map((t) => ({ ...t, userId: t.userId || t.id, landlordKey: lk }) as Tenant);
}

// Scheduled daily (00:10 Nairobi time): issues each month's bill on the 1st and fills any gaps.
export const dailyBills = async () => {
    try {
        await ensureMigrated();
        const landlords = await pageThrough('landlords', 10);
        for (const l of landlords) {
            const tenants = await landlordTenants(String(l.id));
            await inBatches(tenants, 10, async (t) => {
                try {
                    await refreshTenant(t);
                } catch (e) {
                    console.warn('Daily billing skipped a tenant', e instanceof Error ? e.message : String(e));
                }
            });
        }
    } catch (e) {
        console.error('Daily billing failed', e instanceof Error ? e.message : String(e));
    }
    return { statusCode: 200 };
};

// ---------- reading pasted M-Pesa Paybill messages ----------

type ParsedSms = { code: string; amount: number; recipient: string; account: string; paidAt: number };

function businessWords(name: string): string[] {
    const skip = ['LTD', 'LIMITED', 'THE', 'AND', 'COMPANY', 'ENTERPRISES', 'ENTERPRISE'];
    return name
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter((w) => w.length >= 3 && !skip.includes(w));
}

function parseMpesaSms(text: string): ParsedSms | null {
    if (!/(sent|paid) to/i.test(text)) {
        return null;
    }
    const code = text.split(/[^A-Za-z0-9]+/).find((w) => /^[A-Z0-9]{10}$/.test(w) && /[A-Z]/.test(w) && /\d/.test(w));
    const amountMatch = text.match(/(?:Ksh|KES)\s?([\d,]+(?:\.\d{1,2})?)/i);
    if (!code || !amountMatch) {
        return null;
    }
    const amount = Number(amountMatch[1].replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
        return null;
    }
    let recipient = '';
    let account = '';
    const toMatch = text.match(/(?:sent|paid) to\s+(.+?)(?:\s+for account\s+|\s+on\s+\d|\.\s*New|\.\s*$|$)/i);
    if (toMatch) {
        recipient = toMatch[1].trim().replace(/\.$/, '').slice(0, 80);
    }
    const accMatch = text.match(/for account\s+(.+?)(?:\s+on\s+\d|\.\s*New|\.\s*$|$)/i);
    if (accMatch) {
        account = accMatch[1].trim().replace(/\.$/, '').slice(0, 40);
    }
    let paidAt = Date.now();
    const d = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (d) {
        let year = Number(d[3]);
        if (year < 100) {
            year += 2000;
        }
        const ampm = (d[6] || '').toUpperCase();
        let hour = Number(d[4]);
        if (ampm) {
            hour = (hour % 12) + (ampm === 'PM' ? 12 : 0);
        }
        const ts = Date.UTC(year, Number(d[2]) - 1, Number(d[1]), hour - 3, Number(d[5]));
        if (Number.isFinite(ts) && Math.abs(ts - Date.now()) < 400 * 24 * 3600 * 1000) {
            paidAt = ts;
        }
    }
    return { code, amount, recipient, account, paidAt };
}

function modeOf(p: { accountMode?: string }): 'shared' | 'per_tenant' | 'per_tenant_paybill' {
    return p.accountMode === 'per_tenant' || p.accountMode === 'per_tenant_paybill' ? p.accountMode : 'shared';
}

function plotPayload(id: string, p: Plot) {
    return {
        id,
        name: p.name,
        paybillNumber: p.paybillNumber,
        paybillName: p.paybillName,
        paybillAccount: p.paybillAccount,
        paymentInstructions: p.paymentInstructions,
        accountMode: modeOf(p),
        createdAt: p.createdAt,
    };
}

function readPlotBody(body: Record<string, unknown>) {
    return {
        name: clean(body.name, 60),
        paybillNumber: clean(body.paybillNumber, 20).replace(/\D/g, '').slice(0, 10),
        paybillName: clean(body.paybillName, 80),
        paybillAccount: clean(body.paybillAccount, 30),
        paymentInstructions: clean(body.paymentInstructions, 2000),
        accountMode: modeOf({ accountMode: typeof body.accountMode === 'string' ? body.accountMode : '' }),
    };
}

// ---------- routes ----------

// ---------- restoring a backup from the old site ----------

// The old site identified people by its own ids. This site uses an id made from the email address,
// so a backup is converted: every tenant id is replaced using the email stored with it.
const DROPPED_TABLES = new Set(['mpesa_requests', 'stk_attempts']);

function rekeyBackup(input: Record<string, Record<string, unknown>[]>): Record<string, Record<string, unknown>[]> {
    const idMap = new Map<string, string>();
    const note = (oldId: unknown, email: unknown) => {
        if (typeof oldId === 'string' && oldId && typeof email === 'string' && email.includes('@')) {
            idMap.set(oldId, userIdForEmail(email));
        }
    };
    for (const [t, rows] of Object.entries(input)) {
        if (t.startsWith('tenants_')) {
            rows.forEach((r) => note(r.userId || r.id, r.email));
        } else if (t === 'alert_subscribers') {
            rows.forEach((r) => note(r.id, r.email));
        } else if (t === 'landlord_requests') {
            rows.forEach((r) => note(r.userId, r.email));
        }
    }
    const keyMap = new Map<string, string>();
    for (const [o, n] of idMap) {
        keyMap.set(tenantKey(o), tenantKey(n));
    }
    const mapId = (v: unknown) => (typeof v === 'string' && idMap.has(v) ? idMap.get(v)! : v);
    const mapKey = (v: unknown) => (typeof v === 'string' && keyMap.has(v) ? keyMap.get(v)! : v);
    const withTenantId = (r: Record<string, unknown>) => ('tenantId' in r ? { ...r, tenantId: mapId(r.tenantId) } : r);

    const out: Record<string, Record<string, unknown>[]> = {};
    const put = (t: string, rows: Record<string, unknown>[]) => {
        out[t] = (out[t] ?? []).concat(rows);
    };
    for (const [t, rows] of Object.entries(input)) {
        if (DROPPED_TABLES.has(t) || t.startsWith('push_')) {
            continue;
        }
        if (t.startsWith('tenants_')) {
            put(t, rows.map((r) => ({ ...r, id: mapId(r.id), userId: mapId(r.userId || r.id) })));
        } else if (t === 'tenant_index' || t === 'alert_subscribers') {
            put(t, rows.map((r) => ({ ...r, id: mapId(r.id) })));
        } else if (t === 'landlord_requests') {
            put(t, rows.map((r) => ({ ...r, userId: mapId(r.userId) })));
        } else if (t === 'sms_attempts') {
            put(t, rows.map((r) => ({ ...r, id: mapKey(r.id) })));
        } else if (t.startsWith('payments_') || t.startsWith('bills_')) {
            const prefix = t.startsWith('payments_') ? 'payments_' : 'bills_';
            put(prefix + String(mapKey(t.slice(prefix.length))), rows.map(withTenantId));
        } else if (t.startsWith('bm_')) {
            put(t, rows.map((r) => ({ ...withTenantId(r), id: mapKey(r.id) })));
        } else {
            put(t, rows.map(withTenantId));
        }
    }
    return out;
}

export const handler = router({
    'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

    'GET /api/me': [
        requireAuth(),
        async (ctx) => {
            const user = ctx.user!;
            const actor = await getActor(ctx);
            let tenant: Tenant | null = null;
            let plotAvailable = true;
            let landlordRequest: LandlordRequest | null = null;
            if (actor.role === 'tenant') {
                tenant = await findTenant(user.userId);
                if (!tenant) {
                    const [req] = await db.get<LandlordRequest>('landlord_requests', [landlordKeyOf(user.email ?? '')], { consistent: true });
                    landlordRequest = req ?? null;
                }
                if (tenant) {
                    const [ll] = await db.get<Landlord>('landlords', [tenant.landlordKey], { consistent: true });
                    plotAvailable = !!ll && ll.status === 'active';
                    try {
                        tenant = await refreshTenant(tenant);
                    } catch (e) {
                        console.warn('Could not refresh bills', e instanceof Error ? e.message : String(e));
                    }
                }
            }
            return json({
                email: user.email ?? '',
                name: user.name ?? '',
                role: actor.role,
                isAdmin: actor.role === 'landlord' || actor.role === 'caretaker',
                tenant,
                plotAvailable,
                landlordRequest,
            });
        },
    ],

    // A landlord applies for an account. The site owner must approve before they get a landlord page.
    'POST /api/landlord-request': [
        requireAuth(),
        async (ctx) => {
            const user = ctx.user!;
            const actor = await getActor(ctx);
            if (actor.role !== 'tenant') {
                return error('This account already has access to the portal.', 400);
            }
            if (await findTenant(user.userId)) {
                return error('This account is registered as a tenant. Sign in with a different email to apply as a landlord.', 400);
            }
            const email = (user.email ?? '').trim().toLowerCase();
            if (!email) {
                return error('Your sign-in did not provide an email address. Please sign in again with Google, Apple or an email link.', 400);
            }
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const name = clean(body.name, 80);
            const phone = clean(body.phone, 20);
            const location = clean(body.location, 120);
            const plots = clean(body.plots, 300);
            const units = clean(body.units, 20);
            const message = clean(body.message, 1000);
            if (!name || !phone || !location || !plots) {
                return error('Please fill in your full name, phone number, location and the name of your plot or plots.', 400);
            }
            if (phone.replace(/\D/g, '').length < 9) {
                return error('Please enter a valid phone number.', 400);
            }
            const id = landlordKeyOf(email);
            const [existing] = await db.get<LandlordRequest>('landlord_requests', [id], { consistent: true });
            if (existing && existing.status === 'pending') {
                return json({ landlordRequest: existing });
            }
            const record: LandlordRequest = { email, userId: user.userId, name, phone, location, plots, units, message, status: 'pending', createdAt: Date.now() };
            await db.tx.update('landlord_requests', [{ id, record }]);
            await audit('owner', email, 'Landlord application received', name + ' <' + email + '>, ' + location + ', plots: ' + plots);
            return json({ landlordRequest: record }, 201);
        },
    ],

    // Applicant withdraws a pending or declined application.
    'DELETE /api/landlord-request': [
        requireAuth(),
        async (ctx) => {
            const id = landlordKeyOf(ctx.user!.email ?? '');
            await db.delete('landlord_requests', [id]);
            return json({ ok: true });
        },
    ],

    // Tenant asks for access to a plot by its name.
    'POST /api/register': [
        requireAuth(),
        async (ctx) => {
            const user = ctx.user!;
            const actor = await getActor(ctx);
            if (actor.role !== 'tenant') {
                return error('Landlord, caretaker and site owner accounts cannot register as tenants.', 400);
            }
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const plotName = clean(body.plotName, 80);
            const name = clean(body.name, 80);
            const phone = clean(body.phone, 20);
            const unit = clean(body.unit, 40);
            if (!plotName || !name || !phone || !unit) {
                return error('Please fill in the plot name, your full name, phone number and house or unit number.', 400);
            }
            if (phone.replace(/\D/g, '').length < 9) {
                return error('Please enter a valid phone number.', 400);
            }
            const [lr] = await db.get<LandlordRequest>('landlord_requests', [landlordKeyOf(user.email ?? '')], { consistent: true });
            if (lr && lr.status === 'pending') {
                return error('You have a landlord application waiting for approval. Cancel it first if you want to join a plot as a tenant.', 400);
            }
            const key = plotNameKey(plotName);
            const [pn] = key ? await db.get<PlotName>('plot_names', [key], { consistent: true }) : [null];
            if (!pn) {
                return error('No plot named "' + plotName + '" exists. Check the exact plot name with your landlord.', 404);
            }
            const [ll] = await db.get<Landlord>('landlords', [pn.landlordKey], { consistent: true });
            const plot = await getPlot(pn.landlordKey, pn.plotId);
            if (!ll || ll.status !== 'active' || !plot) {
                return error('This plot is not accepting requests right now. Please contact your landlord.', 403);
            }
            const existing = await findTenant(user.userId);
            if (existing) {
                return json({ tenant: existing });
            }
            const tenant: Tenant = {
                userId: user.userId,
                email: (user.email ?? '').toLowerCase(),
                name,
                phone,
                unit,
                monthlyRent: 0,
                status: 'pending',
                createdAt: Date.now(),
                landlordKey: pn.landlordKey,
                plotId: pn.plotId,
                plotName: plot.name,
            };
            const mode = modeOf(plot);
            const givenAccount = clean(body.accountNumber, 30);
            const givenPaybill = clean(body.tenantPaybill, 20).replace(/\D/g, '').slice(0, 10);
            if (mode !== 'shared' && givenAccount) {
                tenant.accountNumber = givenAccount;
            }
            if (mode === 'per_tenant_paybill' && givenPaybill) {
                tenant.tenantPaybill = givenPaybill;
            }
            try {
                await db.transact([
                    db.tx.add('tenant_index', [{ id: user.userId, landlordKey: pn.landlordKey }]),
                    db.tx.add(tenantTable(pn.landlordKey), [{ id: user.userId, ...tenant }]),
                ]);
            } catch (e) {
                if (isAppDatabaseError(e) && e.code === 'AppDatabaseDuplicateId') {
                    return json({ tenant: await findTenant(user.userId) });
                }
                throw e;
            }
            await sendStaffAlert(pn.landlordKey, 'New tenant request: ' + plot.name, name + ' (Unit ' + unit + ') asked for access.', user.userId);
            return json({ tenant }, 201);
        },
    ],

    // Step 1 of sign-up: check that a plot exists before showing its request form.
    'GET /api/plots/lookup': [
        requireAuth(),
        async (ctx) => {
            const name = clean(ctx.query.name, 80);
            const key = plotNameKey(name);
            const [pn] = key ? await db.get<PlotName>('plot_names', [key], { consistent: true }) : [null];
            if (!pn) {
                return error('No plot named "' + name + '" exists. Check the exact plot name with your landlord.', 404);
            }
            const [ll] = await db.get<Landlord>('landlords', [pn.landlordKey], { consistent: true });
            const plot = await getPlot(pn.landlordKey, pn.plotId);
            if (!ll || ll.status !== 'active' || !plot) {
                return error('This plot is not accepting requests right now. Please contact your landlord.', 403);
            }
            return json({ plot: { name: plot.name, accountMode: modeOf(plot), landlordName: ll.name || '' } });
        },
    ],

    // Tenant's plot details (Paybill and instructions).
    'GET /api/settings': [
        requireAuth(),
        async (ctx) => {
            const tenant = await findTenant(ctx.user!.userId);
            const empty = { plotName: '', paybillNumber: '', paybillName: '', paybillAccount: '', paymentInstructions: '' };
            if (!tenant) {
                return json(empty);
            }
            const plot = await getPlot(tenant.landlordKey, tenant.plotId);
            if (!plot) {
                return json({ ...empty, plotName: tenant.plotName || '' });
            }
            const mode = modeOf(plot);
            return json({
                plotName: plot.name,
                paybillNumber: mode === 'per_tenant_paybill' ? tenant.tenantPaybill || '' : plot.paybillNumber,
                paybillName: mode === 'per_tenant_paybill' ? '' : plot.paybillName,
                paybillAccount: mode === 'shared' ? plot.paybillAccount : tenant.accountNumber || '',
                paymentInstructions: plot.paymentInstructions,
                accountMode: mode,
            });
        },
    ],

    'GET /api/payments': [
        requireAuth(),
        async (ctx) => {
            const tenant = await findTenant(ctx.user!.userId);
            if (!tenant || tenant.status !== 'approved') {
                return error('Your account has not been approved yet.', 403);
            }
            const result = await db.list<Payment>(paymentTable(tenant.userId), { limit: 200 });
            return json({ payments: byNewest(result.items) });
        },
    ],

    'GET /api/bills': [
        requireAuth(),
        async (ctx) => {
            let tenant = await findTenant(ctx.user!.userId);
            if (!tenant || tenant.status !== 'approved') {
                return error('Your account has not been approved yet.', 403);
            }
            try {
                tenant = await refreshTenant(tenant);
            } catch (e) {
                console.warn('Could not refresh bills', e instanceof Error ? e.message : String(e));
            }
            const r = await db.list<Bill>(billTable(tenant.userId), { limit: 200 });
            return json({ bills: [...r.items].sort((a, b) => a.month.localeCompare(b.month)) });
        },
    ],

    // Tenant hides a payment from their own history (the landlord keeps the record).
    'DELETE /api/payments/:id': [
        requireAuth(),
        async (ctx) => {
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const tenant = await findTenant(ctx.user!.userId);
            if (!tenant) {
                return error('Payment not found.', 404);
            }
            const [p] = await db.get<Payment>(paymentTable(tenant.userId), [id], { consistent: true });
            if (!p) {
                return error('Payment not found.', 404);
            }
            try {
                await updatePayment({ ...p, id }, tenant.landlordKey, { hiddenByTenant: true });
            } catch {
                await db.tx.update(paymentTable(tenant.userId), [{ id, record: { hiddenByTenant: true } }], { patch: true });
            }
            return json({ ok: true });
        },
    ],

    // Tenant pastes the M-Pesa confirmation message after paying the plot's Paybill. The landlord must approve it.
    'POST /api/payments/sms': [
        requireAuth(),
        async (ctx) => {
            const tenant = await findTenant(ctx.user!.userId);
            if (!tenant || tenant.status !== 'approved') {
                return error('Your account has not been approved for payments yet.', 403);
            }
            const lk = tenant.landlordKey;
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const text = clean(body.text, 1000).replace(/\s+/g, ' ');

            const attemptKey = tenantKey(tenant.userId);
            const [att] = await db.get<{ windowStart: number; count: number }>('sms_attempts', [attemptKey], { consistent: true });
            const nowTs = Date.now();
            const inWindow = att ? nowTs - att.windowStart < 60 * 60 * 1000 : false;
            if (att && inWindow && att.count >= 10) {
                return error('Too many submissions in the last hour. Please try again later.', 429);
            }
            await db.tx.update('sms_attempts', [
                { id: attemptKey, record: { windowStart: att && inWindow ? att.windowStart : nowTs, count: att && inWindow ? att.count + 1 : 1 } },
            ]);

            const parsed = parseMpesaSms(text);
            if (!parsed) {
                return error(
                    'We could not read this message. Paste the full M-Pesa confirmation you received after paying, starting with the transaction code.',
                    400
                );
            }

            const plot = await getPlot(lk, tenant.plotId);
            const warnings: string[] = [];
            if (plot && plot.paybillName && modeOf(plot) !== 'per_tenant_paybill') {
                const want = businessWords(plot.paybillName);
                const got = compact(parsed.recipient);
                if (want.length > 0 && !want.some((w) => got.includes(w))) {
                    warnings.push('Paid to "' + parsed.recipient + '", which does not match this plot\'s Paybill name.');
                }
            }
            const perTenant = !!plot && modeOf(plot) !== 'shared';
            const expectedAccount = perTenant ? tenant.accountNumber || '' : plot ? plot.paybillAccount : '';
            if (expectedAccount) {
                if (!parsed.account) {
                    warnings.push('The message has no account number.');
                } else if (compact(parsed.account) !== compact(expectedAccount)) {
                    warnings.push(
                        'Account number "' +
                            parsed.account +
                            '" does not match ' +
                            (perTenant ? 'this tenant\'s account number ' : 'this plot\'s account number ') +
                            expectedAccount +
                            '.'
                    );
                }
            }
            if (nowTs - parsed.paidAt > 60 * 24 * 3600 * 1000) {
                warnings.push('This payment is more than 60 days old.');
            }

            const payment: Payment = {
                id: newId(),
                tenantId: tenant.userId,
                tenantName: tenant.name,
                tenantEmail: tenant.email,
                unit: tenant.unit,
                amount: parsed.amount,
                month: monthOfEAT(parsed.paidAt),
                method: 'M-Pesa Paybill',
                reference: parsed.code,
                status: 'pending',
                channel: 'sms',
                landlordKey: lk,
                plotId: tenant.plotId,
                plotName: plot ? plot.name : tenant.plotName,
                mpesaReceipt: parsed.code,
                payerName: tenant.name,
                matchedBy: 'tenant',
                recipient: parsed.recipient,
                account: parsed.account,
                warnings,
                smsText: text.replace(/New (M-PESA|Account) balance.*$/i, '').trim().slice(0, 400),
                paidAt: parsed.paidAt,
                createdAt: nowTs,
            };
            try {
                await db.transact([
                    db.tx.add('sms_codes', [{ id: parsed.code, paymentId: payment.id, at: nowTs }]),
                    db.tx.add(landlordPayTable(lk), [payment]),
                    db.tx.add(paymentTable(tenant.userId), [payment]),
                ]);
            } catch (e) {
                if (isAppDatabaseError(e) && e.code === 'AppDatabaseDuplicateId') {
                    return error('This M-Pesa code has already been submitted.', 409);
                }
                throw e;
            }
            await sendStaffAlert(
                lk,
                'Unit ' + tenant.unit + ' paid KES ' + parsed.amount.toLocaleString('en-KE') + ' (awaiting approval)',
                tenant.name +
                    ' (' +
                    (payment.plotName || 'plot') +
                    ', Unit ' +
                    tenant.unit +
                    ') submitted M-Pesa code ' +
                    parsed.code +
                    (warnings.length > 0 ? '. Please check: ' + warnings[0] : '. Open the portal to approve.'),
                payment.id
            );
            return json({ payment }, 201);
        },
    ],

    // ----- landlord and caretaker -----

    'GET /api/admin/plots': [
        requireAuth(),
        requireStaff,
        async (ctx) => {
            const actor = await getActor(ctx);
            const result = await db.list<Plot>(plotTable(actor.landlordKey), { limit: 100 });
            const plots = result.items.map((p) => plotPayload(p.id, p)).sort((a, b) => a.name.localeCompare(b.name));
            return json({ plots });
        },
    ],

    'GET /api/admin/tenants': [
        requireAuth(),
        requireStaff,
        async (ctx) => {
            const actor = await getActor(ctx);
            const base = await landlordTenants(actor.landlordKey);
            const tenants: Tenant[] = [];
            await inBatches(base, 10, async (t) => {
                try {
                    tenants.push(await refreshTenant(t));
                } catch (e) {
                    console.warn('Could not refresh bills', e instanceof Error ? e.message : String(e));
                    tenants.push(t);
                }
            });
            return json({ tenants: byNewest(tenants) });
        },
    ],

    'GET /api/admin/tenants/:id/payments': [
        requireAuth(),
        requireStaff,
        async (ctx) => {
            const actor = await getActor(ctx);
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const tenant = await getTenantIn(actor.landlordKey, id);
            if (!tenant) {
                return error('Tenant not found.', 404);
            }
            let fresh = tenant;
            try {
                fresh = await refreshTenant(tenant);
            } catch (e) {
                console.warn('Could not refresh bills', e instanceof Error ? e.message : String(e));
            }
            const [result, bills] = await Promise.all([
                db.list<Payment>(paymentTable(id), { limit: 200 }),
                db.list<Bill>(billTable(id), { limit: 200 }),
            ]);
            return json({
                tenant: fresh,
                payments: byNewest(result.items),
                bills: [...bills.items].sort((a, b) => a.month.localeCompare(b.month)),
            });
        },
    ],

    'POST /api/admin/tenants/:id/status': [
        requireAuth(),
        requireStaff,
        async (ctx) => {
            const actor = await getActor(ctx);
            const lk = actor.landlordKey;
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const status = clean(body.status, 20);
            if (!['approved', 'rejected', 'suspended'].includes(status)) {
                return error('Invalid status.', 400);
            }
            const existing = await getTenantIn(lk, id);
            if (!existing) {
                return error('Tenant not found.', 404);
            }
            const now = Date.now();
            const record: Record<string, unknown> = { status, decidedAt: now };
            if (status === 'approved') {
                const rent = Number(body.monthlyRent ?? existing.monthlyRent);
                if (!Number.isFinite(rent) || rent <= 0) {
                    return error('Set the monthly rent before approving this tenant.', 400);
                }
                record.monthlyRent = Math.round(rent);
                const acct = clean(body.accountNumber, 30);
                if (acct) {
                    record.accountNumber = acct;
                }
                const ownPaybill = clean(body.tenantPaybill, 20).replace(/\D/g, '').slice(0, 10);
                if (ownPaybill) {
                    record.tenantPaybill = ownPaybill;
                }
                if (!existing.approvedAt) {
                    record.approvedAt = existing.status === 'approved' || existing.status === 'suspended' ? existing.createdAt : now;
                }
            }
            const [ok] = await db.tx.update(tenantTable(lk), [{ id, record }], { patch: true });
            if (!ok) {
                return error('Tenant not found.', 404);
            }
            let updated = { ...existing, ...record, userId: id } as Tenant;
            try {
                updated = await refreshTenant(updated);
            } catch (e) {
                console.warn('Could not create bills', e instanceof Error ? e.message : String(e));
            }
            await audit(
                lk,
                ctx.user!.email,
                status === 'approved' ? 'Tenant approved or rent set' : status === 'rejected' ? 'Tenant declined' : 'Tenant suspended',
                existing.name + ' (' + existing.plotName + ', Unit ' + existing.unit + ')' + (status === 'approved' ? ', rent KES ' + String(record.monthlyRent) : '')
            );
            return json({ tenant: updated });
        },
    ],

    // Set a tenant's own Paybill account number (for plots where each tenant has one).
    'POST /api/admin/tenants/:id/account': [
        requireAuth(),
        requireStaff,
        async (ctx) => {
            const actor = await getActor(ctx);
            const lk = actor.landlordKey;
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const tenant = await getTenantIn(lk, id);
            if (!tenant) {
                return error('Tenant not found.', 404);
            }
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const acct = clean(body.accountNumber, 30);
            const record: Record<string, unknown> = { accountNumber: acct };
            if (typeof body.tenantPaybill === 'string') {
                record.tenantPaybill = clean(body.tenantPaybill, 20).replace(/\D/g, '').slice(0, 10);
            }
            await db.tx.update(tenantTable(lk), [{ id, record }], { patch: true });
            await audit(
                lk,
                actor.email,
                'Payment details set',
                tenant.name +
                    ' (Unit ' +
                    tenant.unit +
                    '): ' +
                    (record.tenantPaybill ? 'Paybill ' + String(record.tenantPaybill) + ', ' : '') +
                    'account ' +
                    (acct || '(cleared)')
            );
            return json({ tenant: { ...tenant, ...record } });
        },
    ],

    'GET /api/admin/arrears': [
        requireAuth(),
        requireStaff,
        async (ctx) => {
            const actor = await getActor(ctx);
            const base = await landlordTenants(actor.landlordKey);
            const rows: { tenant: Tenant; owed: number; unpaidMonths: ReturnType<typeof allocate> }[] = [];
            await inBatches(base, 10, async (item) => {
                let t = item;
                if (t.status !== 'approved' && t.status !== 'suspended') {
                    return;
                }
                try {
                    t = await refreshTenant(t);
                } catch (e) {
                    console.warn('Could not refresh bills', e instanceof Error ? e.message : String(e));
                }
                const owed = (t.billedTotal || 0) - (t.paidTotal || 0);
                if (owed <= 0) {
                    return;
                }
                const bills = await db.list<Bill>(billTable(t.userId), { limit: 200 });
                rows.push({ tenant: t, owed, unpaidMonths: allocate(bills.items, t.paidTotal || 0).filter((l) => l.outstanding > 0) });
            });
            rows.sort((a, b) => b.owed - a.owed);
            return json({ arrears: rows });
        },
    ],

    'GET /api/admin/payments': [
        requireAuth(),
        requireStaff,
        async (ctx) => {
            const actor = await getActor(ctx);
            const result = await db.list<Payment>(landlordPayTable(actor.landlordKey), { limit: 200 });
            return json({ payments: byNewest(result.items) });
        },
    ],

    'GET /api/admin/alerts': [
        requireAuth(),
        requireStaff,
        async (ctx) => {
            const [sub] = await db.get<AlertSubscriber>('alert_subscribers', [ctx.user!.userId], { consistent: true });
            return json({ enabled: !!sub });
        },
    ],

    'POST /api/admin/alerts': [
        requireAuth(),
        requireStaff,
        async (ctx) => {
            const actor = await getActor(ctx);
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const userId = ctx.user!.userId;
            if (body.enabled === true) {
                await db.tx.update('alert_subscribers', [
                    { id: userId, record: { email: actor.email, landlordKey: actor.landlordKey, addedAt: Date.now() } },
                ]);
                return json({ enabled: true });
            }
            await db.delete('alert_subscribers', [userId]);
            return json({ enabled: false });
        },
    ],

    // ----- landlord only -----

    // Checks a plot name while the landlord types it, before saving.
    'GET /api/admin/plots/name-check': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const name = clean(ctx.query.name, 60);
            const plotId = clean(ctx.query.plotId, 80);
            const key = plotNameKey(name);
            if (key.length < 2) {
                return json({ available: false, message: 'Enter a plot name with at least two letters or numbers.' });
            }
            const [pn] = await db.get<PlotName>('plot_names', [key], { consistent: true });
            if (!pn || (pn.landlordKey === actor.landlordKey && pn.plotId === plotId)) {
                return json({ available: true, message: '' });
            }
            if (pn.landlordKey === actor.landlordKey) {
                return json({ available: false, message: 'You already have a plot named "' + name + '". Choose a different name.' });
            }
            return json({
                available: false,
                message: 'The plot name "' + name + '" already exists in the system. Please choose a different name, for example by adding the area or street.',
            });
        },
    ],

    'POST /api/admin/plots': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const lk = actor.landlordKey;
            const v = readPlotBody((ctx.body ?? {}) as Record<string, unknown>);
            const key = plotNameKey(v.name);
            if (!v.name || key.length < 2) {
                return error('Enter a plot name with at least two letters or numbers.', 400);
            }
            const plotId = 'plot_' + newId();
            const plot: Plot = { ...v, nameKey: key, landlordKey: lk, createdAt: Date.now() };
            try {
                await db.transact([
                    db.tx.add('plot_names', [{ id: key, plotId, landlordKey: lk }]),
                    db.tx.add(plotTable(lk), [{ id: plotId, ...plot }]),
                ]);
            } catch (e) {
                if (isAppDatabaseError(e) && e.code === 'AppDatabaseDuplicateId') {
                    return error('The plot name "' + v.name + '" already exists in the system. Please choose a different name, for example by adding the area or street.', 409);
                }
                throw e;
            }
            await audit(lk, actor.email, 'Plot created', v.name);
            return json({ plot: plotPayload(plotId, plot) }, 201);
        },
    ],

    'PUT /api/admin/plots/:id': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const lk = actor.landlordKey;
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const plot = await getPlot(lk, id);
            if (!plot) {
                return error('Plot not found.', 404);
            }
            const v = readPlotBody((ctx.body ?? {}) as Record<string, unknown>);
            const key = plotNameKey(v.name);
            if (!v.name || key.length < 2) {
                return error('Enter a plot name with at least two letters or numbers.', 400);
            }
            const record: Record<string, unknown> = { ...v, nameKey: key };
            if (key !== plot.nameKey) {
                try {
                    await db.transact([
                        db.tx.add('plot_names', [{ id: key, plotId: id, landlordKey: lk }]),
                        db.tx.update(plotTable(lk), [{ id, record }], { patch: true }),
                    ]);
                } catch (e) {
                    if (isAppDatabaseError(e) && e.code === 'AppDatabaseDuplicateId') {
                        return error('The plot name "' + v.name + '" already exists in the system. Please choose a different name, for example by adding the area or street.', 409);
                    }
                    throw e;
                }
                await db.delete('plot_names', [plot.nameKey]);
            } else {
                await db.tx.update(plotTable(lk), [{ id, record }], { patch: true });
            }
            if (v.name !== plot.name) {
                const tenants = (await landlordTenants(lk)).filter((t) => t.plotId === id);
                for (let i = 0; i < tenants.length; i += 100) {
                    await db.tx.update(
                        tenantTable(lk),
                        tenants.slice(i, i + 100).map((t) => ({ id: t.userId, record: { plotName: v.name } })),
                        { patch: true }
                    );
                }
            }
            await audit(lk, actor.email, 'Plot updated', v.name + (v.name !== plot.name ? ' (renamed from ' + plot.name + ')' : ''));
            return json({ plot: plotPayload(id, { ...plot, ...v, nameKey: key }) });
        },
    ],

    'DELETE /api/admin/plots/:id': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const lk = actor.landlordKey;
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const plot = await getPlot(lk, id);
            if (!plot) {
                return error('Plot not found.', 404);
            }
            const tenants = (await landlordTenants(lk)).filter((t) => t.plotId === id);
            if (tenants.length > 0) {
                return error('This plot still has ' + tenants.length + ' tenant(s). Remove them before deleting the plot.', 400);
            }
            await db.delete(plotTable(lk), [id]);
            await db.delete('plot_names', [plot.nameKey]);
            await audit(lk, actor.email, 'Plot deleted', plot.name);
            return json({ ok: true });
        },
    ],

    'DELETE /api/admin/tenants/:id': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const lk = actor.landlordKey;
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const tenant = await getTenantIn(lk, id);
            if (!tenant) {
                return error('Tenant not found.', 404);
            }
            const payments = (await pageThrough(paymentTable(id), 20)) as unknown as Payment[];
            const bills = (await pageThrough(billTable(id), 20)) as unknown as Bill[];
            const safeDelete = async (table: string, ids: string[]) => {
                for (let i = 0; i < ids.length; i += 100) {
                    try {
                        await db.delete(table, ids.slice(i, i + 100));
                    } catch (e) {
                        console.warn('Tenant removal: could not delete some records', e instanceof Error ? e.message : String(e));
                    }
                }
            };
            const paymentIds = payments.map((p) => p.id);
            await safeDelete(paymentTable(id), paymentIds);
            await safeDelete(landlordPayTable(lk), paymentIds);
            await safeDelete(
                'sms_codes',
                payments.filter((p) => p.channel === 'sms' && p.mpesaReceipt).map((p) => p.mpesaReceipt as string)
            );
            await safeDelete(
                billTable(id),
                bills.map((b) => b.id)
            );
            await Promise.all(bills.map((b) => safeDelete(monthBillTable(lk, b.month), [tenantKey(id)])));
            await safeDelete('sms_attempts', [tenantKey(id)]);
            await safeDelete('tenant_index', [id]);
            await db.delete(tenantTable(lk), [id]);
            await audit(lk, actor.email, 'Tenant removed', tenant.name + ' (' + tenant.plotName + ', Unit ' + tenant.unit + ') and all their records were deleted');
            return json({ ok: true });
        },
    ],

    'DELETE /api/admin/payments/:id': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const lk = actor.landlordKey;
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const [p] = await db.get<Payment>(landlordPayTable(lk), [id], { consistent: true });
            if (!p) {
                return error('Payment not found.', 404);
            }
            await db.delete(landlordPayTable(lk), [id]);
            if (p.tenantId) {
                await db.delete(paymentTable(p.tenantId), [id]);
            }
            if (p.status === 'confirmed') {
                await bumpPaid(lk, p.tenantId, -p.amount);
            }
            await audit(lk, actor.email, 'Payment deleted', p.tenantName + ' (Unit ' + p.unit + '), KES ' + p.amount + ' for ' + monthLabel(p.month));
            return json({ ok: true });
        },
    ],

    'POST /api/admin/payments/:id/status': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const lk = actor.landlordKey;
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const status = clean(body.status, 20);
            if (!['confirmed', 'rejected'].includes(status)) {
                return error('Invalid status.', 400);
            }
            const [p] = await db.get<Payment>(landlordPayTable(lk), [id], { consistent: true });
            if (!p) {
                return error('Payment not found.', 404);
            }
            const payment: Payment = { ...p, id };
            if (payment.channel === 'mpesa' && payment.status === 'confirmed') {
                return error('This M-Pesa payment was confirmed by Safaricom and cannot be changed.', 400);
            }
            let target: Payment = payment;
            const assignId = clean(body.tenantId, 80);
            if (status === 'confirmed' && payment.status !== 'confirmed' && (assignId || !payment.tenantId)) {
                const tid = assignId || payment.tenantId;
                if (!tid || !SAFE_ID.test(tid)) {
                    return error('Choose which tenant this payment belongs to before approving.', 400);
                }
                if (tid !== payment.tenantId) {
                    const tenant = await getTenantIn(lk, tid);
                    if (!tenant) {
                        return error('Tenant not found.', 404);
                    }
                    const fields = {
                        tenantId: tid,
                        tenantName: tenant.name,
                        tenantEmail: tenant.email,
                        unit: tenant.unit,
                        plotId: tenant.plotId,
                        plotName: tenant.plotName,
                    };
                    target = { ...payment, ...fields };
                    await db.transact([
                        db.tx.update(landlordPayTable(lk), [{ id, record: fields }], { patch: true }),
                        db.tx.add(paymentTable(tid), [{ ...target }]),
                    ]);
                    if (payment.tenantId) {
                        await db.delete(paymentTable(payment.tenantId), [id]);
                    }
                }
            }
            const now = Date.now();
            const record: Record<string, unknown> =
                status === 'confirmed'
                    ? { status, decidedAt: now, paidAt: target.paidAt || now, receiptNo: target.receiptNo || makeReceiptNo(target) }
                    : { status, decidedAt: now };
            await updatePayment(target, lk, record);
            if (status === 'confirmed' && payment.status !== 'confirmed') {
                await bumpPaid(lk, target.tenantId, target.amount);
            } else if (status === 'rejected' && payment.status === 'confirmed') {
                await bumpPaid(lk, target.tenantId, -target.amount);
            }
            await audit(
                lk,
                actor.email,
                status === 'confirmed' ? 'Payment approved' : 'Payment rejected',
                target.tenantName + ' (Unit ' + target.unit + '), KES ' + target.amount + (target.mpesaReceipt ? ', M-Pesa ' + target.mpesaReceipt : '')
            );
            return json({ payment: { ...target, ...record } });
        },
    ],

    'GET /api/admin/reports': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const lk = actor.landlordKey;
            const requested = ctx.query.year || '';
            const year = /^\d{4}$/.test(requested) ? requested : String(new Date().getFullYear());
            const all = (await pageThrough(landlordPayTable(lk), 10)) as unknown as Payment[];
            const payments = all.filter((p) => p.status === 'confirmed' && typeof p.month === 'string' && p.month.startsWith(year));
            const tenants = await landlordTenants(lk);
            const nowMonth = monthOfEAT(Date.now());
            const months: string[] = [];
            for (let i = 1; i <= 12; i++) {
                const m = year + '-' + String(i).padStart(2, '0');
                if (m <= nowMonth) {
                    months.push(m);
                }
            }
            const pages = await Promise.all(months.map((m) => db.list<Bill>(monthBillTable(lk, m), { limit: 200 })));
            const bills: Bill[] = [];
            pages.forEach((page) => page.items.forEach((b) => bills.push({ ...b, id: b.month })));
            return json({ year, payments: byNewest(payments), tenants, bills, truncated: false });
        },
    ],

    'GET /api/admin/audit': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const r = await db.list<{ at: number; by: string; action: string; detail: string }>('audit_' + actor.landlordKey, { limit: 100 });
            return json({ entries: [...r.items].sort((a, b) => b.at - a.at) });
        },
    ],

    'GET /api/admin/staff': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const all = (await pageThrough('staff', 5)) as unknown as (Staff & { id: string })[];
            const staff = all.filter((s) => s.landlordKey === actor.landlordKey).sort((a, b) => a.addedAt - b.addedAt);
            return json({ staff });
        },
    ],

    'POST /api/admin/staff': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const email = clean(body.email, 120).toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return error('Enter a valid email address for the caretaker.', 400);
            }
            const other = await actorForEmail(email);
            if (other.role === 'owner' || other.role === 'landlord' || (other.role === 'suspended' && other.landlordKey === landlordKeyOf(email))) {
                return error('That email belongs to a landlord or the site owner.', 400);
            }
            const [existing] = await db.get<Staff>('staff', [staffKey(email)], { consistent: true });
            if (existing && existing.landlordKey && existing.landlordKey !== actor.landlordKey) {
                return error('That email is already a caretaker for another landlord.', 400);
            }
            const record: Staff = { email, role: 'caretaker', landlordKey: actor.landlordKey, addedAt: Date.now() };
            await db.tx.update('staff', [{ id: staffKey(email), record }]);
            await audit(actor.landlordKey, actor.email, 'Caretaker added', email);
            return json({ staff: { ...record, id: staffKey(email) } }, 201);
        },
    ],

    'DELETE /api/admin/staff/:id': [
        requireAuth(),
        requireLandlord,
        async (ctx) => {
            const actor = await getActor(ctx);
            const staffId = ctx.params.id;
            if (!/^staff_[a-z0-9_]{1,120}$/.test(staffId)) {
                return error('Invalid request.', 400);
            }
            const [member] = await db.get<Staff>('staff', [staffId], { consistent: true });
            if (!member || member.landlordKey !== actor.landlordKey) {
                return error('Caretaker not found.', 404);
            }
            await db.delete('staff', [staffId]);
            await audit(actor.landlordKey, actor.email, 'Caretaker removed', member.email);
            return json({ ok: true });
        },
    ],

    // ----- site owner -----

    'GET /api/owner/landlords': [
        requireAuth(),
        requireSiteOwner,
        async () => {
            const list = (await pageThrough('landlords', 10)) as unknown as (Landlord & { id: string })[];
            const rows: Record<string, unknown>[] = [];
            await inBatches(list, 5, async (l) => {
                const [plots, tenants] = await Promise.all([
                    db.list<Plot>(plotTable(l.id), { limit: 100 }),
                    db.list<Tenant>(tenantTable(l.id), { limit: 200 }),
                ]);
                rows.push({
                    id: l.id,
                    email: l.email,
                    name: l.name,
                    phone: l.phone,
                    status: l.status,
                    addedAt: l.addedAt,
                    plots: plots.items.map((p) => p.name).sort(),
                    tenantCount: tenants.items.filter((t) => t.status === 'approved' || t.status === 'suspended').length,
                    pendingCount: tenants.items.filter((t) => t.status === 'pending').length,
                    totalCount: tenants.items.length,
                });
            });
            rows.sort((a, b) => Number(b.addedAt) - Number(a.addedAt));
            return json({ landlords: rows });
        },
    ],

    'POST /api/owner/landlords': [
        requireAuth(),
        requireSiteOwner,
        async (ctx) => {
            const actor = await getActor(ctx);
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const email = clean(body.email, 120).toLowerCase();
            const name = clean(body.name, 80);
            const phone = clean(body.phone, 20);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return error('Enter a valid email address for the landlord.', 400);
            }
            if (!name) {
                return error('Enter the landlord\'s name.', 400);
            }
            if (SITE_OWNER_EMAILS.includes(email)) {
                return error('That is the site owner account.', 400);
            }
            const [st] = await db.get<Staff>('staff', [staffKey(email)], { consistent: true });
            if (st) {
                return error('That email is a caretaker for a landlord. Ask the landlord to remove it first.', 400);
            }
            const lk = landlordKeyOf(email);
            const record: Landlord = { email, name, phone, status: 'active', addedAt: Date.now() };
            const [created] = await db.tx.add('landlords', [{ id: lk, ...record }]);
            if (!created) {
                return error('This email is already a landlord.', 409);
            }
            await db.delete('landlord_requests', [lk]);
            await audit('owner', actor.email, 'Landlord added', name + ' <' + email + '>');
            return json({ landlord: { ...record, id: lk, plots: [], tenantCount: 0, pendingCount: 0, totalCount: 0 } }, 201);
        },
    ],

    'POST /api/owner/landlords/:id/status': [
        requireAuth(),
        requireSiteOwner,
        async (ctx) => {
            const actor = await getActor(ctx);
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const status = clean(body.status, 20);
            if (status !== 'active' && status !== 'suspended') {
                return error('Invalid status.', 400);
            }
            const [l] = await db.get<Landlord>('landlords', [id], { consistent: true });
            if (!l) {
                return error('Landlord not found.', 404);
            }
            await db.tx.update('landlords', [{ id, record: { status } }], { patch: true });
            await audit('owner', actor.email, status === 'active' ? 'Landlord reactivated' : 'Landlord suspended', l.name + ' <' + l.email + '>');
            return json({ ok: true, status });
        },
    ],

    'DELETE /api/owner/landlords/:id': [
        requireAuth(),
        requireSiteOwner,
        async (ctx) => {
            const actor = await getActor(ctx);
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const [l] = await db.get<Landlord>('landlords', [id], { consistent: true });
            if (!l) {
                return error('Landlord not found.', 404);
            }
            const tenants = await db.list<Tenant>(tenantTable(id), { limit: 1 });
            if (tenants.items.length > 0) {
                return error('This landlord still has tenants. Suspend the landlord instead, or ask them to remove their tenants first.', 400);
            }
            const plots = await db.list<Plot>(plotTable(id), { limit: 100 });
            for (const p of plots.items) {
                await db.delete('plot_names', [p.nameKey]);
            }
            if (plots.items.length > 0) {
                await db.delete(
                    plotTable(id),
                    plots.items.map((p) => p.id)
                );
            }
            const staff = (await pageThrough('staff', 5)) as unknown as (Staff & { id: string })[];
            const theirs = staff.filter((s) => s.landlordKey === id).map((s) => s.id);
            if (theirs.length > 0) {
                await db.delete('staff', theirs);
            }
            await db.delete('landlords', [id]);
            await audit('owner', actor.email, 'Landlord removed', l.name + ' <' + l.email + '>');
            return json({ ok: true });
        },
    ],

    'GET /api/owner/requests': [
        requireAuth(),
        requireSiteOwner,
        async () => {
            const all = (await pageThrough('landlord_requests', 5)) as unknown as (LandlordRequest & { id: string })[];
            const requests = all.filter((r) => r.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
            return json({ requests });
        },
    ],

    'POST /api/owner/requests/:id/approve': [
        requireAuth(),
        requireSiteOwner,
        async (ctx) => {
            const actor = await getActor(ctx);
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const [req] = await db.get<LandlordRequest>('landlord_requests', [id], { consistent: true });
            if (!req || req.status !== 'pending') {
                return error('This application is no longer waiting for approval.', 404);
            }
            const [st] = await db.get<Staff>('staff', [staffKey(req.email)], { consistent: true });
            if (st) {
                return error('That email is now a caretaker for a landlord. Ask the landlord to remove it first.', 400);
            }
            if (req.userId && (await findTenant(req.userId))) {
                return error('That email has since joined a plot as a tenant, so it cannot also be a landlord.', 400);
            }
            const lk = landlordKeyOf(req.email);
            const record: Landlord = { email: req.email, name: req.name, phone: req.phone, status: 'active', addedAt: Date.now() };
            const [created] = await db.tx.add('landlords', [{ id: lk, ...record }]);
            await db.delete('landlord_requests', [id]);
            if (!created) {
                return error('This email is already a landlord.', 409);
            }
            await audit('owner', actor.email, 'Landlord application approved', req.name + ' <' + req.email + '>');
            return json({ landlord: { ...record, id: lk, plots: [], tenantCount: 0, pendingCount: 0, totalCount: 0 } }, 201);
        },
    ],

    'POST /api/owner/requests/:id/decline': [
        requireAuth(),
        requireSiteOwner,
        async (ctx) => {
            const actor = await getActor(ctx);
            const id = ctx.params.id;
            if (!SAFE_ID.test(id)) {
                return error('Invalid request.', 400);
            }
            const [req] = await db.get<LandlordRequest>('landlord_requests', [id], { consistent: true });
            if (!req || req.status !== 'pending') {
                return error('This application is no longer waiting for approval.', 404);
            }
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const reason = clean(body.reason, 300);
            await db.tx.update('landlord_requests', [{ id, record: { status: 'rejected', reason, decidedAt: Date.now() } }], { patch: true });
            await audit('owner', actor.email, 'Landlord application declined', req.name + ' <' + req.email + '>' + (reason ? ': ' + reason : ''));
            return json({ ok: true });
        },
    ],

    // Full backup of every landlord, plot, tenant, bill and payment (site owner only).
    'GET /api/owner/export': [
        requireAuth(),
        requireSiteOwner,
        async (ctx) => {
            const actor = await getActor(ctx);
            const all = await admin.dump();
            const tables: Record<string, Record<string, unknown>[]> = {};
            for (const [t, rows] of Object.entries(all)) {
                if (t.startsWith('push_')) {
                    continue;
                }
                tables[t] = t === 'meta' ? rows.filter((r) => r.id !== 'vapid') : rows;
            }
            await audit('owner', actor.email, 'Backup downloaded', Object.keys(tables).length + ' tables');
            return json({ format: 'rent-portal-backup', version: 1, exportedAt: Date.now(), tables });
        },
    ],

    // Replaces all data with a backup file (for example the one downloaded from the old site).
    'POST /api/owner/import': [
        requireAuth(),
        requireSiteOwner,
        async (ctx) => {
            const actor = await getActor(ctx);
            const body = (ctx.body ?? {}) as { confirm?: string; backup?: { format?: string; tables?: unknown } };
            if (body.confirm !== 'REPLACE') {
                return error('Type REPLACE to confirm.', 400);
            }
            const b = body.backup;
            if (!b || b.format !== 'rent-portal-backup' || !b.tables || typeof b.tables !== 'object') {
                return error('This is not a Rent Portal backup file.', 400);
            }
            const incoming = b.tables as Record<string, Record<string, unknown>[]>;
            for (const rows of Object.values(incoming)) {
                if (!Array.isArray(rows)) {
                    return error('The backup file is damaged.', 400);
                }
            }
            const tables = rekeyBackup(incoming);
            // Keep this site's own phone-alert keys and devices.
            const current = await admin.dump();
            for (const [t, rows] of Object.entries(current)) {
                if (t.startsWith('push_')) {
                    tables[t] = rows;
                }
            }
            const vapid = (current.meta ?? []).find((r) => r.id === 'vapid');
            tables.meta = (tables.meta ?? []).filter((r) => r.id !== 'migration_v2' && r.id !== 'vapid');
            tables.meta.push({ id: 'migration_v2', status: 'done', startedAt: Date.now() });
            if (vapid) {
                tables.meta.push(vapid);
            }
            const count = await admin.replaceAll(tables);
            migrationDone = true;
            await audit('owner', actor.email, 'Backup restored', count + ' records');
            return json({ ok: true, records: count, tables: Object.keys(tables).length });
        },
    ],

    'GET /api/owner/audit': [
        requireAuth(),
        requireSiteOwner,
        async () => {
            const r = await db.list<{ at: number; by: string; action: string; detail: string }>('audit_owner', { limit: 100 });
            return json({ entries: [...r.items].sort((a, b) => b.at - a.at) });
        },
    ],
});
