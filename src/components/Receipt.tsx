import { useEffect } from 'react';
import { BadgeCheck, Download, Printer, X } from 'lucide-react';
import type { Payment } from '../types';
import { formatDateTime, formatKES, formatMonth, formatPhone } from '../util';

export function receiptNumber(p: Payment): string {
    return p.receiptNo || 'RCT-' + p.month.replace('-', '') + '-' + p.id.slice(-6).toUpperCase();
}

function receiptRows(p: Payment): [string, string][] {
    const rows: [string, string][] = [
        ['Receipt number', receiptNumber(p)],
        ['Date paid', formatDateTime(p.paidAt || p.decidedAt || p.createdAt)],
        ['Tenant', p.tenantName],
        ['House / unit', p.unit],
        ['Rent period', formatMonth(p.month)],
        ['Payment method', p.method],
    ];
    if (p.mpesaReceipt) {
        rows.push(['M-Pesa code', p.mpesaReceipt]);
    } else if (p.reference) {
        rows.push(['Reference', p.reference]);
    }
    if (p.payerPhone) {
        rows.push(['Paid from', formatPhone(p.payerPhone)]);
    }
    return rows;
}

async function downloadPdf(p: Payment, propertyName: string) {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a5' });
    const left = 14;
    const right = 134;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(propertyName || 'Rent Portal', left, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text('Official rent payment receipt', left, 26);
    doc.setDrawColor(5, 150, 105);
    doc.setLineWidth(0.6);
    doc.line(left, 31, right, 31);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text('Amount paid', left, 41);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(15, 23, 42);
    doc.text(formatKES(p.amount), left, 50);
    doc.setFontSize(12);
    doc.setTextColor(5, 150, 105);
    doc.text('PAID', right, 50, { align: 'right' });

    let y = 63;
    doc.setFontSize(10);
    receiptRows(p).forEach(([label, value]) => {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(label, left, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(value, right, y, { align: 'right' });
        y += 8;
    });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(left, y, right, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('Thank you for your payment. Keep this receipt for your records.', left, y + 7);
    doc.text('Generated ' + formatDateTime(Date.now()), left, y + 12);
    doc.save(receiptNumber(p) + '.pdf');
}

type Props = {
    payment: Payment;
    propertyName: string;
    onClose: () => void;
};

export default function ReceiptModal({ payment, propertyName, onClose }: Props) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4' role='dialog' aria-modal='true'>
            <div className='max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl'>
                <div className='no-print flex items-center justify-between border-b border-slate-100 px-5 py-3'>
                    <p className='font-semibold'>Receipt</p>
                    <button onClick={onClose} aria-label='Close receipt' className='rounded-lg p-1 text-slate-500 hover:bg-slate-100'>
                        <X className='h-5 w-5' />
                    </button>
                </div>

                <div className='print-area p-6'>
                    <div className='flex items-start justify-between gap-3'>
                        <div>
                            <p className='text-lg font-bold'>{propertyName || 'Rent Portal'}</p>
                            <p className='text-xs text-slate-500'>Official rent payment receipt</p>
                        </div>
                        <span className='inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700'>
                            <BadgeCheck className='h-4 w-4' />
                            PAID
                        </span>
                    </div>
                    <div className='mt-4 border-t-2 border-emerald-600 pt-4'>
                        <p className='text-xs text-slate-500'>Amount paid</p>
                        <p className='text-3xl font-bold'>{formatKES(payment.amount)}</p>
                    </div>
                    <dl className='mt-4 divide-y divide-slate-100 text-sm'>
                        {receiptRows(payment).map(([label, value]) => (
                            <div key={label} className='flex justify-between gap-4 py-2'>
                                <dt className='text-slate-500'>{label}</dt>
                                <dd className='text-right font-medium'>{value}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className='mt-4 text-xs text-slate-400'>Thank you for your payment. Keep this receipt for your records.</p>
                </div>

                <div className='no-print flex gap-2 border-t border-slate-100 px-5 py-4'>
                    <button
                        onClick={() => window.print()}
                        className='inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50'
                    >
                        <Printer className='h-4 w-4' />
                        Print
                    </button>
                    <button
                        onClick={() => downloadPdf(payment, propertyName)}
                        className='inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700'
                    >
                        <Download className='h-4 w-4' />
                        Download PDF
                    </button>
                </div>
            </div>
        </div>
    );
}
