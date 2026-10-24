import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../platform/client';
import {
    AlertCircle,
    ArrowLeft,
    Ban,
    Building2,
    CheckCircle2,
    Clock,
    FileText,
    Info,
    Loader2,
    Receipt,
    RefreshCw,
    Smartphone,
    Trash2,
    Wallet,
    XCircle,
} from 'lucide-react';
import StatusBadge from './StatusBadge';
import ReceiptModal from './Receipt';
import StatementModal from './Statement';
import { DialogHost, confirmDialog } from './Dialog';
import { LandlordApplyForm, LandlordRequestStatus, RoleChooser } from './LandlordApply';
import { EMPTY_PLOT_INFO } from '../types';
import type { AccountMode, Bill, Me, Payment, Tenant, TenantPlotInfo } from '../types';
import { allocateBills, errorMessage, formatDate, formatKES, formatMonth } from '../util';

const inputClass =
    'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-400';

const primaryButton =
    'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300';

type Props = {
    me: Me;
    onRefresh: () => Promise<void>;
};

export default function TenantView({ me, onRefresh }: Props) {
    const tenant = me.tenant;
    if (!tenant) {
        if (me.landlordRequest) {
            return <LandlordRequestStatus request={me.landlordRequest} onRefresh={onRefresh} />;
        }
        return <Onboarding me={me} onRefresh={onRefresh} />;
    }
    if (me.plotAvailable === false) {
        return (
            <div className='mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm'>
                <div className='mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-600'>
                    <Ban className='h-7 w-7' />
                </div>
                <h1 className='mt-4 text-xl font-bold'>{tenant.plotName || 'This plot'} is temporarily unavailable</h1>
                <p className='mt-2 text-sm text-slate-600'>Access to this plot has been paused. Please contact your landlord.</p>
            </div>
        );
    }
    if (tenant.status === 'approved') {
        return <Dashboard tenant={tenant} />;
    }
    return <StatusMessage tenant={tenant} onRefresh={onRefresh} />;
}

function ErrorLine({ text }: { text: string }) {
    return (
        <p role='alert' className='flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>
            <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
            {text}
        </p>
    );
}

function Onboarding({ me, onRefresh }: { me: Me; onRefresh: () => Promise<void> }) {
    const [choice, setChoice] = useState<'tenant' | 'landlord' | null>(null);
    if (choice === 'tenant') {
        return <RegisterForm defaultName={me.name} onDone={onRefresh} onBack={() => setChoice(null)} />;
    }
    if (choice === 'landlord') {
        return <LandlordApplyForm defaultName={me.name} email={me.email} onBack={() => setChoice(null)} onDone={onRefresh} />;
    }
    return <RoleChooser onChoose={setChoice} />;
}

type PlotLookup = { name: string; accountMode: AccountMode; landlordName: string };

