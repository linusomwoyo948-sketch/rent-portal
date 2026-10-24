import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../platform/client';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import type { Bill, Payment, Plot, Tenant } from '../types';
import { currentMonth, errorMessage, formatDate, formatKES } from '../util';
import { receiptNumber } from './Receipt';
import { tenancyStartMonth } from './Statement';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Row = {
    key: string;
    unit: string;
    tenant: string;
    rent: number;
    startMonth: string;
    active: boolean;
    months: number[];
    total: number;
};

export default function Reports({ plots }: { plots: Plot[] }) {
    const thisYear = new Date().getFullYear();
    const [year, setYear] = useState(thisYear);
    const [view, setView] = useState<'year' | 'month'>('year');
    const [monthIndex, setMonthIndex] = useState(new Date().getMonth());
    const [allPayments, setPayments] = useState<Payment[]>([]);
    const [allTenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [truncated, setTruncated] = useState(false);
    const [allBills, setBills] = useState<Bill[]>([]);
    const [plotId, setPlotId] = useState('all');
    const tenants = plotId === 'all' ? allTenants : allTenants.filter((t) => t.plotId === plotId);
    const tenantIdSet = new Set(tenants.map((t) => t.userId));
    const payments = plotId === 'all' ? allPayments : allPayments.filter((p) => tenantIdSet.has(p.tenantId));
    const bills = plotId === 'all' ? allBills : allBills.filter((b) => tenantIdSet.has(b.tenantId));
    const selectedPlot = plots.find((p) => p.id === plotId);

    const load = useCallback(async (y: number) => {
        setLoading(true);
        try {
            const res = await api.get('/api/admin/reports?year=' + y);
            setPayments(res.data.payments as Payment[]);
            setTenants(res.data.tenants as Tenant[]);
            setBills((res.data.bills as Bill[]) || []);
            setTruncated(!!res.data.truncated);
            setErr('');
        } catch (e) {
            setErr(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load(year);
    }, [load, year]);

    const rows = useMemo(() => {
        const map = new Map<string, Row>();
        tenants
            .filter((t) => t.status === 'approved' || t.status === 'suspended')
            .forEach((t) =>
                map.set(t.userId, {
                    key: t.userId,
                    unit: t.unit,
                    tenant: t.name,
                    rent: t.monthlyRent,
                    startMonth: tenancyStartMonth(t),
                    active: true,
                    months: new Array<number>(12).fill(0),
                    total: 0,
                })
            );
        payments.forEach((p) => {
            let r = map.get(p.tenantId);
            if (!r) {
                r = {
                    key: p.tenantId,
                    unit: p.unit,
                    tenant: p.tenantName,
                    rent: 0,
                    startMonth: '9999-12',
                    active: false,
                    months: new Array<number>(12).fill(0),
                    total: 0,
                };
                map.set(p.tenantId, r);
            }
            const mi = Number(p.month.slice(5, 7)) - 1;
            if (mi >= 0 && mi < 12) {
                r.months[mi] += p.amount;
                r.total += p.amount;
            }
        });
        return [...map.values()].sort((a, b) => a.unit.localeCompare(b.unit, undefined, { numeric: true }));
    }, [tenants, payments]);

    const monthTotals = MONTHS.map((_, i) => rows.reduce((s, r) => s + r.months[i], 0));
    const grandTotal = monthTotals.reduce((s, v) => s + v, 0);
    const now = currentMonth();

    function ym(i: number): string {
        return year + '-' + String(i + 1).padStart(2, '0');
    }

    const billMap = new Map(bills.map((b) => [b.tenantId + '|' + b.month, b.amount] as [string, number]));

    function dueFor(r: Row, i: number): number {
        const m = ym(i);
        if (bills.length > 0) {
            return billMap.get(r.key + '|' + m) ?? 0;
        }
        return r.active && m >= r.startMonth && m <= now ? r.rent : 0;
    }

    const monthRows = rows.map((r) => {
        const due = dueFor(r, monthIndex);
        const paid = r.months[monthIndex];
        return { ...r, due, paid, balance: Math.max(due - paid, 0) };
    });
    const monthDue = monthRows.reduce((s, r) => s + r.due, 0);
    const monthPaid = monthRows.reduce((s, r) => s + r.paid, 0);
    const monthBalance = monthRows.reduce((s, r) => s + r.balance, 0);

    async function exportExcel() {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        const title = (selectedPlot ? selectedPlot.name : plots.length === 1 ? plots[0].name : 'All plots') + ' - Rent collection report ' + year;

        const yearly: (string | number)[][] = [
            [title],
            ['Gross rent received from confirmed payments (KES), by rent month'],
            [],
            ['House / unit', 'Tenant', ...MONTHS, 'Total'],
        ];
        rows.forEach((r) => yearly.push([r.unit, r.tenant, ...r.months, r.total]));
        yearly.push(['Total', '', ...monthTotals, grandTotal]);
        const ws1 = XLSX.utils.aoa_to_sheet(yearly);
        ws1['!cols'] = [{ wch: 14 }, { wch: 26 }, ...MONTHS.map(() => ({ wch: 10 })), { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'Yearly summary');

        const monthly: (string | number)[][] = [
            [title],
            ['Rent due, paid and balance per unit for each month (KES)'],
            [],
            ['Month', 'House / unit', 'Tenant', 'Rent due', 'Paid', 'Balance'],
        ];
        MONTHS_LONG.forEach((name, i) => {
            if (ym(i) > now) {
                return;
            }
            let due = 0;
            let paid = 0;
            rows.forEach((r) => {
                const d = dueFor(r, i);
                const p = r.months[i];
                if (d === 0 && p === 0) {
                    return;
                }
                due += d;
                paid += p;
                monthly.push([name + ' ' + year, r.unit, r.tenant, d, p, Math.max(d - p, 0)]);
            });
            monthly.push([name + ' ' + year + ' total', '', '', due, paid, Math.max(due - paid, 0)]);
            monthly.push([]);
        });
        const ws2 = XLSX.utils.aoa_to_sheet(monthly);
        ws2['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Monthly detail');

        const detail: (string | number)[][] = [
            ['Date paid', 'Receipt no', 'M-Pesa code / reference', 'House / unit', 'Tenant', 'Rent month', 'Method', 'Amount (KES)'],
        ];
        [...payments]
            .sort((a, b) => (a.paidAt || a.createdAt) - (b.paidAt || b.createdAt))
            .forEach((p) =>
                detail.push([
                    formatDate(p.paidAt || p.createdAt),
                    receiptNumber(p),
                    p.mpesaReceipt || p.reference || '',
                    p.unit,
                    p.tenantName,
                    MONTHS_LONG[Number(p.month.slice(5, 7)) - 1] + ' ' + p.month.slice(0, 4),
                    p.method,
                    p.amount,
                ])
            );
        detail.push(['', '', '', '', '', '', 'Total', grandTotal]);
        const ws3 = XLSX.utils.aoa_to_sheet(detail);
        ws3['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 26 }, { wch: 16 }, { wch: 12 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws3, 'Payments');

        XLSX.writeFile(wb, 'rent-collection-' + year + '.xlsx');
    }

    const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3, thisYear - 4];

    return (
        <div className='space-y-4'>
            <div className='flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4'>
                <div className='flex flex-wrap items-end gap-3'>
                    {plots.length > 1 && (
                        <label className='text-xs font-medium text-slate-600'>
                            Plot
                            <select value={plotId} onChange={(e) => setPlotId(e.target.value)} className='mt-1 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm'>
                                <option value='all'>All plots</option>
                                {plots.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    <label className='text-xs font-medium text-slate-600'>
                        Year
                        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className='mt-1 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm'>
                            {years.map((y) => (
                                <option key={y} value={y}>
                                    {y}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className='flex rounded-lg border border-slate-300 p-0.5 text-sm'>
                        <button
                            onClick={() => setView('year')}
                            className={'rounded-md px-3 py-1 ' + (view === 'year' ? 'bg-emerald-600 text-white' : 'text-slate-600')}
                        >
                            Yearly by unit
                        </button>
                        <button
                            onClick={() => setView('month')}
                            className={'rounded-md px-3 py-1 ' + (view === 'month' ? 'bg-emerald-600 text-white' : 'text-slate-600')}
                        >
                            Monthly
                        </button>
                    </div>
                    {view === 'month' && (
                        <label className='text-xs font-medium text-slate-600'>
                            Month
                            <select
                                value={monthIndex}
                                onChange={(e) => setMonthIndex(Number(e.target.value))}
                                className='mt-1 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm'
                            >
                                {MONTHS_LONG.map((m, i) => (
                                    <option key={m} value={i}>
                                        {m}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                </div>
                <button
                    onClick={exportExcel}
                    disabled={loading || !!err}
                    className='inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50'
                >
                    <Download className='h-4 w-4' />
                    Download Excel
                </button>
            </div>

            {truncated && (
                <p className='rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800'>
                    This year has more payments than one report can load, so the totals may be incomplete.
                </p>
            )}

            {loading ? (
                <div className='flex justify-center py-16'>
                    <Loader2 className='h-6 w-6 animate-spin text-slate-400' />
                </div>
            ) : err ? (
                <p role='alert' className='flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>
                    <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
                    {err}
                </p>
            ) : rows.length === 0 ? (
                <p className='rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500'>
                    No tenants or payments for {year} yet.
                </p>
            ) : view === 'year' ? (
                <div className='overflow-x-auto rounded-2xl border border-slate-200 bg-white'>
                    <table className='w-full min-w-[900px] text-sm'>
                        <thead>
                            <tr className='border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500'>
                                <th className='px-3 py-2 font-medium'>Unit</th>
                                <th className='px-3 py-2 font-medium'>Tenant</th>
                                {MONTHS.map((m) => (
                                    <th key={m} className='px-2 py-2 text-right font-medium'>
                                        {m}
                                    </th>
                                ))}
                                <th className='px-3 py-2 text-right font-medium'>Total</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-slate-100'>
                            {rows.map((r) => (
                                <tr key={r.key}>
                                    <td className='px-3 py-2 font-medium'>{r.unit}</td>
                                    <td className='px-3 py-2'>{r.tenant}</td>
                                    {r.months.map((v, i) => (
                                        <td key={i} className={'px-2 py-2 text-right ' + (v ? '' : 'text-slate-300')}>
                                            {v ? v.toLocaleString('en-KE') : '-'}
                                        </td>
                                    ))}
                                    <td className='px-3 py-2 text-right font-semibold'>{r.total.toLocaleString('en-KE')}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className='border-t-2 border-slate-200 bg-slate-50 font-semibold'>
                                <td className='px-3 py-2'>Total</td>
                                <td />
                                {monthTotals.map((v, i) => (
                                    <td key={i} className='px-2 py-2 text-right'>
                                        {v.toLocaleString('en-KE')}
                                    </td>
                                ))}
                                <td className='px-3 py-2 text-right text-emerald-700'>{formatKES(grandTotal)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            ) : (
                <div className='overflow-x-auto rounded-2xl border border-slate-200 bg-white'>
                    <table className='w-full min-w-[560px] text-sm'>
                        <thead>
                            <tr className='border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500'>
                                <th className='px-3 py-2 font-medium'>Unit</th>
                                <th className='px-3 py-2 font-medium'>Tenant</th>
                                <th className='px-3 py-2 text-right font-medium'>Rent due</th>
                                <th className='px-3 py-2 text-right font-medium'>Paid</th>
                                <th className='px-3 py-2 text-right font-medium'>Balance</th>
                            </tr>
                        </thead>
                        <tbody className='divide-y divide-slate-100'>
                            {monthRows.map((r) => (
                                <tr key={r.key}>
                                    <td className='px-3 py-2 font-medium'>{r.unit}</td>
                                    <td className='px-3 py-2'>{r.tenant}</td>
                                    <td className='px-3 py-2 text-right'>{formatKES(r.due)}</td>
                                    <td className='px-3 py-2 text-right text-emerald-700'>{formatKES(r.paid)}</td>
                                    <td className={'px-3 py-2 text-right ' + (r.balance > 0 ? 'text-amber-700' : '')}>{formatKES(r.balance)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className='border-t-2 border-slate-200 bg-slate-50 font-semibold'>
                                <td className='px-3 py-2'>Total</td>
                                <td />
                                <td className='px-3 py-2 text-right'>{formatKES(monthDue)}</td>
                                <td className='px-3 py-2 text-right text-emerald-700'>{formatKES(monthPaid)}</td>
                                <td className='px-3 py-2 text-right'>{formatKES(monthBalance)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
            <p className='text-xs text-slate-500'>
                Figures count only payments confirmed by M-Pesa, grouped by the rent month they were paid for. Use the Excel file for your own accounts and when filing rental income with KRA.
            </p>
        </div>
    );
}
