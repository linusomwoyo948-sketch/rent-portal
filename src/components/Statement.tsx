import { useEffect, useMemo, useState } from 'react';
import { Download, Printer, X } from 'lucide-react';
import type { Bill, Payment, Tenant } from '../types';
import { currentMonth, formatDate, formatDateTime, formatKES, formatMonth } from '../util';

function addMonths(month: string, n: number): string {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function monthOfTs(ts: number): string {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function firstDayLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return formatDate(new Date(y, m - 1, 1).getTime());
}

function balanceText(n: number): string {
    if (n < 0) {
        return formatKES(-n) + ' CR';
    }
    return formatKES(n);
}

type Line = { date: string; description: string; charged: number; paid: number; balance: number };

export function tenancyStartMonth(tenant: Tenant): string {
    return monthOfTs(tenant.approvedAt || tenant.createdAt);
}

export function buildStatement(tenant: Tenant, payments: Payment[], from: string, to: string, bills?: Bill[]) {
    const start = tenancyStartMonth(tenant);
    const now = currentMonth();
    const rent = tenant.monthlyRent || 0;
    const confirmed = payments.filter((p) => p.status === 'confirmed');
    const billList = bills ?? [];
    const usesBills = billList.length > 0;
    const billMap = new Map(billList.map((b) => [b.month, b.amount] as [string, number]));
    const due = (m: string) => (usesBills ? billMap.get(m) ?? 0 : m >= start && m <= now ? rent : 0);

    let opening = 0;
    let guard = 0;
    if (usesBills) {
        billList.forEach((b) => {
            if (b.month < from) {
                opening += b.amount;
            }
        });
    } else {
        for (let m = start; m < from && guard < 600; m = addMonths(m, 1), guard++) {
            opening += due(m);
        }
    }
    opening -= confirmed.filter((p) => p.month < from).reduce((s, p) => s + p.amount, 0);

    const lines: Line[] = [];
    let balance = opening;
    let charged = 0;
    let paid = 0;
    guard = 0;
    for (let m = from; m <= to && guard < 60; m = addMonths(m, 1), guard++) {
        const r = due(m);
        if (r > 0) {
            balance += r;
            charged += r;
            lines.push({ date: firstDayLabel(m), description: 'Rent bill for ' + formatMonth(m), charged: r, paid: 0, balance });
        }
        confirmed
            .filter((p) => p.month === m)
            .sort((a, b) => (a.paidAt || a.createdAt) - (b.paidAt || b.createdAt))
            .forEach((p) => {
                balance -= p.amount;
                paid += p.amount;
                const ref = p.mpesaReceipt ? 'M-Pesa ' + p.mpesaReceipt : p.reference;
                lines.push({
                    date: formatDate(p.paidAt || p.createdAt),
                    description: 'Payment for ' + formatMonth(m) + (ref ? ' - ' + ref : ''),
                    charged: 0,
                    paid: p.amount,
                    balance,
                });
            });
    }
    return { opening, charged, paid, closing: balance, lines, usesBills };
}

async function downloadPdf(tenant: Tenant, data: ReturnType<typeof buildStatement>, from: string, to: string, propertyName: string) {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 14;
    const R = 196;
    let y = 18;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(propertyName || 'Rent Portal', L, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(100, 116, 139);
    doc.text('Tenant statement: ' + formatMonth(from) + ' to ' + formatMonth(to), L, y);
    y += 4;
    doc.setDrawColor(5, 150, 105);
    doc.setLineWidth(0.6);
    doc.line(L, y, R, y);
    y += 8;

    doc.setFontSize(10);
    const info: [string, string][] = [
        ['Tenant', tenant.name],
        ['House / unit', tenant.unit],
        ['Phone', tenant.phone],
        ['Email', tenant.email],
        ['Generated', formatDateTime(Date.now())],
    ];
    info.forEach(([k, v]) => {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(k, L, y);
        doc.setTextColor(15, 23, 42);
        doc.text(v || '-', L + 32, y);
        y += 6;
    });
    y += 3;

    const summary: [string, string][] = [
        ['Opening balance', balanceText(data.opening)],
        ['Rent charged', formatKES(data.charged)],
        ['Payments received', formatKES(data.paid)],
        ['Closing balance', balanceText(data.closing)],
    ];
    const boxW = (R - L) / 4;
    summary.forEach(([k, v], i) => {
        const x = L + i * boxW;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(k, x, y);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        doc.text(v, x, y + 6);
    });
    y += 16;

    const header = () => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text('Date', L, y);
        doc.text('Description', L + 26, y);
        doc.text('Charged', 140, y, { align: 'right' });
        doc.text('Paid', 168, y, { align: 'right' });
        doc.text('Balance', R, y, { align: 'right' });
        y += 2;
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.3);
        doc.line(L, y, R, y);
        y += 5;
    };
    header();

    const row = (date: string, desc: string, charged: string, paid: string, bal: string) => {
        if (y > 280) {
            doc.addPage();
            y = 18;
            header();
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.text(date, L, y);
        doc.text(String(doc.splitTextToSize(desc, 84)[0] ?? ''), L + 26, y);
        doc.text(charged, 140, y, { align: 'right' });
        doc.text(paid, 168, y, { align: 'right' });
        doc.text(bal, R, y, { align: 'right' });
        y += 6;
    };

    row(firstDayLabel(from), 'Opening balance', '', '', balanceText(data.opening));
    data.lines.forEach((l) =>
        row(l.date, l.description, l.charged ? formatKES(l.charged) : '', l.paid ? formatKES(l.paid) : '', balanceText(l.balance))
    );

    y += 2;
    doc.setDrawColor(203, 213, 225);
    doc.line(L, y, R, y);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Closing balance', L, y);
    doc.text(balanceText(data.closing), R, y, { align: 'right' });
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
        (data.usesBills
            ? 'Charges are the monthly rent bills issued on the 1st of each month.'
            : 'Rent charges use the current monthly rent of ' + formatKES(tenant.monthlyRent) + '.') + ' CR means the tenant is in credit.',
        L,
        y
    );
    doc.save('statement-' + (tenant.unit.replace(/[^A-Za-z0-9]/g, '') || 'tenant') + '-' + from + '-to-' + to + '.pdf');
}

