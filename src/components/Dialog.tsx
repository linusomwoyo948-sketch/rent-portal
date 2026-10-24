import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

type DialogOptions = {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    input?: {
        label: string;
        placeholder?: string;
        defaultValue?: string;
        requireText?: string;
        numeric?: boolean;
    };
};

type Pending = DialogOptions & { resolve: (value: string | null) => void };

let openDialog: ((p: Pending) => void) | null = null;

// Shows the in-app dialog. Resolves with the typed value ('' when there is no input), or null when cancelled.
export function askDialog(options: DialogOptions): Promise<string | null> {
    return new Promise((resolve) => {
        if (openDialog) {
            openDialog({ ...options, resolve });
        } else {
            resolve(null);
        }
    });
}

export async function confirmDialog(message: string, options?: Partial<DialogOptions>): Promise<boolean> {
    const result = await askDialog({ title: 'Please confirm', confirmLabel: 'Yes, continue', ...options, message });
    return result !== null;
}

export function DialogHost() {
    const [pending, setPending] = useState<Pending | null>(null);
    const [value, setValue] = useState('');

    useEffect(() => {
        openDialog = (p) => {
            setValue(p.input?.defaultValue ?? '');
            setPending(p);
        };
        return () => {
            openDialog = null;
        };
    }, []);

    useEffect(() => {
        if (!pending) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                pending.resolve(null);
                setPending(null);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [pending]);

    if (!pending) {
        return null;
    }

    const required = pending.input?.requireText;
    const blocked = !!required && value.trim().toUpperCase() !== required.toUpperCase();

    function finish(result: string | null) {
        if (!pending) {
            return;
        }
        pending.resolve(result);
        setPending(null);
    }

    return (
        <div className='fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4' role='dialog' aria-modal='true'>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    if (!blocked) {
                        finish(pending.input ? value : '');
                    }
                }}
                className='w-full max-w-md rounded-2xl bg-white p-5 shadow-xl'
            >
                <div className='flex items-start justify-between gap-3'>
                    <h2 className='flex items-center gap-2 text-lg font-semibold'>
                        {pending.danger && <AlertTriangle className='h-5 w-5 text-rose-600' />}
                        {pending.title}
                    </h2>
                    <button type='button' onClick={() => finish(null)} aria-label='Close' className='rounded-lg p-1 text-slate-500 hover:bg-slate-100'>
                        <X className='h-5 w-5' />
                    </button>
                </div>
                <p className='mt-2 whitespace-pre-line text-sm text-slate-600'>{pending.message}</p>
                {pending.input && (
                    <label className='mt-4 block text-sm font-medium text-slate-700'>
                        {pending.input.label}
                        <input
                            autoFocus
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={pending.input.placeholder}
                            inputMode={pending.input.numeric ? 'numeric' : 'text'}
                            className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100'
                        />
                    </label>
                )}
                <div className='mt-5 flex justify-end gap-2'>
                    <button type='button' onClick={() => finish(null)} className='rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50'>
                        Cancel
                    </button>
                    <button
                        type='submit'
                        disabled={blocked}
                        className={
                            'rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 ' +
                            (pending.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700')
                        }
                    >
                        {pending.confirmLabel || 'OK'}
                    </button>
                </div>
            </form>
        </div>
    );
}
