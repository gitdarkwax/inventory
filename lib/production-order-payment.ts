export const PAYMENT_STATUS_LABELS = {
  payment_pending: 'Payment Pending',
  deposit_paid: 'Deposit Paid',
  balance_paid: 'Balance Paid',
} as const;

export const PRODUCTION_ORDER_STATUS_LABELS = {
  in_production: 'In Production',
  partial: 'Partial Delivery',
  completed: 'Fully Delivered',
  cancelled: 'Cancelled',
} as const;

export type PaymentStatus = keyof typeof PAYMENT_STATUS_LABELS;
export type ProductionOrderLifecycleStatus = 'in_production' | 'partial' | 'completed' | 'cancelled';

const PAYMENT_STATUS_ALIASES: Record<string, PaymentStatus> = {
  payment_pending: 'payment_pending',
  'payment pending': 'payment_pending',
  'no payment': 'payment_pending',
  'no payment yet': 'payment_pending',
  unpaid: 'payment_pending',
  deposit_paid: 'deposit_paid',
  'deposit paid': 'deposit_paid',
  balance_paid: 'balance_paid',
  'balance paid': 'balance_paid',
};

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && value in PAYMENT_STATUS_LABELS;
}

export function normalizePaymentStatus(value: unknown): PaymentStatus | null {
  if (typeof value !== 'string') return null;

  const rawKey = value.trim().toLowerCase();
  const plainKey = rawKey.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');

  return PAYMENT_STATUS_ALIASES[rawKey] || PAYMENT_STATUS_ALIASES[plainKey] || null;
}

export function getPaymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_LABELS[status];
}

export function normalizePaymentPercentPaid(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;
    return Math.round(value * 100) / 100;
  }

  if (typeof value !== 'string') return null;

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*%?\s*(?:paid)?$/i);
  if (!match) return null;

  const percentPaid = Number(match[1]);
  if (!Number.isFinite(percentPaid) || percentPaid < 0 || percentPaid > 100) return null;

  return Math.round(percentPaid * 100) / 100;
}

export function formatPaymentPercentPaid(percentPaid: number): string {
  const displayPercent = Number.isInteger(percentPaid)
    ? String(percentPaid)
    : percentPaid.toFixed(2).replace(/\.?0+$/, '');

  return `${displayPercent}% paid`;
}

export function getProductionOrderStatusLabel(status: ProductionOrderLifecycleStatus): string {
  return PRODUCTION_ORDER_STATUS_LABELS[status];
}

export function isOpenProductionOrderStatus(status: ProductionOrderLifecycleStatus): boolean {
  return status === 'in_production' || status === 'partial';
}

export function getDisplayPaymentStatus(
  orderStatus: ProductionOrderLifecycleStatus,
  paymentStatus?: unknown
): PaymentStatus | null {
  const normalizedPaymentStatus = normalizePaymentStatus(paymentStatus);

  if (normalizedPaymentStatus) {
    if (normalizedPaymentStatus === 'payment_pending' && !isOpenProductionOrderStatus(orderStatus)) {
      return null;
    }
    return normalizedPaymentStatus;
  }

  return isOpenProductionOrderStatus(orderStatus) ? 'payment_pending' : null;
}

function legacyPaymentStatusToPercentPaid(paymentStatus?: unknown): number | null {
  const normalizedPaymentStatus = normalizePaymentStatus(paymentStatus);
  if (!normalizedPaymentStatus) return null;

  if (normalizedPaymentStatus === 'payment_pending') return 0;
  if (normalizedPaymentStatus === 'balance_paid') return 100;

  return null;
}

export function getDisplayPaymentPercentPaid(
  orderStatus: ProductionOrderLifecycleStatus,
  paymentPercentPaid?: unknown,
  legacyPaymentStatus?: unknown
): number | null {
  const normalizedPaymentPercentPaid = normalizePaymentPercentPaid(paymentPercentPaid);
  if (normalizedPaymentPercentPaid !== null) return normalizedPaymentPercentPaid;

  const legacyPercentPaid = legacyPaymentStatusToPercentPaid(legacyPaymentStatus);
  if (legacyPercentPaid !== null) {
    if (legacyPercentPaid === 0 && !isOpenProductionOrderStatus(orderStatus)) {
      return null;
    }
    return legacyPercentPaid;
  }

  return isOpenProductionOrderStatus(orderStatus) ? 0 : null;
}
