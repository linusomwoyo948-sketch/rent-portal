import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, Trash2, UserCog, UserPlus } from 'lucide-react';
import { api } from '../platform/client';
import { confirmDialog } from './Dialog';
import { errorMessage, formatDateTime } from '../util';

type Manager = { id: string; email: string; name: string; addedAt: number; addedBy: string; status?: 'active' | 'paused' };

// Site managers help the site owner run the owner page. Only the site owner can add or remove them.
export default function ManagersCard({ canManage, onNotice }: { canManage: boolean; onNotice: (m: string) => void }) {
    const [managers, setManagers] = useState<Manager[] | null>(null);
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    useEffect(() => {
        api.get('/api/owner/managers')
            .then((res) => setManagers(res.data.managers as Manager[]))
            .catch((e) => {
                setManagers([]);
                setErr(errorMessage(e));
            });
    }, []);

    async function add(e: FormEvent) {
        e.preventDefault();
        const value = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            setErr('Enter a valid email address.');
            return;
        }
        if (!name.trim()) {
            setErr('Enter the site manager\'s name.');
            return;
        }
        setBusy(true);
        setErr('');
        try {
            const res = await api.post('/api/owner/managers', { email: value, name: name.trim() });
            setManagers((prev) => [...(prev ?? []), res.data.manager as Manager]);
            setEmail('');
            setName('');
            onNotice(name.trim() + ' can now sign in with ' + value + ' and help manage the site owner page.');
        } catch (ex) {
            setErr(errorMessage(ex));
        } finally {
            setBusy(false);
        }
    }

    async function setStatus(m: Manager, status: 'active' | 'paused') {
        if (
            status === 'paused' &&
            !(await confirmDialog('Pause ' + m.name + '? They will not be able to open the site owner page until you reactivate them.', { confirmLabel: 'Pause manager' }))
        ) {
            return;
        }
        try {
            await api.post('/api/owner/managers/' + encodeURIComponent(m.id) + '/status', { status });
            setManagers((prev) => (prev ?? []).map((x) => (x.id === m.id ? { ...x, status } : x)));
            onNotice(status === 'paused' ? m.name + ' is paused.' : m.name + ' can use the site owner page again.');
        } catch (ex) {
            setErr(errorMessage(ex));
        }
    }

    async function remove(m: Manager) {
        if (!(await confirmDialog('Remove ' + m.name + ' as a site manager? They will no longer be able to open the site owner page.', { confirmLabel: 'Remove manager', danger: true }))) {
            return;
        }
        try {
            await api.delete('/api/owner/managers/' + encodeURIComponent(m.id));
            setManagers((prev) => (prev ?? []).filter((x) => x.id !== m.id));
            onNotice(m.name + ' is no longer a site manager.');
        } catch (ex) {
            setErr(errorMessage(ex));
        }
    }

    const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

    return (
        <section className='rounded-2xl border border-slate-200 bg-white p-5'>
            <h2 className='flex items-center gap-2 font-semibold'>
                <UserCog className='h-5 w-5 text-emerald-600' />
                Site managers
            </h2>
            <p className='mt-1 text-sm text-slate-600'>
                {canManage
                    ? 'Site managers can do everything on this page that you can, except manage site managers. Only you can add, pause or remove them, and nobody can pause or remove the site owner.'
                    : 'Site managers can do everything on this page except add, pause or remove site managers. Only the site owner can do that.'}
            </p>

            {canManage && (
                <form onSubmit={add} noValidate className='mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]'>
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder='Full name' aria-label='Site manager name' className={field} />
                    <input
                        type='email'
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        maxLength={120}
                        placeholder='Email they sign in with'
                        aria-label='Site manager email'
                        className={field}
                    />
                    <button
                        type='submit'
                        disabled={busy}
                        className='inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-70'
                    >
                        {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : <UserPlus className='h-4 w-4' />}
                        Add manager
                    </button>
                </form>
            )}
            {err && (
                <p role='alert' className='mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>
                    {err}
                </p>
            )}

            {managers === null ? (
                <p className='mt-4 flex items-center gap-2 text-sm text-slate-500'>
                    <Loader2 className='h-4 w-4 animate-spin' /> Loading…
                </p>
            ) : managers.length === 0 ? (
                <p className='mt-4 text-sm text-slate-500'>No site managers yet.</p>
            ) : (
                <ul className='mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200'>
                    {managers.map((m) => (
                        <li key={m.id} className='flex items-center justify-between gap-3 p-3'>
                            <div className='min-w-0'>
                                <p className='flex flex-wrap items-center gap-2 font-medium'>
                                    {m.name}
                                    {m.status === 'paused' ? (
                                        <span className='rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'>Paused</span>
                                    ) : (
                                        <span className='rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700'>Active</span>
                                    )}
                                </p>
                                <p className='truncate text-sm text-slate-600'>{m.email}</p>
                                <p className='text-xs text-slate-400'>Added {formatDateTime(m.addedAt)}</p>
                            </div>
                            {canManage && (
                                <div className='flex shrink-0 items-center gap-2'>
                                <button
                                    onClick={() => setStatus(m, m.status === 'paused' ? 'active' : 'paused')}
                                    className='rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50'
                                >
                                    {m.status === 'paused' ? 'Reactivate' : 'Pause'}
                                </button>
                                <button
                                    onClick={() => remove(m)}
                                    aria-label={'Remove ' + m.name}
                                    className='rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                                >
                                    <Trash2 className='h-4 w-4' />
                                </button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
