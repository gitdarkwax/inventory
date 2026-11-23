import { describe, expect, it } from 'vitest';
import type { ProductionOrder } from '@/lib/production-orders';
import { planCreateOrder } from './create-order';

const writer = { userId: 'u1', email: 'Fawzia@magbak.com', name: 'Fawzia', role: 'write' as const };
const knownSkus = new Map([
  ['mbwlt-bk', 'MBWLT-BK'],
  ['ec18m-bk', 'EC18M-BK'],
]);
const input = { vendor: 'iTexson', items: [{ sku: 'mbwlt-bk', quantity: 5000 }], confirmed: true };
const base = { user: writer, knownSkus, orders: [] as ProductionOrder[] };

describe('planCreateOrder', () => {
  it('accepts a confirmed order from someone with write access and uses the app spelling of the SKU', () => {
    expect(planCreateOrder(input, base)).toEqual({
      ok: true,
      vendor: 'iTexson',
      items: [{ sku: 'MBWLT-BK', quantity: 5000 }],
      eta: undefined,
      notes: '',
    });
  });

  it('refuses someone with read-only access', () => {
    expect(planCreateOrder(input, { ...base, user: { ...writer, role: 'readonly' } }).ok).toBe(false);
  });

  it('refuses an unknown SKU and names it', () => {
    const plan = planCreateOrder({ ...input, items: [{ sku: 'NOPE-1', quantity: 10 }] }, base);
    expect(plan).toMatchObject({ ok: false });
    expect((plan as { message: string }).message).toContain('NOPE-1');
  });

  it('refuses a SKU listed twice, a bad quantity and a bad date', () => {
    const twice = [{ sku: 'MBWLT-BK', quantity: 1 }, { sku: 'mbwlt-bk', quantity: 2 }];
    expect(planCreateOrder({ ...input, items: twice }, base).ok).toBe(false);
    expect(planCreateOrder({ ...input, items: [{ sku: 'MBWLT-BK', quantity: 1.5 }] }, base).ok).toBe(false);
    expect(planCreateOrder({ ...input, eta: 'next month' }, base).ok).toBe(false);
  });

  it('does not create until the person has confirmed', () => {
    expect(planCreateOrder({ ...input, confirmed: false }, base).ok).toBe(false);
  });

  it('refuses a second identical order within ten minutes, but not later or after a cancel', () => {
    const now = Date.parse('2026-11-23T20:00:00Z');
    const order = (createdAt: string, status = 'in_production') =>
      ({ id: 'PO-0151', vendor: 'itexson ', status, createdAt, items: [{ sku: 'MBWLT-BK', quantity: 5000, receivedQuantity: 0 }] }) as unknown as ProductionOrder;
    const recent = planCreateOrder(input, { ...base, now, orders: [order('2026-11-23T19:55:00Z')] });
    expect(recent).toMatchObject({ ok: false });
    expect((recent as { message: string }).message).toContain('PO-0151');
    expect(planCreateOrder(input, { ...base, now, orders: [order('2026-11-23T19:00:00Z')] }).ok).toBe(true);
    expect(planCreateOrder(input, { ...base, now, orders: [order('2026-11-23T19:55:00Z', 'cancelled')] }).ok).toBe(true);
  });
});
