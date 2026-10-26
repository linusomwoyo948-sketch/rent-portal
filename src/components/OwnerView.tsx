import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../platform/client';
import { AlertCircle, Building2, CheckCircle2, Download, Inbox, Loader2, MapPin, Phone, ShieldCheck, Trash2, Upload, UserPlus } from 'lucide-react';
import StatusBadge from './StatusBadge';
import ManagersCard from './ManagersCard';
import { DialogHost, askDialog, confirmDialog } from './Dialog';
import type { LandlordRequest, LandlordRow } from '../types';
import { errorMessage, formatDateTime } from '../util';

type AuditEntry = { id: string; at: number; by: string; action: string; detail: string };

export default function OwnerView({ isMainOwner = true }: { isMainOwner?: boolean }) {
    const [rows, setRows] = useState<LandlordRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState(false);
    const [formErr, setFormErr] = useState('');
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [requests, setRequests] = useState<LandlordRequest[]>([]);
    const [deciding, setDeciding] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [restoring, setRestoring] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [l, a, r] = await Promise.all([api.get('/api/owner/landlords'), api.get('/api/owner/audit'), api.get('/api/owner/requests')]);
            setRows(l.data.landlords as LandlordRow[]);
            setRequests(r.data.requests as LandlordRequest[]);
            setEntries(a.data.entries as AuditEntry[]);
            setError('');
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    function flash(message: string) {
        setNotice(message);
        setError('');
        window.setTimeout(() => setNotice(''), 6000);
    }

    async function add(e: FormEvent) {
        e.preventDefault();
        const value = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            setFormErr('Enter a valid email address.');
            return;
        }
        if (!name.trim()) {
            setFormErr('Enter the landlord\'s name.');
            return;
        }
        setBusy(true);
        setFormErr('');
        try {
            const res = await api.post('/api/owner/landlords', { email: value, name, phone });
            setRows((prev) => [res.data.landlord as LandlordRow, ...prev]);
            setEmail('');
            setName('');
            setPhone('');
            flash(name + ' can now sign in with ' + value + ' and set up their plots.');
        } catch (ex) {
            setFormErr(errorMessage(ex));
        } finally {
            setBusy(false);
        }
    }

    async function restoreBackup(file: File) {
        let backup: unknown;
        try {
            backup = JSON.parse(await file.text());
        } catch {
            setError('That file could not be read. Choose the .json backup file you downloaded.');
            return;
        }
        const b = backup as { format?: string; exportedAt?: number; tables?: Record<string, unknown[]> };
        if (!b || b.format !== 'rent-portal-backup' || !b.tables) {
            setError('That is not a Rent Portal backup file.');
            return;
        }
        const when = b.exportedAt ? formatDateTime(b.exportedAt) : 'an unknown date';
        const typed = await askDialog({
            title: 'Restore from backup',
            message: 'This replaces ALL data on this site with the backup made on ' + when + '. Anything added here after that backup will be lost.',
            confirmLabel: 'Replace all data',
            danger: true,
            input: { label: 'Type REPLACE to confirm', placeholder: 'REPLACE', requireText: 'REPLACE' },
        });
        if (typed !== 'REPLACE') {
            return;
        }
        setRestoring(true);
        try {
            const res = await api.post('/api/owner/import', { confirm: 'REPLACE', backup: b });
            flash('Backup restored: ' + res.data.records + ' records. Reloading…');
            setTimeout(() => window.location.reload(), 1500);
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setRestoring(false);
        }
    }

    async function downloadBackup() {
        setExporting(true);
        try {
            const res = await api.get('/api/owner/export');
            const blob = new Blob([JSON.stringify(res.data)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'rent-portal-backup-' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            flash('Backup downloaded. Keep the file private: it contains tenants\' names, phone numbers and payments.');
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setExporting(false);
        }
    }

    async function approveRequest(r: LandlordRequest) {
        if (!(await confirmDialog('Approve ' + r.name + ' (' + r.email + ') as a landlord? They will be able to create plots and approve tenants.', { confirmLabel: 'Approve landlord' }))) {
            return;
        }
        setDeciding(r.id || '');
        try {
            const res = await api.post('/api/owner/requests/' + r.id + '/approve');
            setRows((prev) => [res.data.landlord as LandlordRow, ...prev]);
            setRequests((prev) => prev.filter((x) => x.id !== r.id));
            flash(r.name + ' is now a landlord and can sign in to set up their plots.');
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setDeciding(null);
        }
    }

    async function declineRequest(r: LandlordRequest) {
        const reason = await askDialog({
            title: 'Decline ' + r.name + '?',
            message: 'They will see that their application was declined and can apply again with corrected details.',
            confirmLabel: 'Decline application',
            danger: true,
            input: { label: 'Reason shown to the applicant (optional)', placeholder: 'e.g. Could not confirm ownership of the plot' },
        });
        if (reason === null) {
            return;
        }
        setDeciding(r.id || '');
        try {
            await api.post('/api/owner/requests/' + r.id + '/decline', { reason });
            setRequests((prev) => prev.filter((x) => x.id !== r.id));
            flash('Application from ' + r.name + ' declined.');
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setDeciding(null);
        }
    }

    async function setStatus(r: LandlordRow, status: 'active' | 'suspended') {
        if (
            status === 'suspended' &&
            !(await confirmDialog('Pause ' + r.name + '? They, their caretakers and their tenants will not be able to use the portal until you reactivate them.', {
                confirmLabel: 'Pause landlord',
                danger: true,
            }))
        ) {
            return;
        }
        try {
            await api.post('/api/owner/landlords/' + r.id + '/status', { status });
            setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)));
            flash(status === 'active' ? r.name + ' has been reactivated.' : r.name + ' has been paused.');
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    async function remove(r: LandlordRow) {
        if (
            !(await confirmDialog('Remove ' + r.name + ' as a landlord? Their plots and caretakers are deleted. This cannot be undone.', {
                confirmLabel: 'Remove landlord',
                danger: true,
            }))
        ) {
            return;
        }
        try {
            await api.delete('/api/owner/landlords/' + r.id);
            setRows((prev) => prev.filter((x) => x.id !== r.id));
            flash(r.name + ' has been removed.');
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    const plotCount = rows.reduce((s, r) => s + r.plots.length, 0);
    const tenantCount = rows.reduce((s, r) => s + r.tenantCount, 0);
    const stats = [
        { label: 'Landlord applications', value: String(requests.length) },
        { label: 'Landlords', value: String(rows.length) },
        { label: 'Plots', value: String(plotCount) },
        { label: 'Active tenants', value: String(tenantCount) },
    ];

    return (
        <div className='space-y-6'>
            <div>
                <DialogHost />
                <h1 className='text-2xl font-bold'>{isMainOwner ? 'Site owner' : 'Site manager'}</h1>
                <p className='text-sm text-slate-600'>Admit landlords to the portal. Each landlord manages their own plots, tenants and payments.</p>
            </div>

            <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
                {stats.map((s) => (
                    <div key={s.label} className='rounded-xl border border-slate-200 bg-white p-4'>
                        <p className='text-xs text-slate-500'>{s.label}</p>
                        <p className='mt-1 text-xl font-bold'>{loading ? '…' : s.value}</p>
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

            <section className={'rounded-2xl border bg-white ' + (requests.length > 0 ? 'border-amber-200' : 'border-slate-200')}>
                <div className={'border-b p-4 ' + (requests.length > 0 ? 'border-amber-100 bg-amber-50' : 'border-slate-100')}>
                    <h2 className='flex items-center gap-2 font-semibold'>
                        <Inbox className='h-5 w-5 text-amber-600' />
                        Landlord applications{requests.length > 0 ? ' (' + requests.length + ')' : ''}
                    </h2>
                    <p className='mt-1 text-sm text-slate-600'>
                        People who signed in and applied to be landlords. Check their details, for example by calling them, before approving.
                    </p>
                </div>
                {loading ? (
                    <div className='flex justify-center py-8'>
                        <Loader2 className='h-6 w-6 animate-spin text-slate-400' />
                    </div>
                ) : requests.length === 0 ? (
                    <p className='py-8 text-center text-sm text-slate-500'>No applications waiting.</p>
                ) : (
                    <ul className='divide-y divide-slate-100'>
                        {requests.map((r) => (
                            <li key={r.id} className='flex flex-wrap items-start justify-between gap-3 p-4'>
                                <div className='min-w-0'>
                                    <p className='font-semibold'>
                                        {r.name} <span className='text-sm font-normal text-slate-500'>· {r.email}</span>
                                    </p>
                                    <p className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600'>
                                        <span className='inline-flex items-center gap-1'>
                                            <Phone className='h-3.5 w-3.5' />
                                            {r.phone}
                                        </span>
                                        <span className='inline-flex items-center gap-1'>
                                            <MapPin className='h-3.5 w-3.5' />
                                            {r.location}
                                        </span>
                                    </p>
                                    <p className='mt-1 text-sm'>
                                        <span className='text-slate-500'>Plots:</span> {r.plots}
                                        {r.units ? <span className='text-slate-500'> · {r.units} units</span> : null}
                                    </p>
                                    {r.message && <p className='mt-1 break-words text-sm italic text-slate-600'>{r.message}</p>}
                                    <p className='mt-1 text-xs text-slate-500'>Applied {formatDateTime(r.createdAt)}</p>
                                </div>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <button
                                        onClick={() => approveRequest(r)}
                                        disabled={deciding === r.id}
                                        className='inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60'
                                    >
                                        {deciding === r.id && <Loader2 className='h-4 w-4 animate-spin' />}
                                        Approve
                                    </button>
                                    <button
                                        onClick={() => declineRequest(r)}
                                        disabled={deciding === r.id}
                                        className='rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50'
                                    >
                                        Decline
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className='rounded-2xl border border-slate-200 bg-white p-5'>
                <h2 className='flex items-center gap-2 font-semibold'>
                    <UserPlus className='h-5 w-5 text-emerald-600' />
                    Add a landlord directly
                </h2>
                <p className='mt-1 text-sm text-slate-600'>
                    For landlords you already know. They sign in with this email address, create their plots, and tenants join by entering the plot name.
                </p>
                <form onSubmit={add} noValidate className='mt-3 grid gap-3 sm:grid-cols-4'>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder='Full name'
                        className='rounded-lg border border-slate-300 px-3 py-2 text-sm'
                    />
                    <input
                        type='email'
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder='Email address'
                        className='rounded-lg border border-slate-300 px-3 py-2 text-sm'
                    />
                    <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder='Phone (optional)'
                        inputMode='tel'
                        className='rounded-lg border border-slate-300 px-3 py-2 text-sm'
                    />
                    <button
                        type='submit'
                        disabled={busy}
                        className='inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-70'
                    >
                        {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : <UserPlus className='h-4 w-4' />}
                        Add landlord
                    </button>
                </form>
                {formErr && (
                    <p role='alert' className='mt-2 text-sm text-rose-700'>
                        {formErr}
                    </p>
                )}
            </section>

            <section className='rounded-2xl border border-slate-200 bg-white'>
                <div className='border-b border-slate-100 p-4'>
                    <h2 className='flex items-center gap-2 font-semibold'>
                        <Building2 className='h-5 w-5 text-emerald-600' />
                        Landlords
                    </h2>
                </div>
                {loading ? (
                    <div className='flex justify-center py-12'>
                        <Loader2 className='h-6 w-6 animate-spin text-slate-400' />
                    </div>
                ) : rows.length === 0 ? (
                    <p className='py-12 text-center text-sm text-slate-500'>No landlords yet. Add the first one above.</p>
                ) : (
                    <ul className='divide-y divide-slate-100'>
                        {rows.map((r) => (
                            <li key={r.id} className='flex flex-wrap items-start justify-between gap-3 p-4'>
                                <div className='min-w-0'>
                                    <p className='font-medium'>
                                        {r.name || r.email} <span className='text-sm font-normal text-slate-500'>· {r.email}</span>
                                    </p>
                                    <p className='text-xs text-slate-500'>
                                        {r.phone ? r.phone + ' · ' : ''}added {formatDateTime(r.addedAt)} · {r.tenantCount} active tenant
                                        {r.tenantCount === 1 ? '' : 's'}
                                        {r.pendingCount ? ', ' + r.pendingCount + ' waiting for approval' : ''}
                                    </p>
                                    <p className='mt-1 text-xs'>
                                        {r.plots.length > 0 ? (
                                            r.plots.map((p) => (
                                                <span key={p} className='mr-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-slate-700'>
                                                    {p}
                                                </span>
                                            ))
                                        ) : (
                                            <span className='text-amber-700'>No plots created yet</span>
                                        )}
                                    </p>
                                </div>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <StatusBadge status={r.status} />
                                    {r.status === 'active' ? (
                                        <button
                                            onClick={() => setStatus(r, 'suspended')}
                                            className='rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50'
                                        >
                                            Pause
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => setStatus(r, 'active')}
                                            className='rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50'
                                        >
                                            Reactivate
                                        </button>
                                    )}
                                    {isMainOwner && (
                                        <button
                                            onClick={() => remove(r)}
                                            aria-label={'Remove ' + r.name}
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

            <ManagersCard canManage={isMainOwner} onNotice={flash} />

            {isMainOwner && (
            <section className='flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5'>
                <div>
                    <h2 className='flex items-center gap-2 font-semibold'>
                        <Download className='h-5 w-5 text-emerald-600' />
                        Backup
                    </h2>
                    <p className='mt-1 text-sm text-slate-600'>
                        Download every landlord, plot, tenant, bill and payment as one file. Use it to keep a safe copy, or restore a backup file to replace all data on this site.
                    </p>
                </div>
                <button
                    onClick={downloadBackup}
                    disabled={exporting}
                    className='inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60'
                >
                    {exporting ? <Loader2 className='h-4 w-4 animate-spin' /> : <Download className='h-4 w-4' />}
                    Download backup
                </button>
                <label
                    className={'inline-flex cursor-pointer items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50' + (restoring ? ' pointer-events-none opacity-60' : '')}
                >
                    {restoring ? <Loader2 className='h-4 w-4 animate-spin' /> : <Upload className='h-4 w-4' />}
                    Restore from backup
                    <input
                        type='file'
                        accept='application/json,.json'
                        className='sr-only'
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) {
                                restoreBackup(f);
                            }
                        }}
                    />
                </label>
            </section>
            )}

            <section className='rounded-2xl border border-slate-200 bg-white p-5'>
                <h2 className='flex items-center gap-2 font-semibold'>
                    <ShieldCheck className='h-5 w-5 text-emerald-600' />
                    Activity log
                </h2>
                {entries.length === 0 ? (
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
            </section>
        </div>
    );
}
