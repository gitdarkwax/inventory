export const PAYMENT_STATUS_LABELS = {
  payment_pending: 'Payment Pending',
  deposit_paid: 'Deposit Paid',
  balance_paid: 'Balance Paid',
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
