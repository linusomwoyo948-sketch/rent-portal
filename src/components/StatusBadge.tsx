const STYLES: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-200',
    processing: 'bg-sky-50 text-sky-700 ring-sky-200',
    approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
    failed: 'bg-rose-50 text-rose-700 ring-rose-200',
    suspended: 'bg-slate-100 text-slate-600 ring-slate-200',
    partial: 'bg-amber-50 text-amber-700 ring-amber-200',
    unpaid: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const LABELS: Record<string, string> = {
    pending: 'Awaiting approval',
    processing: 'Processing',
    approved: 'Approved',
    active: 'Active',
    confirmed: 'Paid',
    rejected: 'Rejected',
    failed: 'Failed',
    suspended: 'Suspended',
    partial: 'Part paid',
    unpaid: 'Unpaid',
};

export default function StatusBadge({ status }: { status: string }) {
    return (
        <span
            className={
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ' +
                (STYLES[status] ?? STYLES.suspended)
            }
        >
            {LABELS[status] ?? status}
        </span>
    );
}
