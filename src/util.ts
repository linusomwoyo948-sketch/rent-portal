import type { Bill } from './types';

export const MANUAL_METHODS = ['Bank transfer', 'Cash', 'M-Pesa (sent directly)'];

export type BillLine = Bill & { paid: number; outstanding: number };

// Payments clear the oldest bills first, so unpaid amounts carry forward.
export function allocateBills(bills: Bill[], paidTotal: number): BillLine[] {
    const sorted = [...bills].sort((a, b) => a.month.localeCompare(b.month));
    let pool = paidTotal;
    return sorted.map((b) => {
        const applied = Math.max(0, Math.min(pool, b.amount));
        pool -= applied;
        return { ...b, paid: applied, outstanding: b.amount - applied };
    });
}

const kes = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
});

export function formatKES(value: number): string {
    return kes.format(value || 0).replace(/ /g, ' ');
}

export function formatMonth(month: string): string {
    const [year, m] = month.split('-').map(Number);
    if (!year || !m) {
        return month;
    }
    return new Date(year, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

export function formatDateTime(ts: number): string {
    return new Date(ts).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function formatPhone(phone?: string): string {
    if (!phone) {
        return '';
    }
    const d = phone.replace(/\D/g, '');
    return d.startsWith('254') ? '+' + d : phone;
}

export function currentMonth(): string {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function errorMessage(e: unknown): string {
    const err = e as { response?: { data?: { error?: string; message?: string } }; message?: string };
    return (
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'Something went wrong. Please try again.'
    );
}