type Props = {
    tenant: Tenant;
    payments: Payment[];
    bills?: Bill[];
    propertyName: string;
    onClose: () => void;
};

export default function StatementModal({ tenant, payments, bills, propertyName, onClose }: Props) {
    const now = currentMonth();
    const start = tenancyStartMonth(tenant);
    const yearStart = now.slice(0, 4) + '-01';
    const [from, setFrom] = useState(start > yearStart ? start : yearStart);
    const [to, setTo] = useState(now);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const valid = !!from && !!to && from <= to;
    const data = useMemo(() => (valid ? buildStatement(tenant, payments, from, to, bills) : null), [valid, tenant, payments, from, to, bills]);

    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4' role='dialog' aria-modal='true'>
            <div className='flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl'>
                <div className='no-print flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-3'>
                    <div className='flex flex-wrap items-end gap-3'>
                        <label className='text-xs font-medium text-slate-600'>
                            From
                            <input type='month' value={from} onChange={(e) => setFrom(e.target.value)} className='mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm' />
                        </label>
                        <label className='text-xs font-medium text-slate-600'>
                            To
                            <input type='month' value={to} onChange={(e) => setTo(e.target.value)} className='mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm' />
                        </label>
                    </div>
                    <button onClick={onClose} aria-label='Close statement' className='rounded-lg p-1 text-slate-500 hover:bg-slate-100'>
                        <X className='h-5 w-5' />
                    </button>
                </div>

                <div className='print-area overflow-y-auto p-6'>
                    <p className='text-lg font-bold'>{propertyName || 'Rent Portal'}</p>
                    <p className='text-sm text-slate-500'>
                        Tenant statement{valid ? ': ' + formatMonth(from) + ' to ' + formatMonth(to) : ''}
                    </p>
                    <div className='mt-3 border-t-2 border-emerald-600 pt-3 text-sm'>
                        <p>
                            <span className='text-slate-500'>Tenant:</span> <span className='font-medium'>{tenant.name}</span>
                        </p>
                        <p>
                            <span className='text-slate-500'>House / unit:</span> <span className='font-medium'>{tenant.unit}</span>
                        </p>
                        <p>
                            <span className='text-slate-500'>Phone:</span> <span className='font-medium'>{tenant.phone}</span>
                        </p>
                    </div>

                    {!valid || !data ? (
                        <p role='alert' className='mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700'>
                            The start month must be the same as or before the end month.
                        </p>
                    ) : (
                        <>
                            <div className='mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4'>
                                {[
                                    ['Opening balance', balanceText(data.opening)],
                                    ['Rent charged', formatKES(data.charged)],
                                    ['Payments received', formatKES(data.paid)],
                                    ['Closing balance', balanceText(data.closing)],
                                ].map(([k, v]) => (
                                    <div key={k} className='rounded-lg bg-slate-50 p-3'>
                                        <p className='text-xs text-slate-500'>{k}</p>
                                        <p className='font-bold'>{v}</p>
                                    </div>
                                ))}
                            </div>
                            <div className='mt-4 overflow-x-auto'>
                                <table className='w-full min-w-[560px] text-sm'>
                                    <thead>
                                        <tr className='border-b border-slate-200 text-left text-xs text-slate-500'>
                                            <th className='py-2 pr-2 font-medium'>Date</th>
                                            <th className='py-2 pr-2 font-medium'>Description</th>
                                            <th className='py-2 pr-2 text-right font-medium'>Charged</th>
                                            <th className='py-2 pr-2 text-right font-medium'>Paid</th>
                                            <th className='py-2 text-right font-medium'>Balance</th>
                                        </tr>
                                    </thead>
                                    <tbody className='divide-y divide-slate-100'>
                                        <tr>
                                            <td className='py-2 pr-2'>{firstDayLabel(from)}</td>
                                            <td className='py-2 pr-2 font-medium'>Opening balance</td>
                                            <td />
                                            <td />
                                            <td className='py-2 text-right'>{balanceText(data.opening)}</td>
                                        </tr>
                                        {data.lines.map((l, i) => (
                                            <tr key={i}>
                                                <td className='py-2 pr-2 whitespace-nowrap'>{l.date}</td>
                                                <td className='py-2 pr-2'>{l.description}</td>
                                                <td className='py-2 pr-2 text-right'>{l.charged ? formatKES(l.charged) : ''}</td>
                                                <td className='py-2 pr-2 text-right text-emerald-700'>{l.paid ? formatKES(l.paid) : ''}</td>
                                                <td className='py-2 text-right'>{balanceText(l.balance)}</td>
                                            </tr>
                                        ))}
                                        <tr className='font-semibold'>
                                            <td className='py-2 pr-2' />
                                            <td className='py-2 pr-2'>Closing balance</td>
                                            <td />
                                            <td />
                                            <td className='py-2 text-right'>{balanceText(data.closing)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <p className='mt-3 text-xs text-slate-400'>
                                {data.usesBills
                                    ? 'Charges are the monthly rent bills issued on the 1st of each month.'
                                    : 'Rent charges use the current monthly rent of ' + formatKES(tenant.monthlyRent) + '.'}{' '}
                                CR means the tenant is in credit.
                            </p>
                        </>
                    )}
                </div>

                <div className='no-print flex gap-2 border-t border-slate-100 px-5 py-4'>
                    <button
                        onClick={() => window.print()}
                        disabled={!valid}
                        className='inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50'
                    >
                        <Printer className='h-4 w-4' />
                        Print
                    </button>
                    <button
                        onClick={() => data && downloadPdf(tenant, data, from, to, propertyName)}
                        disabled={!valid}
                        className='inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50'
                    >
                        <Download className='h-4 w-4' />
                        Download PDF
                    </button>
                </div>
            </div>
        </div>
    );
}
