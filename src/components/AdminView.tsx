import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, notifications } from '../platform/client';
import {
    AlertCircle,
    Bell,
    BellOff,
    Building2,
    CheckCircle2,
    FileSpreadsheet,
    FileText,
    Loader2,
    Pencil,
    Plus,
    Radio,
    Receipt,
    Settings,
    ShieldCheck,
    Trash2,
    UserCheck,
    UserPlus,
    Users,
    Wallet,
} from 'lucide-react';
import StatusBadge from './StatusBadge';
import ReceiptModal from './Receipt';
import StatementModal from './Statement';
import Reports from './Reports';
import { DialogHost, askDialog, confirmDialog } from './Dialog';
import type { AccountMode, Bill, Payment, PaymentStatus, Plot, Staff, Tenant, TenantStatus } from '../types';
import { currentMonth, errorMessage, formatDateTime, formatKES, formatMonth, formatPhone } from '../util';

type Tab = 'payments' | 'requests' | 'tenants' | 'arrears' | 'reports' | 'settings';

type ArrearsRow = {
    tenant: Tenant;
    owed: number;
    unpaidMonths: { month: string; amount: number; paid: number; outstanding: number }[];
};

type Props = { role: 'landlord' | 'caretaker' };

export default function AdminView({ role }: Props) {
    const isLandlord = role === 'landlord';
    const [tab, setTab] = useState<Tab>('payments');
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [plots, setPlots] = useState<Plot[]>([]);
    const [plotFilter, setPlotFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [filter, setFilter] = useState<'all' | PaymentStatus>('all');
    const [lastUpdated, setLastUpdated] = useState<number | null>(null);
    const [receipt, setReceipt] = useState<Payment | null>(null);
    const [statement, setStatement] = useState<{ tenant: Tenant; payments: Payment[]; bills: Bill[] } | null>(null);
    const [statementLoading, setStatementLoading] = useState<string | null>(null);
    const knownConfirmed = useRef<Set<string> | null>(null);
    const noticeTimer = useRef<number | null>(null);
    const tick = useRef(0);

    function flash(message: string) {
        setNotice(message);
        setError('');
        if (noticeTimer.current) {
            window.clearTimeout(noticeTimer.current);
        }
        noticeTimer.current = window.setTimeout(() => setNotice(''), 6000);
    }

    const load = useCallback(async (silent: boolean) => {
        if (!silent) {
            setLoading(true);
        }
        try {
            tick.current += 1;
            const withTenants = !silent || tick.current % 6 === 0;
            const [p, t, pl] = await Promise.all([
                api.get('/api/admin/payments'),
                withTenants ? api.get('/api/admin/tenants') : Promise.resolve(null),
                silent ? Promise.resolve(null) : api.get('/api/admin/plots'),
            ]);
            const list = p.data.payments as Payment[];
            const confirmedIds = new Set(list.filter((x) => x.status === 'confirmed').map((x) => x.id));
            const pendingIds = new Set(list.filter((x) => x.status === 'pending').map((x) => x.id));
            if (knownConfirmed.current) {
                const known = knownConfirmed.current;
                const fresh = list.filter((x) => x.status === 'pending' && !known.has(x.id));
                if (fresh.length === 1) {
                    flash('New payment to approve: ' + formatKES(fresh[0].amount) + ' from Unit ' + fresh[0].unit + ' (' + fresh[0].tenantName + ').');
                } else if (fresh.length > 1) {
                    flash(fresh.length + ' new payments to approve.');
                }
            }
            knownConfirmed.current = new Set([...confirmedIds, ...pendingIds]);
            setPayments(list);
            if (t) {
                setTenants(t.data.tenants as Tenant[]);
            }
            if (pl) {
                setPlots(pl.data.plots as Plot[]);
            }
            setLastUpdated(Date.now());
            if (!silent) {
                setError('');
            }
        } catch (e) {
            if (!silent) {
                setError(errorMessage(e));
            }
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        load(false);
        const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                load(true);
            }
        }, 10000);
        return () => window.clearInterval(interval);
    }, [load]);

    async function decideTenant(id: string, status: TenantStatus, monthlyRent?: number, accountNumber?: string, tenantPaybill?: string) {
        const res = await api.post('/api/admin/tenants/' + id + '/status', { status, monthlyRent, accountNumber, tenantPaybill });
        const updated = res.data.tenant as Tenant;
        setTenants((prev) => prev.map((t) => (t.userId === id ? updated : t)));
    }

    async function runTenantAction(t: Tenant, status: TenantStatus, message: string, confirmText?: string) {
        if (confirmText && !(await confirmDialog(confirmText, { confirmLabel: 'Yes, suspend', danger: true }))) {
            return;
        }
        try {
            await decideTenant(t.userId, status, t.monthlyRent || undefined);
            flash(message);
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    async function changeRent(t: Tenant) {
        const value = await askDialog({
            title: 'Monthly rent for ' + t.name,
            message: 'The new amount applies from the next monthly bill.',
            confirmLabel: t.status === 'rejected' ? 'Approve tenant' : 'Save rent',
            input: { label: 'Monthly rent (KES)', defaultValue: String(t.monthlyRent || ''), numeric: true },
        });
        if (value === null) {
            return;
        }
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) {
            setError('Enter a valid rent amount.');
            return;
        }
        try {
            await decideTenant(t.userId, 'approved', n);
            flash('Rent updated for ' + t.name + '.');
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    async function editAccount(t: Tenant) {
        let paybill: string | undefined;
        if (modeFor(t.plotId) === 'per_tenant_paybill') {
            const p = await askDialog({
                title: 'Paybill number for ' + t.name,
                message: 'The Paybill number this tenant pays to. It is shown on their Pay rent tab.',
                confirmLabel: 'Next',
                input: { label: 'Paybill number', defaultValue: t.tenantPaybill || '', numeric: true },
            });
            if (p === null) {
                return;
            }
            paybill = p;
        }
        const value = await askDialog({
            title: 'Account number for ' + t.name,
            message: 'The account number this tenant must enter when paying the Paybill. It is shown on their Pay rent tab.',
            confirmLabel: 'Save',
            input: { label: 'Account number', defaultValue: t.accountNumber || t.unit },
        });
        if (value === null) {
            return;
        }
        try {
            const res = await api.post('/api/admin/tenants/' + t.userId + '/account', { accountNumber: value, tenantPaybill: paybill });
            const updated = res.data.tenant as Tenant;
            setTenants((prev) =>
                prev.map((x) => (x.userId === t.userId ? { ...x, accountNumber: updated.accountNumber, tenantPaybill: updated.tenantPaybill } : x))
            );
            flash('Account number saved for ' + t.name + '.');
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    async function openStatement(t: Tenant) {
        setStatementLoading(t.userId);
        try {
            const res = await api.get('/api/admin/tenants/' + t.userId + '/payments');
            setStatement({
                tenant: res.data.tenant as Tenant,
                payments: res.data.payments as Payment[],
                bills: (res.data.bills as Bill[]) || [],
            });
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setStatementLoading(null);
        }
    }

    async function decidePayment(p: Payment, status: 'confirmed' | 'rejected', tenantId?: string) {
        if (
            status === 'rejected' &&
            !(await confirmDialog('Reject this payment of ' + formatKES(p.amount) + ' from ' + p.tenantName + '?', { confirmLabel: 'Reject payment', danger: true }))
        ) {
            return;
        }
        try {
            const res = await api.post('/api/admin/payments/' + p.id + '/status', { status, tenantId });
            const updated = res.data.payment as Payment;
            setPayments((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
            flash(status === 'confirmed' ? 'Payment approved.' : 'Payment rejected.');
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    async function deletePayment(p: Payment) {
        if (
            !(await confirmDialog(
                'Permanently delete the ' + formatKES(p.amount) + ' payment from ' + p.tenantName + ' (' + formatMonth(p.month) + ')? It will be removed for you and the tenant. This cannot be undone.',
                { title: 'Delete payment', confirmLabel: 'Delete payment', danger: true }
            ))
        ) {
            return;
        }
        try {
            await api.delete('/api/admin/payments/' + p.id);
            setPayments((prev) => prev.filter((x) => x.id !== p.id));
            flash('Payment deleted.');
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    async function removeTenant(t: Tenant) {
        const typed = await askDialog({
            title: 'Remove ' + t.name + '?',
            message:
                (t.plotName ? t.plotName + ', ' : '') +
                'Unit ' +
                t.unit +
                '.\n\nThis permanently deletes their account, bills, payments and receipts, including from your reports. They will have to request access again. This cannot be undone.',
            confirmLabel: 'Remove tenant',
            danger: true,
            input: { label: 'Type REMOVE to confirm', placeholder: 'REMOVE', requireText: 'REMOVE' },
        });
        if (typed === null) {
            return;
        }
        try {
            await api.delete('/api/admin/tenants/' + t.userId);
            setTenants((prev) => prev.filter((x) => x.userId !== t.userId));
            setPayments((prev) => prev.filter((x) => x.tenantId !== t.userId));
            flash(t.name + ' has been removed from the system.');
        } catch (e) {
            setError('Could not remove ' + t.name + ': ' + errorMessage(e));
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const closeReceipt = useCallback(() => setReceipt(null), []);
    const closeStatement = useCallback(() => setStatement(null), []);

    const plotNameById = new Map(plots.map((p) => [p.id, p.name] as [string, string]));
    function modeFor(plotId?: string): AccountMode {
        return plots.find((p) => p.id === (plotId || ''))?.accountMode || 'shared';
    }
    const isPerTenant = (plotId?: string) => modeFor(plotId) !== 'shared';
    const tenantPlot = new Map(tenants.map((t) => [t.userId, t.plotId || ''] as [string, string]));
    const paymentPlot = (p: Payment) => p.plotId || tenantPlot.get(p.tenantId) || '';
    const inPlot = (plotId: string) => plotFilter === 'all' || plotId === plotFilter;

    const tenantsF = tenants.filter((t) => inPlot(t.plotId || ''));
    const paymentsF = payments.filter((p) => inPlot(paymentPlot(p)));

    const thisMonth = currentMonth();
    const pending = tenantsF.filter((t) => t.status === 'pending');
    const others = tenantsF.filter((t) => t.status !== 'pending');
    const active = tenantsF.filter((t) => t.status === 'approved');
    const totalOwed = tenantsF
        .filter((t) => t.status === 'approved' || t.status === 'suspended')
        .reduce((s, t) => s + Math.max((t.billedTotal || 0) - (t.paidTotal || 0), 0), 0);
    const collectedThisMonth = paymentsF.filter((p) => p.status === 'confirmed' && p.month === thisMonth).reduce((sum, p) => sum + p.amount, 0);
    const awaitingApproval = paymentsF.filter((p) => p.status === 'pending');
    const visiblePayments = filter === 'all' ? paymentsF.filter((p) => p.status !== 'pending') : paymentsF.filter((p) => p.status === filter);

    const stats = [
        { label: 'Collected ' + formatMonth(thisMonth), value: formatKES(collectedThisMonth) },
        { label: 'Active tenants', value: String(active.length) },
        { label: 'Access requests', value: String(pending.length) },
        { label: 'Total owed by tenants', value: formatKES(totalOwed) },
    ];

    const allTabs: { id: Tab; label: string; icon: typeof Users; count?: number; landlordOnly?: boolean }[] = [
        { id: 'payments', label: 'Payments', icon: Receipt, count: awaitingApproval.length },
        { id: 'requests', label: 'Requests', icon: UserCheck, count: pending.length },
        { id: 'tenants', label: 'Tenants', icon: Users },
        { id: 'arrears', label: 'Arrears', icon: Wallet },
        { id: 'reports', label: 'Reports', icon: FileSpreadsheet, landlordOnly: true },
        { id: 'settings', label: 'Plots & team', icon: Settings, landlordOnly: true },
    ];
    const tabs = allTabs.filter((t) => isLandlord || !t.landlordOnly);

    return (
        <div className='space-y-6'>
            <div className='flex flex-wrap items-end justify-between gap-3'>
                <div>
                    <h1 className='text-2xl font-bold'>{isLandlord ? 'Landlord' : 'Caretaker'}</h1>
                    <p className='text-sm text-slate-600'>Approve tenants and rent payments for your plots.</p>
                </div>
                <div className='flex flex-wrap items-center gap-3'>
                    {plots.length > 1 && (
                        <select
                            value={plotFilter}
                            onChange={(e) => setPlotFilter(e.target.value)}
                            className='rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm'
                            aria-label='Plot'
                        >
                            <option value='all'>All plots</option>
                            {plots.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    )}
                    {lastUpdated && (
                        <p className='flex items-center gap-1.5 text-xs text-slate-500'>
                            <Radio className='h-3.5 w-3.5 text-emerald-600' />
                            Live · updated {new Date(lastUpdated).toLocaleTimeString('en-GB')}
                        </p>
                    )}
                </div>
            </div>

            {!loading && plots.length === 0 && (
                <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900'>
                    <p className='flex items-center gap-2'>
                        <Building2 className='h-4 w-4' />
                        {isLandlord
                            ? 'Create your first plot so tenants can request access by entering its name.'
                            : 'Your landlord has not created any plots yet.'}
                    </p>
                    {isLandlord && (
                        <button onClick={() => setTab('settings')} className='rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700'>
                            Create a plot
                        </button>
                    )}
                </div>
            )}

            <AlertsToggle />

            <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
                {stats.map((s) => (
                    <div key={s.label} className='rounded-xl border border-slate-200 bg-white p-4'>
                        <p className='text-xs text-slate-500'>{s.label}</p>
                        <p className='mt-1 text-lg font-bold sm:text-xl'>{s.value}</p>
                    </div>
                ))}
            </div>

            {error && (
                <p role='alert' className='flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>
                    <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
                    {error}
                </p>
            )}
            {notice && (
                <p className='flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700'>
                    <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0' />
                    {notice}
                </p>
            )}

            <div className='flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1'>
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={
                            'flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ' +
                            (tab === t.id ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50')
                        }
                    >
                        <t.icon className='h-4 w-4' />
                        {t.label}
                        {t.count ? (
                            <span className={'rounded-full px-1.5 text-xs ' + (tab === t.id ? 'bg-white/25' : 'bg-amber-100 text-amber-700')}>{t.count}</span>
                        ) : null}
                    </button>
                ))}
            </div>

            {tab === 'reports' && isLandlord ? (
                <Reports plots={plots} />
            ) : loading ? (
                <div className='flex justify-center py-16'>
                    <Loader2 className='h-6 w-6 animate-spin text-slate-400' />
                </div>
            ) : (
                <>
                    {tab === 'payments' && (
                        <div className='space-y-4'>
                            <AwaitingApproval
                                items={awaitingApproval}
                                tenants={tenantsF}
                                isLandlord={isLandlord}
                                plotNameOf={(p) => p.plotName || plotNameById.get(paymentPlot(p)) || ''}
                                onDecide={decidePayment}
                            />
                            <div className='rounded-2xl border border-slate-200 bg-white'>
                                <div className='flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4'>
                                    <h2 className='font-semibold'>Rent payments</h2>
                                    <select
                                        value={filter}
                                        onChange={(e) => setFilter(e.target.value as 'all' | PaymentStatus)}
                                        className='rounded-lg border border-slate-300 px-3 py-1.5 text-sm'
                                    >
                                        <option value='all'>All decided payments</option>
                                        <option value='pending'>Awaiting approval</option>
                                        <option value='confirmed'>Paid</option>
                                        <option value='rejected'>Rejected</option>
                                    </select>
                                </div>
                                {visiblePayments.length === 0 ? (
                                    <Empty text='No payments in this view yet.' />
                                ) : (
                                    <ul className='divide-y divide-slate-100'>
                                        {visiblePayments.map((p) => (
                                            <li key={p.id} className='flex flex-wrap items-center justify-between gap-3 p-4'>
                                                <div className='min-w-0'>
                                                    <p className='font-medium'>
                                                        {p.tenantName}{' '}
                                                        <span className='text-sm font-normal text-slate-500'>
                                                            · {plotNameById.get(paymentPlot(p)) || p.plotName || ''} Unit {p.unit}
                                                        </span>
                                                    </p>
                                                    <p className='text-xs text-slate-500'>
                                                        {formatMonth(p.month)} · {p.method}
                                                        {p.mpesaReceipt || p.reference ? ' · ' + (p.mpesaReceipt || p.reference) : ''} ·{' '}
                                                        {formatDateTime(p.paidAt || p.createdAt)}
                                                    </p>
                                                </div>
                                                <div className='flex flex-wrap items-center gap-2'>
                                                    <span className='font-semibold'>{formatKES(p.amount)}</span>
                                                    <StatusBadge status={p.status} />
                                                    {p.status === 'confirmed' && <SmallButton onClick={() => setReceipt(p)}>Receipt</SmallButton>}
                                                    {isLandlord && (
                                                        <button
                                                            onClick={() => deletePayment(p)}
                                                            aria-label='Delete payment'
                                                            title='Delete payment'
                                                            className='rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                                                        >
                                                            <Trash2 className='h-4 w-4' />
                                                        </button>
                                                    )}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}

                    {tab === 'requests' && (
                        <div className='space-y-3'>
                            {pending.length === 0 ? (
                                <div className='rounded-2xl border border-slate-200 bg-white'>
                                    <Empty text='No access requests waiting for approval.' />
                                </div>
                            ) : (
                                pending.map((t) => (
                                    <RequestCard
                                        key={t.userId}
                                        tenant={t}
                                        mode={modeFor(t.plotId)}
                                        onDecide={async (status, rent, account, paybill) => {
                                            await decideTenant(t.userId, status, rent, account, paybill);
                                            flash(status === 'approved' ? t.name + ' can now access their account.' : 'Request declined.');
                                        }}
                                    />
                                ))
                            )}
                        </div>
                    )}

                    {tab === 'tenants' && (
                        <div className='rounded-2xl border border-slate-200 bg-white'>
                            {others.length === 0 ? (
                                <Empty text='No tenants yet.' />
                            ) : (
                                <ul className='divide-y divide-slate-100'>
                                    {others.map((t) => {
                                        const owed = (t.billedTotal || 0) - (t.paidTotal || 0);
                                        return (
                                            <li key={t.userId} className='flex flex-wrap items-center justify-between gap-3 p-4'>
                                                <div>
                                                    <p className='font-medium'>
                                                        {t.name}{' '}
                                                        <span className='text-sm font-normal text-slate-500'>
                                                            · {t.plotName} · Unit {t.unit}
                                                        </span>
                                                    </p>
                                                    <p className='text-xs text-slate-500'>
                                                        {t.email} · {t.phone} · Rent {formatKES(t.monthlyRent)}
                                                                                                                {modeFor(t.plotId) === 'per_tenant_paybill' ? ' \u00b7 Paybill ' + (t.tenantPaybill || 'not set') : ''}
                                                        {isPerTenant(t.plotId) ? ' \u00b7 Account ' + (t.accountNumber || 'not set') : ''}
                                                    </p>
                                                    {(t.status === 'approved' || t.status === 'suspended') && (
                                                        <p className={'text-xs font-medium ' + (owed > 0 ? 'text-rose-700' : 'text-emerald-700')}>
                                                            {owed > 0 ? 'Owes ' + formatKES(owed) : owed < 0 ? 'Paid up, ' + formatKES(-owed) + ' in credit' : 'Fully paid up'}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className='flex flex-wrap items-center gap-2'>
                                                    <StatusBadge status={t.status} />
                                                    {(t.status === 'approved' || t.status === 'suspended') && (
                                                        <button
                                                            onClick={() => openStatement(t)}
                                                            disabled={statementLoading === t.userId}
                                                            className='inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50'
                                                        >
                                                            {statementLoading === t.userId ? <Loader2 className='h-4 w-4 animate-spin' /> : <FileText className='h-4 w-4' />}
                                                            Statement
                                                        </button>
                                                    )}
                                                    {isPerTenant(t.plotId) && (t.status === 'approved' || t.status === 'suspended') && (
                                                        <SmallButton onClick={() => editAccount(t)}>
                                                            {modeFor(t.plotId) === 'per_tenant_paybill' ? 'Paybill & account' : 'Account no.'}
                                                        </SmallButton>
                                                    )}
                                                    {t.status === 'approved' && (
                                                        <>
                                                            <SmallButton onClick={() => changeRent(t)}>Change rent</SmallButton>
                                                            <SmallButton
                                                                onClick={() => runTenantAction(t, 'suspended', t.name + ' has been suspended.', 'Suspend access for ' + t.name + '?')}
                                                            >
                                                                Suspend
                                                            </SmallButton>
                                                        </>
                                                    )}
                                                    {t.status === 'suspended' && (
                                                        <SmallButton onClick={() => runTenantAction(t, 'approved', t.name + ' has been reactivated.')}>Reactivate</SmallButton>
                                                    )}
                                                    {t.status === 'rejected' && <SmallButton onClick={() => changeRent(t)}>Approve</SmallButton>}
                                                    {isLandlord && (
                                                        <button
                                                            onClick={() => removeTenant(t)}
                                                            className='inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50'
                                                        >
                                                            <Trash2 className='h-4 w-4' />
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    )}

                    {tab === 'arrears' && (
                        <ArrearsPanel plotFilter={plotFilter} onStatement={openStatement} statementLoading={statementLoading} />
                    )}

                    {tab === 'settings' && isLandlord && (
                        <div className='space-y-4'>
                            <PlotsCard plots={plots} onChange={setPlots} onNotice={flash} />
                            <TeamCard onNotice={flash} onError={setError} />
                            <ActivityCard />
                        </div>
                    )}
                </>
            )}

            <DialogHost />
            {receipt && (
                <ReceiptModal
                    payment={receipt}
                    propertyName={receipt.plotName || plotNameById.get(paymentPlot(receipt)) || ''}
                    onClose={closeReceipt}
                />
            )}
            {statement && (
                <StatementModal
                    tenant={statement.tenant}
                    payments={statement.payments}
                    bills={statement.bills}
                    propertyName={statement.tenant.plotName || ''}
                    onClose={closeStatement}
                />
            )}
        </div>
    );
}

type PlotValues = {
    name: string;
    paybillNumber: string;
    paybillName: string;
    paybillAccount: string;
    paymentInstructions: string;
    accountMode: AccountMode;
};

const EMPTY_PLOT: PlotValues = { name: '', paybillNumber: '', paybillName: '', paybillAccount: '', paymentInstructions: '', accountMode: 'shared' };

function PlotForm({
    initial,
    plotId,
    submitLabel,
    onSubmit,
    onCancel,
}: {
    initial: PlotValues;
    plotId?: string;
    submitLabel: string;
    onSubmit: (v: PlotValues) => Promise<void>;
    onCancel?: () => void;
}) {
    const [v, setV] = useState<PlotValues>(initial);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [nameCheck, setNameCheck] = useState<{ name: string; state: 'checking' | 'ok' | 'taken'; message: string } | null>(null);
    const field = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
    const unchangedName = v.name.trim().toLowerCase() === initial.name.trim().toLowerCase() && !!plotId;

    // Check the plot name shortly after the landlord stops typing.
    useEffect(() => {
        const name = v.name.trim();
        if (!name || unchangedName) {
            setNameCheck(null);
            return;
        }
        setNameCheck({ name, state: 'checking', message: '' });
        let cancelled = false;
        const t = setTimeout(() => {
            api.get('/api/admin/plots/name-check?name=' + encodeURIComponent(name) + (plotId ? '&plotId=' + encodeURIComponent(plotId) : ''))
                .then((res) => {
                    if (!cancelled) {
                        setNameCheck({ name, state: res.data.available ? 'ok' : 'taken', message: res.data.message || '' });
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setNameCheck(null);
                    }
                });
        }, 500);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [v.name, plotId, unchangedName]);

    const nameTaken = nameCheck?.state === 'taken';

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (!v.name.trim()) {
            setErr('Enter the plot name.');
            return;
        }
        if (nameTaken) {
            setErr(nameCheck!.message);
            return;
        }
        setBusy(true);
        setErr('');
        try {
            await onSubmit(v);
        } catch (ex) {
            setErr(errorMessage(ex));
        } finally {
            setBusy(false);
        }
    }

    return (
        <form onSubmit={submit} noValidate className='space-y-3 rounded-xl bg-slate-50 p-4'>
            <label className='block text-sm font-medium text-slate-700'>
                Plot name (tenants type this to join)
                <input
                    value={v.name}
                    onChange={(e) => {
                        setErr('');
                        setV((s) => ({ ...s, name: e.target.value }));
                    }}
                    maxLength={60}
                    placeholder='e.g. Sunrise Court'
                    aria-invalid={nameTaken}
                    className={field + (nameTaken ? ' border-rose-500 ring-2 ring-rose-200' : nameCheck?.state === 'ok' ? ' border-emerald-500' : '')}
                />
            </label>
            {nameCheck?.state === 'checking' && (
                <p className='-mt-1 flex items-center gap-1 text-xs text-slate-500'>
                    <Loader2 className='h-3 w-3 animate-spin' /> Checking the name…
                </p>
            )}
            {nameCheck?.state === 'ok' && (
                <p className='-mt-1 flex items-center gap-1 text-xs text-emerald-700'>
                    <CheckCircle2 className='h-3.5 w-3.5' /> This name is available.
                </p>
            )}
            {nameTaken && (
                <p role='alert' className='-mt-1 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>
                    <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' /> {nameCheck!.message}
                </p>
            )}
            {v.accountMode !== 'per_tenant_paybill' && (
            <div className='grid gap-3 sm:grid-cols-2'>
                <label className='block text-sm font-medium text-slate-700'>
                    Paybill number
                    <input
                        value={v.paybillNumber}
                        onChange={(e) => setV((s) => ({ ...s, paybillNumber: e.target.value }))}
                        inputMode='numeric'
                        maxLength={10}
                        placeholder='e.g. 123456'
                        className={field}
                    />
                </label>
                <label className='block text-sm font-medium text-slate-700'>
                    Business name on M-Pesa messages
                    <input
                        value={v.paybillName}
                        onChange={(e) => setV((s) => ({ ...s, paybillName: e.target.value }))}
                        maxLength={80}
                        placeholder='e.g. SUNRISE COURT LTD'
                        className={field}
                    />
                </label>
            </div>
            )}
            <fieldset className='space-y-2 rounded-lg border border-slate-200 bg-white p-3'>
                <legend className='px-1 text-sm font-medium text-slate-700'>How tenants on this plot pay</legend>
                <label className='flex items-start gap-2 text-sm'>
                    <input
                        type='radio'
                        checked={v.accountMode === 'shared'}
                        onChange={() => setV((s) => ({ ...s, accountMode: 'shared' }))}
                        className='mt-1'
                    />
                    <span>One account number for all tenants on this plot</span>
                </label>
                {v.accountMode === 'shared' && (
                    <input
                        value={v.paybillAccount}
                        onChange={(e) => setV((s) => ({ ...s, paybillAccount: e.target.value }))}
                        maxLength={30}
                        placeholder='Account number, e.g. RENT'
                        aria-label='Account number'
                        className='ml-6 w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm'
                    />
                )}
                <label className='flex items-start gap-2 text-sm'>
                    <input
                        type='radio'
                        checked={v.accountMode === 'per_tenant'}
                        onChange={() => setV((s) => ({ ...s, accountMode: 'per_tenant' }))}
                        className='mt-1'
                    />
                    <span>
                        Each tenant has their own account number
                        <span className='block text-xs text-slate-500'>
                            You set each tenant's account number when you approve them. You can change it later on the Tenants tab.
                        </span>
                    </span>
                </label>
                <label className='flex items-start gap-2 text-sm'>
                    <input
                        type='radio'
                        checked={v.accountMode === 'per_tenant_paybill'}
                        onChange={() => setV((s) => ({ ...s, accountMode: 'per_tenant_paybill' }))}
                        className='mt-1'
                    />
                    <span>
                        Each tenant has their own Paybill number and account number
                        <span className='block text-xs text-slate-500'>
                            You set each tenant's Paybill and account number when you approve them. You can change them later on the Tenants tab.
                        </span>
                    </span>
                </label>
            </fieldset>
            <label className='block text-sm font-medium text-slate-700'>
                Extra payment instructions for tenants (optional)
                <textarea
                    value={v.paymentInstructions}
                    onChange={(e) => setV((s) => ({ ...s, paymentInstructions: e.target.value }))}
                    rows={3}
                    maxLength={2000}
                    className={field}
                />
            </label>
            {err && (
                <p role='alert' className='text-sm text-rose-700'>
                    {err}
                </p>
            )}
            <div className='flex gap-2'>
                <button
                    type='submit'
                    disabled={busy || nameTaken}
                    className='inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-70'
                >
                    {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                    {submitLabel}
                </button>
                {onCancel && (
                    <button type='button' onClick={onCancel} className='rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-white'>
                        Cancel
                    </button>
                )}
            </div>
        </form>
    );
}

function PlotsCard({ plots, onChange, onNotice }: { plots: Plot[]; onChange: (p: Plot[]) => void; onNotice: (m: string) => void }) {
    const [adding, setAdding] = useState(plots.length === 0);
    const [editing, setEditing] = useState<string | null>(null);
    const [err, setErr] = useState('');

    async function create(v: PlotValues) {
        const res = await api.post('/api/admin/plots', v);
        const plot = res.data.plot as Plot;
        onChange([...plots, plot].sort((a, b) => a.name.localeCompare(b.name)));
        setAdding(false);
        onNotice('Plot "' + plot.name + '" created. Share this exact name with its tenants.');
    }

    async function save(id: string, v: PlotValues) {
        const res = await api.put('/api/admin/plots/' + id, v);
        const plot = res.data.plot as Plot;
        onChange(plots.map((p) => (p.id === id ? plot : p)));
        setEditing(null);
        onNotice('Plot "' + plot.name + '" saved.');
    }

    async function remove(p: Plot) {
        if (!(await confirmDialog('Delete the plot "' + p.name + '"? New tenants will no longer be able to join it.', { confirmLabel: 'Delete plot', danger: true }))) {
            return;
        }
        try {
            await api.delete('/api/admin/plots/' + p.id);
            onChange(plots.filter((x) => x.id !== p.id));
            onNotice('Plot "' + p.name + '" deleted.');
            setErr('');
        } catch (e) {
            setErr(errorMessage(e));
        }
    }

    return (
        <div className='rounded-2xl border border-slate-200 bg-white p-5'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
                <h2 className='flex items-center gap-2 font-semibold'>
                    <Building2 className='h-5 w-5 text-emerald-600' />
                    Your plots
                </h2>
                {!adding && (
                    <button
                        onClick={() => setAdding(true)}
                        className='inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700'
                    >
                        <Plus className='h-4 w-4' />
                        Add plot
                    </button>
                )}
            </div>
            <p className='mt-1 text-sm text-slate-600'>
                Tenants join a plot by typing its name exactly as you set it here. Each plot has its own Paybill details, shown to its tenants on their Pay rent tab.
            </p>
            {err && (
                <p role='alert' className='mt-2 text-sm text-rose-700'>
                    {err}
                </p>
            )}
            {adding && (
                <div className='mt-3'>
                    <PlotForm initial={EMPTY_PLOT} submitLabel='Create plot' onSubmit={create} onCancel={plots.length > 0 ? () => setAdding(false) : undefined} />
                </div>
            )}
            {plots.length > 0 && (
                <ul className='mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200'>
                    {plots.map((p) => (
                        <li key={p.id} className='p-3'>
                            {editing === p.id ? (
                                <PlotForm
                                    initial={{
                                        name: p.name,
                                        paybillNumber: p.paybillNumber,
                                        paybillName: p.paybillName,
                                        paybillAccount: p.paybillAccount,
                                        paymentInstructions: p.paymentInstructions,
                                        accountMode: p.accountMode || 'shared',
                                    }}
                                    plotId={p.id}
                                    submitLabel='Save plot'
                                    onSubmit={(v) => save(p.id, v)}
                                    onCancel={() => setEditing(null)}
                                />
                            ) : (
                                <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <div>
                                        <p className='font-semibold'>{p.name}</p>
                                        <p className='text-xs text-slate-500'>
                                            {p.accountMode === 'per_tenant_paybill'
                                                ? 'Each tenant has their own Paybill and account number'
                                                : p.paybillNumber
                                                  ? 'Paybill ' + p.paybillNumber
                                                  : 'No Paybill set'}
                                                                                        {p.accountMode === 'per_tenant_paybill'
                                                ? ''
                                                : p.accountMode === 'per_tenant'
                                                ? ' \u00b7 each tenant has their own account number'
                                                : p.paybillAccount
                                                  ? ' · account ' + p.paybillAccount
                                                  : ''}
                                            {p.paybillName ? ' · ' + p.paybillName : ''}
                                        </p>
                                    </div>
                                    <div className='flex items-center gap-2'>
                                        <button
                                            onClick={() => setEditing(p.id)}
                                            className='inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50'
                                        >
                                            <Pencil className='h-4 w-4' />
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => remove(p)}
                                            aria-label={'Delete ' + p.name}
                                            className='rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                                        >
                                            <Trash2 className='h-4 w-4' />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function AlertsToggle() {
    const [enabled, setEnabled] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    useEffect(() => {
        api.get('/api/admin/alerts')
            .then((res) => setEnabled(!!res.data.enabled))
            .catch(() => setEnabled(false));
    }, []);

    async function turnOn() {
        setBusy(true);
        setMsg('');
        try {
            await notifications.subscribe();
            await api.post('/api/admin/alerts', { enabled: true });
            setEnabled(true);
            setMsg('Alerts are on for this device.');
        } catch (e) {
            setMsg('Could not turn on alerts: ' + errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    async function turnOff() {
        setBusy(true);
        setMsg('');
        try {
            await api.post('/api/admin/alerts', { enabled: false });
            setEnabled(false);
        } catch (e) {
            setMsg(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    if (enabled === null) {
        return null;
    }

    return (
        <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3'>
            <div className='flex items-center gap-3'>
                <div className={'flex h-9 w-9 items-center justify-center rounded-lg ' + (enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                    {enabled ? <Bell className='h-5 w-5' /> : <BellOff className='h-5 w-5' />}
                </div>
                <div>
                    <p className='text-sm font-semibold'>{enabled ? 'Phone alerts are on' : 'Get a phone alert for new payments and requests'}</p>
                    <p className='text-xs text-slate-500'>
                        {msg ||
                            (enabled
                                ? 'You are notified when a tenant submits a payment or asks for access.'
                                : 'Turn this on from your phone. On iPhone, first add this site to your Home Screen.')}
                    </p>
                </div>
            </div>
            <button
                onClick={enabled ? turnOff : turnOn}
                disabled={busy}
                className={
                    'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60 ' +
                    (enabled ? 'border border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-emerald-600 text-white hover:bg-emerald-700')
                }
            >
                {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                {enabled ? 'Turn off' : 'Turn on alerts'}
            </button>
        </div>
    );
}

function AwaitingApproval({
    items,
    tenants,
    isLandlord,
    plotNameOf,
    onDecide,
}: {
    items: Payment[];
    tenants: Tenant[];
    isLandlord: boolean;
    plotNameOf: (p: Payment) => string;
    onDecide: (p: Payment, status: 'confirmed' | 'rejected', tenantId?: string) => Promise<void>;
}) {
    if (items.length === 0) {
        return null;
    }
    const options = tenants.filter((t) => t.status === 'approved' || t.status === 'suspended');
    return (
        <div className='rounded-2xl border border-amber-200 bg-white'>
            <div className='border-b border-amber-100 bg-amber-50 p-4'>
                <h2 className='font-semibold'>Awaiting approval ({items.length})</h2>
                <p className='text-sm text-slate-600'>
                    Tenants submitted these M-Pesa confirmation messages. Check each code and amount against your Paybill transactions before approving. Only approved
                    payments count towards rent.
                </p>
            </div>
            <ul className='divide-y divide-slate-100'>
                {items.map((p) => (
                    <AwaitingRow key={p.id} p={p} plotName={plotNameOf(p)} options={options} isLandlord={isLandlord} onDecide={onDecide} />
                ))}
            </ul>
        </div>
    );
}

function AwaitingRow({
    p,
    plotName,
    options,
    isLandlord,
    onDecide,
}: {
    p: Payment;
    plotName: string;
    options: Tenant[];
    isLandlord: boolean;
    onDecide: (p: Payment, status: 'confirmed' | 'rejected', tenantId?: string) => Promise<void>;
}) {
    const [tenantId, setTenantId] = useState(p.tenantId || '');
    const [busy, setBusy] = useState(false);

    async function act(status: 'confirmed' | 'rejected') {
        setBusy(true);
        try {
            await onDecide(p, status, tenantId || undefined);
        } finally {
            setBusy(false);
        }
    }

    return (
        <li className='flex flex-wrap items-start justify-between gap-3 p-4'>
            <div className='min-w-0 flex-1'>
                <p className='flex flex-wrap items-center gap-2 font-medium'>
                    {p.unit && p.unit !== '-' && (
                        <span className='rounded-md bg-emerald-100 px-2 py-0.5 text-sm font-bold text-emerald-800'>
                            {plotName ? plotName + ' · ' : ''}Unit {p.unit}
                        </span>
                    )}
                    <span>
                        {formatKES(p.amount)} from {p.payerName || p.tenantName || 'Unknown sender'}
                        {p.payerPhone ? ' · ' + formatPhone(p.payerPhone) : ''}
                    </span>
                </p>
                <p className='text-xs text-slate-500'>
                    M-Pesa code {p.mpesaReceipt || p.reference} · {formatDateTime(p.paidAt || p.createdAt)}
                    {p.account ? ' · account ' + p.account : ''}
                    {p.recipient ? ' · paid to ' + p.recipient : ''}
                </p>
                {p.warnings && p.warnings.length > 0 && (
                    <ul className='mt-1 space-y-0.5'>
                        {p.warnings.map((w) => (
                            <li key={w} className='flex items-start gap-1 text-xs font-medium text-amber-700'>
                                <AlertCircle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
                                {w}
                            </li>
                        ))}
                    </ul>
                )}
                {p.smsText && <p className='mt-1 break-words text-xs italic text-slate-500'>{p.smsText}</p>}
            </div>
            {isLandlord ? (
                <div className='flex flex-wrap items-center gap-2'>
                    {!p.tenantId && (
                        <select
                            value={tenantId}
                            onChange={(e) => setTenantId(e.target.value)}
                            className='max-w-[14rem] rounded-lg border border-slate-300 px-2 py-1.5 text-sm'
                            aria-label='Tenant who paid'
                        >
                            <option value=''>Choose tenant…</option>
                            {options.map((t) => (
                                <option key={t.userId} value={t.userId}>
                                    {t.name} · Unit {t.unit}
                                </option>
                            ))}
                        </select>
                    )}
                    <button
                        onClick={() => act('confirmed')}
                        disabled={busy || !tenantId}
                        className='inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50'
                    >
                        {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                        Approve
                    </button>
                    <SmallButton onClick={() => act('rejected')}>Reject</SmallButton>
                </div>
            ) : (
                <span className='text-xs text-slate-500'>Waiting for the landlord to approve</span>
            )}
        </li>
    );
}

type AuditEntry = { id: string; at: number; by: string; action: string; detail: string };

function ActivityCard() {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');

    useEffect(() => {
        api.get('/api/admin/audit')
            .then((res) => {
                setEntries(res.data.entries as AuditEntry[]);
                setErr('');
            })
            .catch((e) => setErr(errorMessage(e)))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className='rounded-2xl border border-slate-200 bg-white p-5'>
            <h2 className='flex items-center gap-2 font-semibold'>
                <ShieldCheck className='h-5 w-5 text-emerald-600' />
                Activity log
            </h2>
            <p className='mt-1 text-sm text-slate-600'>Who approved or removed tenants, changed rent, approved or deleted payments, and changed plots or caretakers.</p>
            {loading ? (
                <div className='flex justify-center py-6'>
                    <Loader2 className='h-5 w-5 animate-spin text-slate-400' />
                </div>
            ) : err ? (
                <p role='alert' className='mt-3 text-sm text-rose-700'>
                    {err}
                </p>
            ) : entries.length === 0 ? (
                <p className='mt-3 text-sm text-slate-500'>No activity recorded yet.</p>
            ) : (
                <ul className='mt-3 max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200'>
                    {entries.map((e) => (
                        <li key={e.id} className='px-3 py-2 text-sm'>
                            <p>
                                <span className='font-medium'>{e.action}</span> · {e.detail}
                            </p>
                            <p className='text-xs text-slate-500'>
                                {e.by || 'unknown'} · {formatDateTime(e.at)}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function TeamCard({ onNotice, onError }: { onNotice: (m: string) => void; onError: (m: string) => void }) {
    const [staff, setStaff] = useState<Staff[]>([]);
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    useEffect(() => {
        api.get('/api/admin/staff')
            .then((res) => setStaff(res.data.staff as Staff[]))
            .catch((e) => onError(errorMessage(e)));
    }, [onError]);

    async function add(e: FormEvent) {
        e.preventDefault();
        const value = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            setErr('Enter a valid email address.');
            return;
        }
        setBusy(true);
        setErr('');
        try {
            const res = await api.post('/api/admin/staff', { email: value });
            const added = res.data.staff as Staff;
            setStaff((prev) => [...prev.filter((s) => s.id !== added.id), added]);
            setEmail('');
            onNotice(added.email + ' can now sign in as your caretaker.');
        } catch (ex) {
            setErr(errorMessage(ex));
        } finally {
            setBusy(false);
        }
    }

    async function remove(s: Staff) {
        if (!(await confirmDialog('Remove caretaker access for ' + s.email + '?', { confirmLabel: 'Remove caretaker', danger: true }))) {
            return;
        }
        try {
            await api.delete('/api/admin/staff/' + s.id);
            setStaff((prev) => prev.filter((x) => x.id !== s.id));
            onNotice('Caretaker access removed for ' + s.email + '.');
        } catch (ex) {
            onError(errorMessage(ex));
        }
    }

    return (
        <div className='rounded-2xl border border-slate-200 bg-white p-5'>
            <h2 className='flex items-center gap-2 font-semibold'>
                <Users className='h-5 w-5 text-emerald-600' />
                Caretakers
            </h2>
            <p className='mt-1 text-sm text-slate-600'>
                Caretakers sign in with their own email and see all your plots. They can approve or decline tenants, change rent, suspend tenants, and view payments,
                receipts and statements. They cannot approve or delete payments, remove tenants, see reports or change plots.
            </p>
            {staff.length > 0 && (
                <ul className='mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200'>
                    {staff.map((s) => (
                        <li key={s.id} className='flex items-center justify-between gap-2 px-3 py-2 text-sm'>
                            <span>
                                {s.email} <span className='text-xs text-slate-500'>· added {formatDateTime(s.addedAt)}</span>
                            </span>
                            <button onClick={() => remove(s)} aria-label={'Remove ' + s.email} className='rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600'>
                                <Trash2 className='h-4 w-4' />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <form onSubmit={add} noValidate className='mt-3 flex flex-wrap gap-2'>
                <input
                    type='email'
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder='caretaker@example.com'
                    className='min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm'
                />
                <button
                    type='submit'
                    disabled={busy}
                    className='inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-70'
                >
                    {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : <UserPlus className='h-4 w-4' />}
                    Add caretaker
                </button>
            </form>
            {err && (
                <p role='alert' className='mt-2 text-sm text-rose-700'>
                    {err}
                </p>
            )}
        </div>
    );
}

function RequestCard({
    tenant,
    mode,
    onDecide,
}: {
    tenant: Tenant;
    mode: AccountMode;
    onDecide: (status: TenantStatus, rent?: number, account?: string, paybill?: string) => Promise<void>;
}) {
    const perTenant = mode !== 'shared';
    const ownPaybill = mode === 'per_tenant_paybill';
    const [rent, setRent] = useState('');
    const [account, setAccount] = useState(tenant.accountNumber || tenant.unit || '');
    const [paybill, setPaybill] = useState(tenant.tenantPaybill || '');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    async function approve() {
        const n = Number(rent);
        if (!rent || !Number.isFinite(n) || n <= 0) {
            setErr('Enter the monthly rent for this tenant before approving.');
            return;
        }
        if (ownPaybill && !paybill.trim()) {
            setErr('Enter this tenant\'s Paybill number before approving.');
            return;
        }
        if (perTenant && !account.trim()) {
            setErr('Enter this tenant\'s account number before approving.');
            return;
        }
        setBusy(true);
        setErr('');
        try {
            await onDecide('approved', n, perTenant ? account.trim() : undefined, ownPaybill ? paybill.trim() : undefined);
        } catch (e) {
            setErr(errorMessage(e));
            setBusy(false);
        }
    }

    async function decline() {
        if (!(await confirmDialog('Decline the access request from ' + tenant.name + '?', { confirmLabel: 'Decline', danger: true }))) {
            return;
        }
        setBusy(true);
        try {
            await onDecide('rejected');
        } catch (e) {
            setErr(errorMessage(e));
            setBusy(false);
        }
    }

    return (
        <div className='rounded-2xl border border-slate-200 bg-white p-5'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                    <p className='font-semibold'>{tenant.name}</p>
                    <p className='text-sm text-slate-600'>
                        {tenant.plotName} · Unit {tenant.unit} · {tenant.phone}
                    </p>
                    <p className='text-xs text-slate-500'>
                        {tenant.email} · requested {formatDateTime(tenant.createdAt)}
                    </p>
                </div>
                <StatusBadge status={tenant.status} />
            </div>
            <div className='mt-4 flex flex-wrap items-end gap-2'>
                <label className='text-sm font-medium text-slate-700'>
                    Monthly rent (KES)
                    <input
                        type='number'
                        min='1'
                        value={rent}
                        onChange={(e) => setRent(e.target.value)}
                        className='mt-1 block w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm'
                    />
                </label>
                {ownPaybill && (
                    <label className='text-sm font-medium text-slate-700'>
                        Tenant's Paybill number
                        <input
                            value={paybill}
                            onChange={(e) => setPaybill(e.target.value)}
                            inputMode='numeric'
                            maxLength={10}
                            className='mt-1 block w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm'
                        />
                    </label>
                )}
                {perTenant && (
                    <label className='text-sm font-medium text-slate-700'>
                        Tenant's account number
                        <input
                            value={account}
                            onChange={(e) => setAccount(e.target.value)}
                            maxLength={30}
                            className='mt-1 block w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm'
                        />
                    </label>
                )}
                <button
                    onClick={approve}
                    disabled={busy}
                    className='inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-70'
                >
                    {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                    Approve
                </button>
                <SmallButton onClick={decline}>Decline</SmallButton>
            </div>
            {err && (
                <p role='alert' className='mt-2 text-sm text-rose-700'>
                    {err}
                </p>
            )}
        </div>
    );
}

function ArrearsPanel({
    plotFilter,
    onStatement,
    statementLoading,
}: {
    plotFilter: string;
    onStatement: (t: Tenant) => void;
    statementLoading: string | null;
}) {
    const [rows, setRows] = useState<ArrearsRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');

    useEffect(() => {
        api.get('/api/admin/arrears')
            .then((res) => {
                setRows(res.data.arrears as ArrearsRow[]);
                setErr('');
            })
            .catch((e) => setErr(errorMessage(e)))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className='flex justify-center py-16'>
                <Loader2 className='h-6 w-6 animate-spin text-slate-400' />
            </div>
        );
    }
    if (err) {
        return (
            <p role='alert' className='flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>
                <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
                {err}
            </p>
        );
    }

    const shown = rows.filter((r) => plotFilter === 'all' || r.tenant.plotId === plotFilter);
    const total = shown.reduce((s, r) => s + r.owed, 0);

    return (
        <div className='rounded-2xl border border-slate-200 bg-white'>
            <div className='flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4'>
                <h2 className='flex items-center gap-2 font-semibold'>
                    <Wallet className='h-5 w-5 text-rose-600' />
                    Tenants who owe rent
                </h2>
                <p className='text-sm font-semibold text-rose-700'>Total owed {formatKES(total)}</p>
            </div>
            {shown.length === 0 ? (
                <Empty text='Nobody owes rent right now. Every tenant is paid up.' />
            ) : (
                <ul className='divide-y divide-slate-100'>
                    {shown.map((r) => (
                        <li key={r.tenant.userId} className='flex flex-wrap items-start justify-between gap-3 p-4'>
                            <div className='min-w-0'>
                                <p className='font-medium'>
                                    {r.tenant.name}{' '}
                                    <span className='text-sm font-normal text-slate-500'>
                                        · {r.tenant.plotName} · Unit {r.tenant.unit}
                                    </span>
                                </p>
                                <p className='text-xs text-slate-500'>
                                    {r.tenant.phone} · {r.unpaidMonths.length} unpaid {r.unpaidMonths.length === 1 ? 'month' : 'months'}
                                    {r.unpaidMonths.length > 0 ? ' · oldest ' + formatMonth(r.unpaidMonths[0].month) : ''}
                                </p>
                                <div className='mt-2 flex flex-wrap gap-1.5'>
                                    {r.unpaidMonths.map((m) => (
                                        <span
                                            key={m.month}
                                            className={
                                                'rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ' +
                                                (m.paid > 0 ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-rose-50 text-rose-700 ring-rose-200')
                                            }
                                        >
                                            {formatMonth(m.month)}: {formatKES(m.outstanding)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div className='flex items-center gap-2'>
                                <span className='font-bold text-rose-700'>{formatKES(r.owed)}</span>
                                <button
                                    onClick={() => onStatement(r.tenant)}
                                    disabled={statementLoading === r.tenant.userId}
                                    className='inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50'
                                >
                                    {statementLoading === r.tenant.userId ? <Loader2 className='h-4 w-4 animate-spin' /> : <FileText className='h-4 w-4' />}
                                    Statement
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <p className='border-t border-slate-100 px-4 py-3 text-xs text-slate-500'>
                A bill for each tenant's monthly rent is issued automatically on the 1st of every month. Payments clear the oldest unpaid bill first, so anything unpaid
                carries forward.
            </p>
        </div>
    );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
    return (
        <button onClick={onClick} className='rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50'>
            {children}
        </button>
    );
}

function Empty({ text }: { text: string }) {
    return <p className='py-12 text-center text-sm text-slate-500'>{text}</p>;
}
