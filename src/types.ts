export type TenantStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type AccountMode = 'shared' | 'per_tenant' | 'per_tenant_paybill';

export type Role = 'owner' | 'landlord' | 'caretaker' | 'tenant' | 'suspended';

export type Tenant = {
    userId: string;
    email: string;
    name: string;
    phone: string;
    unit: string;
    monthlyRent: number;
    status: TenantStatus;
    createdAt: number;
    approvedAt?: number;
    decidedAt?: number;
    billedTotal?: number;
    paidTotal?: number;
    lastBilledMonth?: string;
    landlordKey?: string;
    plotId?: string;
    plotName?: string;
    accountNumber?: string;
    tenantPaybill?: string;
};

export type Bill = {
    id: string;
    tenantId: string;
    tenantName: string;
    unit: string;
    month: string;
    amount: number;
    createdAt: number;
    plotId?: string;
};

export type PaymentStatus = 'processing' | 'pending' | 'confirmed' | 'rejected' | 'failed';

export type Payment = {
    id: string;
    tenantId: string;
    tenantName: string;
    tenantEmail: string;
    unit: string;
    amount: number;
    month: string;
    method: string;
    reference: string;
    status: PaymentStatus;
    channel?: 'mpesa' | 'manual' | 'sms';
    landlordKey?: string;
    plotId?: string;
    plotName?: string;
    payerName?: string;
    smsText?: string;
    matchedBy?: string;
    recipient?: string;
    account?: string;
    warnings?: string[];
    mpesaReceipt?: string;
    payerPhone?: string;
    failureReason?: string;
    receiptNo?: string;
    paymentDate?: string;
    hiddenByTenant?: boolean;
    createdAt: number;
    paidAt?: number;
    decidedAt?: number;
};

export type Staff = {
    id: string;
    email: string;
    role: 'caretaker';
    addedAt: number;
};

export type Plot = {
    id: string;
    name: string;
    paybillNumber: string;
    paybillName: string;
    paybillAccount: string;
    paymentInstructions: string;
    accountMode: AccountMode;
    createdAt: number;
};

export type TenantPlotInfo = {
    plotName: string;
    paybillNumber: string;
    paybillName: string;
    paybillAccount: string;
    paymentInstructions: string;
    accountMode: AccountMode;
};

export const EMPTY_PLOT_INFO: TenantPlotInfo = {
    plotName: '',
    paybillNumber: '',
    paybillName: '',
    paybillAccount: '',
    paymentInstructions: '',
    accountMode: 'shared',
};

export type LandlordRow = {
    id: string;
    email: string;
    name: string;
    phone: string;
    status: 'active' | 'suspended';
    addedAt: number;
    plots: string[];
    tenantCount: number;
    pendingCount: number;
    totalCount: number;
};

export type LandlordRequest = {
    id?: string;
    email: string;
    name: string;
    phone: string;
    location: string;
    plots: string;
    units: string;
    message: string;
    status: 'pending' | 'rejected';
    reason?: string;
    createdAt: number;
    decidedAt?: number;
};

export type Me = {
    email: string;
    name: string;
    role: Role;
    isAdmin: boolean;
    tenant: Tenant | null;
    plotAvailable?: boolean;
    landlordRequest?: LandlordRequest | null;
};
