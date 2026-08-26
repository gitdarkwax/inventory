import { describe, expect, it } from 'vitest';
import {
  getDisplayPaymentStatus,
  getPaymentStatusLabel,
  getProductionOrderStatusLabel,
  isPaymentStatus,
  normalizePaymentStatus,
} from './production-order-payment';

describe('production order payment status helpers', () => {
  it('accepts only known payment status values', () => {
    expect(isPaymentStatus('payment_pending')).toBe(true);
    expect(isPaymentStatus('deposit_paid')).toBe(true);
    expect(isPaymentStatus('balance_paid')).toBe(true);
    expect(isPaymentStatus('paid')).toBe(false);
  });

  it('normalizes plain English labels for agent updates', () => {
    expect(normalizePaymentStatus('Payment Pending')).toBe('payment_pending');
    expect(normalizePaymentStatus('Deposit Paid')).toBe('deposit_paid');
    expect(normalizePaymentStatus('Balance Paid')).toBe('balance_paid');
    expect(normalizePaymentStatus('paid')).toBeNull();
  });

  it('shows Payment Pending only as a fallback for open orders', () => {
    expect(getDisplayPaymentStatus('in_production')).toBe('payment_pending');
    expect(getDisplayPaymentStatus('partial')).toBe('payment_pending');
    expect(getDisplayPaymentStatus('completed')).toBeNull();
    expect(getDisplayPaymentStatus('cancelled')).toBeNull();
  });

  it('keeps paid statuses visible across order statuses', () => {
    expect(getDisplayPaymentStatus('completed', 'deposit_paid')).toBe('deposit_paid');
    expect(getDisplayPaymentStatus('cancelled', 'Balance Paid')).toBe('balance_paid');
  });

  it('maps stored values to plain English labels', () => {
    expect(getPaymentStatusLabel('payment_pending')).toBe('Payment Pending');
    expect(getPaymentStatusLabel('deposit_paid')).toBe('Deposit Paid');
    expect(getPaymentStatusLabel('balance_paid')).toBe('Balance Paid');
  });

  it('maps PO lifecycle statuses to Slack-friendly labels', () => {
    expect(getProductionOrderStatusLabel('in_production')).toBe('In Production');
    expect(getProductionOrderStatusLabel('partial')).toBe('Partial Delivery');
    expect(getProductionOrderStatusLabel('completed')).toBe('Fully Delivered');
    expect(getProductionOrderStatusLabel('cancelled')).toBe('Cancelled');
  });
});