function RegisterForm({ defaultName, onDone, onBack }: { defaultName: string; onDone: () => Promise<void>; onBack: () => void }) {
    const [plotName, setPlotName] = useState('');
    const [plot, setPlot] = useState<PlotLookup | null>(null);
    const [name, setName] = useState(defaultName);
    const [phone, setPhone] = useState('');
    const [unit, setUnit] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [tenantPaybill, setTenantPaybill] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    async function findPlot(e: FormEvent) {
        e.preventDefault();
        if (!plotName.trim()) {
            setErr('Enter the name of your plot.');
            return;
        }
        setBusy(true);
        setErr('');
        try {
            const res = await api.get('/api/plots/lookup?name=' + encodeURIComponent(plotName.trim()));
            setPlot(res.data.plot as PlotLookup);
        } catch (ex) {
            setErr(errorMessage(ex));
        } finally {
            setBusy(false);
        }
    }

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (!plot) {
            return;
        }
        if (!name.trim() || !phone.trim() || !unit.trim()) {
            setErr('Please fill in your full name, phone number and house or unit number.');
            return;
        }
        if (phone.replace(/\D/g, '').length < 9) {
            setErr('Please enter a valid phone number.');
            return;
        }
        setBusy(true);
        setErr('');
        try {
            await api.post('/api/register', { plotName: plot.name, name, phone, unit, accountNumber, tenantPaybill });
            await onDone();
        } catch (ex) {
            setErr(errorMessage(ex));
        } finally {
            setBusy(false);
        }
    }

    if (!plot) {
        return (
            <div className='mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'>
                <button onClick={onBack} className='inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline'>
                    <ArrowLeft className='h-4 w-4' />
                    Back
                </button>
                <h1 className='mt-3 text-2xl font-bold'>Find your plot</h1>
                <p className='mt-2 text-sm text-slate-600'>
                    Enter the name of your plot exactly as your landlord gave it. Capital letters and spaces do not matter.
                </p>
                <form onSubmit={findPlot} noValidate className='mt-6 space-y-4'>
                    <label className='block text-sm font-medium text-slate-700'>
                        Plot name
                        <input className={inputClass} value={plotName} onChange={(e) => setPlotName(e.target.value)} placeholder='e.g. Sunrise Court' autoFocus />
                    </label>
                    {err && <ErrorLine text={err} />}
                    <button type='submit' disabled={busy} className={primaryButton}>
                        {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                        Continue
                    </button>
                </form>
            </div>
        );
    }

    return (
        <div className='mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'>
            <button
                onClick={() => {
                    setPlot(null);
                    setErr('');
                }}
                className='inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline'
            >
                <ArrowLeft className='h-4 w-4' />
                Change plot
            </button>
            <div className='mt-3 flex items-center gap-3 rounded-xl bg-emerald-50 p-4'>
                <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white'>
                    <Building2 className='h-5 w-5' />
                </div>
                <div>
                    <p className='text-xs text-emerald-800'>Requesting access to</p>
                    <p className='text-lg font-bold text-emerald-900'>{plot.name}</p>
                    {plot.landlordName && <p className='text-xs text-emerald-800'>Landlord: {plot.landlordName}</p>}
                </div>
            </div>
            <p className='mt-4 text-sm text-slate-600'>Enter your details. The landlord of this plot will review your request and open your private account.</p>
            <form onSubmit={submit} noValidate className='mt-4 space-y-4'>
                <label className='block text-sm font-medium text-slate-700'>
                    Full name
                    <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. Jane Wanjiru' />
                </label>
                <label className='block text-sm font-medium text-slate-700'>
                    Phone number
                    <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder='e.g. 0712 345 678' inputMode='tel' />
                </label>
                <label className='block text-sm font-medium text-slate-700'>
                    House or unit number
                    <input className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder='e.g. Block B, Unit 4' />
                </label>
                {plot.accountMode === 'per_tenant_paybill' && (
                    <label className='block text-sm font-medium text-slate-700'>
                        Your Paybill number (optional)
                        <input
                            className={inputClass}
                            value={tenantPaybill}
                            onChange={(e) => setTenantPaybill(e.target.value)}
                            inputMode='numeric'
                            maxLength={10}
                            placeholder='If your landlord already gave you one'
                        />
                    </label>
                )}
                {plot.accountMode !== 'shared' && (
                    <label className='block text-sm font-medium text-slate-700'>
                        Your account number (optional)
                        <input
                            className={inputClass}
                            value={accountNumber}
                            onChange={(e) => setAccountNumber(e.target.value)}
                            maxLength={30}
                            placeholder='If your landlord already gave you one'
                        />
                        <span className='mt-1 block text-xs font-normal text-slate-500'>
                            On this plot each tenant pays with their own {plot.accountMode === 'per_tenant_paybill' ? 'Paybill and account number' : 'account number'}. Your
                            landlord confirms {plot.accountMode === 'per_tenant_paybill' ? 'them' : 'it'} when approving you.
                        </span>
                    </label>
                )}
                {err && <ErrorLine text={err} />}
                <button type='submit' disabled={busy} className={primaryButton}>
                    {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                    Submit request
                </button>
            </form>
        </div>
    );
}

function StatusMessage({ tenant, onRefresh }: { tenant: Tenant; onRefresh: () => Promise<void> }) {
    const [busy, setBusy] = useState(false);
    const content = {
        pending: {
            icon: Clock,
            tone: 'bg-amber-50 text-amber-700',
            title: 'Your request is awaiting approval',
            text: 'Your landlord has received your request. Your private account will open for rent payments once it is approved.',
        },
        rejected: {
            icon: XCircle,
            tone: 'bg-rose-50 text-rose-700',
            title: 'Your request was declined',
            text: 'Your landlord did not approve this request. Please contact your landlord if you believe this is a mistake.',
        },
        suspended: {
            icon: Ban,
            tone: 'bg-slate-100 text-slate-600',
            title: 'Your account access is suspended',
            text: 'Your landlord has paused access to your account. Please contact your landlord to restore it.',
        },
        approved: {
            icon: CheckCircle2,
            tone: 'bg-emerald-50 text-emerald-700',
            title: 'Approved',
            text: '',
        },
    }[tenant.status];
    const Icon = content.icon;

    async function refresh() {
        setBusy(true);
        await onRefresh();
        setBusy(false);
    }

    return (
        <div className='mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8'>
            <div className={'mx-auto flex h-14 w-14 items-center justify-center rounded-full ' + content.tone}>
                <Icon className='h-7 w-7' />
            </div>
            <h1 className='mt-4 text-xl font-bold'>{content.title}</h1>
            <p className='mt-2 text-sm text-slate-600'>{content.text}</p>
            <dl className='mt-6 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-left text-sm'>
                <dt className='text-slate-500'>Plot</dt>
                <dd className='font-medium'>{tenant.plotName || '-'}</dd>
                <dt className='text-slate-500'>Name</dt>
                <dd className='font-medium'>{tenant.name}</dd>
                <dt className='text-slate-500'>House / unit</dt>
                <dd className='font-medium'>{tenant.unit}</dd>
                <dt className='text-slate-500'>Phone</dt>
                <dd className='font-medium'>{tenant.phone}</dd>
                <dt className='text-slate-500'>Status</dt>
                <dd>
                    <StatusBadge status={tenant.status} />
                </dd>
            </dl>
            <button
                onClick={refresh}
                disabled={busy}
                className='mt-6 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50'
            >
                <RefreshCw className={'h-4 w-4 ' + (busy ? 'animate-spin' : '')} />
                Check status
            </button>
        </div>
    );
}

type DashTab = 'pay' | 'bills' | 'history';

function Dashboard({ tenant }: { tenant: Tenant }) {
    const [tab, setTab] = useState<DashTab>('pay');
    const [payments, setPayments] = useState<Payment[]>([]);
    const [bills, setBills] = useState<Bill[]>([]);
    const [info, setInfo] = useState<TenantPlotInfo>(EMPTY_PLOT_INFO);
    const [loading, setLoading] = useState(true);
    const [loadErr, setLoadErr] = useState('');
    const [receipt, setReceipt] = useState<Payment | null>(null);
    const [removeErr, setRemoveErr] = useState('');
    const [showStatement, setShowStatement] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [p, s, b] = await Promise.all([api.get('/api/payments'), api.get('/api/settings'), api.get('/api/bills')]);
            setPayments(p.data.payments as Payment[]);
            setInfo({ ...EMPTY_PLOT_INFO, ...(s.data as TenantPlotInfo) });
            setBills((b.data.bills as Bill[]) || []);
            setLoadErr('');
        } catch (e) {
            setLoadErr(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const upsert = useCallback((p: Payment) => {
        setPayments((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [p, ...prev]));
    }, []);

    const closeReceipt = useCallback(() => setReceipt(null), []);
    const closeStatement = useCallback(() => setShowStatement(false), []);

    async function removePayment(p: Payment) {
        if (
            !(await confirmDialog('Delete this ' + formatKES(p.amount) + ' payment from your history? The landlord keeps their copy of the record.', {
                confirmLabel: 'Delete',
                danger: true,
            }))
        ) {
            return;
        }
        try {
            await api.delete('/api/payments/' + p.id);
            setPayments((prev) => prev.map((x) => (x.id === p.id ? { ...x, hiddenByTenant: true } : x)));
            setRemoveErr('');
        } catch (e) {
            setRemoveErr(errorMessage(e));
        }
    }

    const plotName = info.plotName || tenant.plotName || '';
    const visible = payments.filter((p) => !p.hiddenByTenant);
    const totalPaid = payments.filter((p) => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0);
    const totalBilled = bills.reduce((s, b) => s + b.amount, 0);
    const owed = totalBilled - totalPaid;
    const lines = allocateBills(bills, totalPaid);
    const unpaid = lines.filter((l) => l.outstanding > 0);

    const cards = [
        { label: owed < 0 ? 'In credit' : 'Total amount owed', value: formatKES(Math.abs(owed)), tone: owed > 0 ? 'text-rose-700' : 'text-emerald-700' },
        { label: 'Unpaid months', value: String(unpaid.length), tone: unpaid.length > 0 ? 'text-rose-700' : '' },
        { label: 'Monthly rent', value: formatKES(tenant.monthlyRent), tone: '' },
        { label: 'Total paid', value: formatKES(totalPaid), tone: '' },
    ];

    const tabs: { id: DashTab; label: string; icon: typeof Receipt }[] = [
        { id: 'pay', label: 'Pay rent', icon: Smartphone },
        { id: 'bills', label: 'Bills', icon: Wallet },
        { id: 'history', label: 'Payments & receipts', icon: Receipt },
    ];

    return (
        <div className='space-y-6'>
            <div>
                <h1 className='text-2xl font-bold'>Welcome, {tenant.name}</h1>
                <p className='text-sm text-slate-600'>
                    {plotName ? plotName + ' · ' : ''}House / unit {tenant.unit}
                </p>
            </div>

            <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
                {cards.map((c) => (
                    <div key={c.label} className='rounded-xl border border-slate-200 bg-white p-4'>
                        <p className='text-xs text-slate-500'>{c.label}</p>
                        <p className={'mt-1 text-lg font-bold sm:text-xl ' + c.tone}>{loading ? '…' : c.value}</p>
                    </div>
                ))}
            </div>

            {!loading && owed > 0 && unpaid.length > 0 && (
                <div className='flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800'>
                    <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
                    <p>
                        You owe {formatKES(owed)}
                        {unpaid.length > 1
                            ? ', including unpaid rent from ' + formatMonth(unpaid[0].month) + '. Unpaid amounts carry forward to the next month.'
                            : ' for ' + formatMonth(unpaid[0].month) + '.'}
                    </p>
                </div>
            )}

            <div className='flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1' role='tablist'>
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        role='tab'
                        aria-selected={tab === t.id}
                        onClick={() => setTab(t.id)}
                        className={
                            'flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium ' +
                            (tab === t.id ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50')
                        }
                    >
                        <t.icon className='h-4 w-4' />
                        {t.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className='flex justify-center py-16'>
                    <Loader2 className='h-6 w-6 animate-spin text-slate-400' />
                </div>
            ) : loadErr ? (
                <ErrorLine text={loadErr} />
            ) : tab === 'pay' ? (
                <PayCard tenant={tenant} owed={owed} info={info} onPayment={upsert} />
            ) : tab === 'bills' ? (
                <section className='rounded-2xl border border-slate-200 bg-white p-5'>
                    <h2 className='flex items-center gap-2 text-lg font-semibold'>
                        <Wallet className='h-5 w-5 text-emerald-600' />
                        Monthly bills
                    </h2>
                    <p className='mt-1 text-sm text-slate-600'>
                        A rent bill is issued on the 1st of every month. Your payments clear the oldest unpaid bill first.
                    </p>
                    {lines.length === 0 ? (
                        <p className='py-10 text-center text-sm text-slate-500'>No bills yet.</p>
                    ) : (
                        <ul className='mt-3 divide-y divide-slate-100'>
                            {[...lines].reverse().map((l) => (
                                <li key={l.month} className='flex flex-wrap items-center justify-between gap-2 py-3'>
                                    <div>
                                        <p className='font-medium'>{formatMonth(l.month)}</p>
                                        <p className='text-xs text-slate-500'>
                                            Bill {formatKES(l.amount)} · paid {formatKES(l.paid)}
                                        </p>
                                    </div>
                                    <div className='flex items-center gap-2'>
                                        {l.outstanding > 0 && <span className='font-semibold text-rose-700'>{formatKES(l.outstanding)} due</span>}
                                        <StatusBadge status={l.outstanding === 0 ? 'confirmed' : l.paid > 0 ? 'partial' : 'unpaid'} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            ) : (
                <section className='rounded-2xl border border-slate-200 bg-white p-5'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                        <h2 className='flex items-center gap-2 text-lg font-semibold'>
                            <Receipt className='h-5 w-5 text-emerald-600' />
                            Payments & receipts
                        </h2>
                        <button
                            onClick={() => setShowStatement(true)}
                            className='inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50'
                        >
                            <FileText className='h-4 w-4' />
                            Download statement
                        </button>
                    </div>
                    {removeErr && (
                        <div className='mt-3'>
                            <ErrorLine text={removeErr} />
                        </div>
                    )}
                    {visible.length === 0 ? (
                        <p className='py-10 text-center text-sm text-slate-500'>No payments yet. Your payments and receipts will appear here.</p>
                    ) : (
                        <ul className='mt-3 divide-y divide-slate-100'>
                            {visible.map((p) => (
                                <li key={p.id} className='flex flex-wrap items-center justify-between gap-2 py-3'>
                                    <div className='min-w-0'>
                                        <p className='font-medium'>{formatMonth(p.month)}</p>
                                        <p className='text-xs text-slate-500'>
                                            {p.method}
                                            {p.mpesaReceipt || p.reference ? ' · ' + (p.mpesaReceipt || p.reference) : ''} ·{' '}
                                            {formatDate(p.paidAt || p.createdAt)}
                                        </p>
                                        {p.status === 'failed' && p.failureReason && <p className='text-xs text-rose-600'>{p.failureReason}</p>}
                                    </div>
                                    <div className='flex items-center gap-2'>
                                        <span className='font-semibold'>{formatKES(p.amount)}</span>
                                        <StatusBadge status={p.status} />
                                        {p.status === 'confirmed' && (
                                            <button
                                                onClick={() => setReceipt(p)}
                                                className='rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50'
                                            >
                                                Receipt
                                            </button>
                                        )}
                                        {p.status !== 'processing' && (
                                            <button
                                                onClick={() => removePayment(p)}
                                                aria-label='Delete payment'
                                                title='Delete from history'
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
                </section>
            )}

            <DialogHost />
            {receipt && <ReceiptModal payment={receipt} propertyName={receipt.plotName || plotName} onClose={closeReceipt} />}
            {showStatement && <StatementModal tenant={tenant} payments={payments} bills={bills} propertyName={plotName} onClose={closeStatement} />}
        </div>
    );
}

function PayCard({ tenant, owed, info, onPayment }: { tenant: Tenant; owed: number; info: TenantPlotInfo; onPayment: (p: Payment) => void }) {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [done, setDone] = useState<Payment | null>(null);

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (text.trim().length < 20) {
            setErr('Paste the full M-Pesa confirmation message you received after paying.');
            return;
        }
        setBusy(true);
        setErr('');
        try {
            const res = await api.post('/api/payments/sms', { text });
            const p = res.data.payment as Payment;
            onPayment(p);
            setDone(p);
            setText('');
        } catch (ex) {
            setErr(errorMessage(ex));
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className='mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm'>
            <h2 className='flex items-center gap-2 text-lg font-semibold'>
                <Smartphone className='h-5 w-5 text-emerald-600' />
                Pay rent by M-Pesa Paybill
            </h2>
            <div className='mt-4 rounded-xl bg-emerald-50 p-4'>
                <p className='text-xs text-emerald-800'>{owed > 0 ? 'Amount to pay now' : 'Monthly rent'}</p>
                <p className='text-2xl font-bold text-emerald-900'>{formatKES(owed > 0 ? owed : tenant.monthlyRent)}</p>
            </div>
            {info.paybillNumber ? (
                <dl className='mt-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-slate-50 p-3 text-sm'>
                    <dt className='text-slate-500'>{info.accountMode === 'per_tenant_paybill' ? 'Your Paybill number' : 'Paybill number'}</dt>
                    <dd className='font-semibold'>{info.paybillNumber}</dd>
                    <dt className='text-slate-500'>{info.accountMode !== 'shared' ? 'Your account number' : 'Account number'}</dt>
                    <dd className='font-semibold'>{info.paybillAccount || 'Ask your landlord'}</dd>
                    {info.paybillName && (
                        <>
                            <dt className='text-slate-500'>Business name</dt>
                            <dd className='font-medium'>{info.paybillName}</dd>
                        </>
                    )}
                </dl>
            ) : (
                <div className='mt-4 flex gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700'>
                    <Info className='mt-0.5 h-4 w-4 shrink-0' />
                    <p>Your landlord has not added the Paybill details yet. Ask your landlord for the Paybill number and account number to use.</p>
                </div>
            )}
            {info.paymentInstructions && <p className='mt-2 whitespace-pre-line text-sm text-slate-600'>{info.paymentInstructions}</p>}
            <ol className='mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-700'>
                <li>On your phone open M-Pesa, then Lipa na M-Pesa, then Pay Bill.</li>
                <li>Enter the Paybill number, the account number and the amount, then your PIN.</li>
                <li>When the M-Pesa confirmation message arrives, copy it and paste it below.</li>
                <li>Your landlord checks and approves it. Your bill then updates and you can download a receipt.</li>
            </ol>

            {done ? (
                <div className='mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800'>
                    <p className='flex items-center gap-2 font-semibold'>
                        <CheckCircle2 className='h-4 w-4' />
                        Payment submitted
                    </p>
                    <p className='mt-1'>
                        {formatKES(done.amount)} with M-Pesa code {done.mpesaReceipt} is now awaiting your landlord's approval. You will see it under Payments &amp; receipts.
                    </p>
                    <button
                        onClick={() => setDone(null)}
                        className='mt-3 rounded-lg border border-emerald-300 px-3 py-1.5 text-sm font-medium hover:bg-emerald-100'
                    >
                        Submit another payment
                    </button>
                </div>
            ) : (
                <form onSubmit={submit} noValidate className='mt-5 space-y-3'>
                    <label className='block text-sm font-medium text-slate-700'>
                        Paste your M-Pesa confirmation message
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            rows={5}
                            maxLength={1000}
                            placeholder='e.g. QJK7ABC123 Confirmed. Ksh15,000.00 sent to ... for account ... on 21/10/26 at 3:45 PM ...'
                            className={inputClass}
                        />
                    </label>
                    {err && <ErrorLine text={err} />}
                    <button type='submit' disabled={busy} className={primaryButton}>
                        {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                        Submit payment
                    </button>
                    <p className='text-center text-xs text-slate-500'>Each M-Pesa code can only be submitted once.</p>
                </form>
            )}
        </section>
    );
}
