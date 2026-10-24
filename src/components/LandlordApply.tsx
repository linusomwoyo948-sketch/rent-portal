import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../platform/client';
import { AlertCircle, ArrowLeft, Building2, Clock, Home, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import type { LandlordRequest } from '../types';
import { errorMessage, formatDateTime } from '../util';

const inputClass =
    'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100';

const primaryButton =
    'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300';

function ErrorLine({ text }: { text: string }) {
    return (
        <p role='alert' className='flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>
            <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
            {text}
        </p>
    );
}

// First screen for a new account: tenant or landlord.
export function RoleChooser({ onChoose }: { onChoose: (role: 'tenant' | 'landlord') => void }) {
    const options = [
        {
            role: 'tenant' as const,
            icon: Home,
            title: "I'm a tenant",
            text: 'Join your plot to pay rent, see your bills and download receipts.',
        },
        {
            role: 'landlord' as const,
            icon: Building2,
            title: "I'm a landlord",
            text: 'Apply for a landlord account to manage your plots, tenants and rent collection.',
        },
    ];
    return (
        <div className='mx-auto max-w-2xl'>
            <h1 className='text-center text-2xl font-bold'>How will you use Rent Portal?</h1>
            <p className='mt-2 text-center text-sm text-slate-600'>Choose one. Every account is checked and approved before it can see any private information.</p>
            <div className='mt-6 grid gap-4 sm:grid-cols-2'>
                {options.map((o) => (
                    <button
                        key={o.role}
                        onClick={() => onChoose(o.role)}
                        className='group rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-emerald-400 hover:shadow-md'
                    >
                        <div className='flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white'>
                            <o.icon className='h-6 w-6' />
                        </div>
                        <p className='mt-4 text-lg font-semibold'>{o.title}</p>
                        <p className='mt-1 text-sm text-slate-600'>{o.text}</p>
                    </button>
                ))}
            </div>
        </div>
    );
}

export function LandlordApplyForm({
    defaultName,
    email,
    onBack,
    onDone,
}: {
    defaultName: string;
    email: string;
    onBack: () => void;
    onDone: () => Promise<void>;
}) {
    const [name, setName] = useState(defaultName);
    const [phone, setPhone] = useState('');
    const [location, setLocation] = useState('');
    const [plots, setPlots] = useState('');
    const [units, setUnits] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (!name.trim() || !phone.trim() || !location.trim() || !plots.trim()) {
            setErr('Please fill in your full name, phone number, location and the name of your plot or plots.');
            return;
        }
        if (phone.replace(/\D/g, '').length < 9) {
            setErr('Please enter a valid phone number.');
            return;
        }
        setBusy(true);
        setErr('');
        try {
            await api.post('/api/landlord-request', { name, phone, location, plots, units, message });
            await onDone();
        } catch (ex) {
            setErr(errorMessage(ex));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className='mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'>
            <button onClick={onBack} className='inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline'>
                <ArrowLeft className='h-4 w-4' />
                Back
            </button>
            <h1 className='mt-3 text-2xl font-bold'>Apply for a landlord account</h1>
            <p className='mt-2 text-sm text-slate-600'>
                The site owner checks every landlord before opening an account. You will be able to create your plots and approve tenants once your application is
                approved.
            </p>
            <p className='mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600'>
                Applying as <span className='font-medium text-slate-900'>{email}</span>. You will sign in with this email.
            </p>
            <form onSubmit={submit} noValidate className='mt-5 space-y-4'>
                <label className='block text-sm font-medium text-slate-700'>
                    Full name
                    <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. John Kamau' />
                </label>
                <label className='block text-sm font-medium text-slate-700'>
                    Phone number
                    <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder='e.g. 0712 345 678' inputMode='tel' />
                </label>
                <label className='block text-sm font-medium text-slate-700'>
                    Location of your property
                    <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder='e.g. Karen, Nairobi' />
                </label>
                <label className='block text-sm font-medium text-slate-700'>
                    Name of your plot or plots
                    <input className={inputClass} value={plots} onChange={(e) => setPlots(e.target.value)} placeholder='e.g. Sunrise Court, Karen Heights' />
                </label>
                <label className='block text-sm font-medium text-slate-700'>
                    Number of houses or units (optional)
                    <input className={inputClass} value={units} onChange={(e) => setUnits(e.target.value)} inputMode='numeric' placeholder='e.g. 24' />
                </label>
                <label className='block text-sm font-medium text-slate-700'>
                    Anything else the site owner should know (optional)
                    <textarea className={inputClass} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000} />
                </label>
                {err && <ErrorLine text={err} />}
                <button type='submit' disabled={busy} className={primaryButton}>
                    {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                    Submit application
                </button>
            </form>
        </div>
    );
}

export function LandlordRequestStatus({ request, onRefresh }: { request: LandlordRequest; onRefresh: () => Promise<void> }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const pending = request.status === 'pending';

    async function refresh() {
        setBusy(true);
        await onRefresh();
        setBusy(false);
    }

    async function withdraw() {
        setBusy(true);
        setErr('');
        try {
            await api.delete('/api/landlord-request');
            await onRefresh();
        } catch (e) {
            setErr(errorMessage(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className='mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8'>
            <div
                className={
                    'mx-auto flex h-14 w-14 items-center justify-center rounded-full ' + (pending ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700')
                }
            >
                {pending ? <Clock className='h-7 w-7' /> : <XCircle className='h-7 w-7' />}
            </div>
            <h1 className='mt-4 text-xl font-bold'>{pending ? 'Your landlord application is being reviewed' : 'Your landlord application was declined'}</h1>
            <p className='mt-2 text-sm text-slate-600'>
                {pending
                    ? 'The site owner will check your details. Your landlord account opens as soon as it is approved. Use Check status to see if it is ready.'
                    : 'The site owner did not approve this application. You can start again with corrected details or contact the site owner.'}
            </p>
            {!pending && request.reason && <p className='mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>Reason: {request.reason}</p>}
            <dl className='mt-6 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-left text-sm'>
                <dt className='text-slate-500'>Name</dt>
                <dd className='font-medium'>{request.name}</dd>
                <dt className='text-slate-500'>Phone</dt>
                <dd className='font-medium'>{request.phone}</dd>
                <dt className='text-slate-500'>Location</dt>
                <dd className='font-medium'>{request.location}</dd>
                <dt className='text-slate-500'>Plots</dt>
                <dd className='font-medium'>{request.plots}</dd>
                <dt className='text-slate-500'>Submitted</dt>
                <dd className='font-medium'>{formatDateTime(request.createdAt)}</dd>
            </dl>
            {err && (
                <div className='mt-4 text-left'>
                    <ErrorLine text={err} />
                </div>
            )}
            <div className='mt-6 flex flex-wrap justify-center gap-2'>
                {pending && (
                    <button
                        onClick={refresh}
                        disabled={busy}
                        className='inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50'
                    >
                        <RefreshCw className={'h-4 w-4 ' + (busy ? 'animate-spin' : '')} />
                        Check status
                    </button>
                )}
                <button
                    onClick={withdraw}
                    disabled={busy}
                    className='inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50'
                >
                    {pending ? 'Cancel application' : 'Start again'}
                </button>
            </div>
            <p className='mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-500'>
                <ShieldCheck className='h-3.5 w-3.5' />
                Only approved landlords can see tenant or payment information.
            </p>
        </div>
    );
}
