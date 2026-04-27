/**
 * SKU Log Modal
 *
 * Opens from the Planning tab when a user clicks a SKU. Shows a merged
 * timeline of POs, Transfers, and Counts that touched that SKU within a
 * selected period. Reference numbers deep-link (new tab) to the PO/Transfer
 * record. Exports to .xlsx via exceljs.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ProductionOrder } from '@/lib/production-orders';
import type { Transfer } from '@/lib/transfers';
import {
  buildSkuLogEntries,
  periodWindowForCustom,
  periodWindowForPreset,
  type InventoryCountSubmission,
  type SkuLogEntry,
  type SkuLogPeriodPreset,
} from '@/lib/sku-log';

export interface SkuLogModalProps {
  sku: string;
  productTitle?: string;
  productionOrders: readonly ProductionOrder[];
  transfers: readonly Transfer[];
  /** Submissions across all relevant locations (already merged by parent). */
  inventoryLogs: readonly InventoryCountSubmission[];
  /** True while the parent is still fetching count logs / transfers. */
  isLoading?: boolean;
  loadError?: string | null;
  onClose: () => void;
}

/** Chip color per movement type. */
const TYPE_BADGE: Record<SkuLogEntry['type'], { label: string; className: string; icon: string }> = {
  po: { label: 'PO', className: 'bg-blue-100 text-blue-800', icon: '📦' },
  transfer: { label: 'Transfer', className: 'bg-purple-100 text-purple-800', icon: '🚚' },
  count: { label: 'Count', className: 'bg-amber-100 text-amber-800', icon: '📋' },
};

const STATUS_BADGE: Record<NonNullable<SkuLogEntry['status']>, string> = {
  'In Transit': 'bg-blue-100 text-blue-800',
  Partial: 'bg-orange-100 text-orange-800',
  Delivered: 'bg-green-100 text-green-800',
  Completed: 'bg-green-100 text-green-800',
  Cancelled: 'bg-gray-200 text-gray-700',
};

/** Build the deep-link to the POs & Transfers tab for a given ref id. */
function refDeepLink(refId: string): string {
  // Always opens at the dashboard root; the Dashboard mount handler
  // reads ?ref=... and switches tab + opens detail.
  return `/?ref=${encodeURIComponent(refId)}`;
}

function formatShortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : '2-digit',
  });
}

function formatFullTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function compactName(full: string): string {
  if (!full) return '—';
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export default function SkuLogModal({
  sku,
  productTitle,
  productionOrders,
  transfers,
  inventoryLogs,
  isLoading,
  loadError,
  onClose,
}: SkuLogModalProps) {
  const [preset, setPreset] = useState<SkuLogPeriodPreset>('60d');

  // Default custom range = last 60 days, computed once on first render.
  const initialCustom = useMemo(() => {
    const w = periodWindowForPreset('60d');
    return {
      startYmd: w.startIso.slice(0, 10),
      endYmd: w.endIso.slice(0, 10),
    };
  }, []);
  const [customStart, setCustomStart] = useState(initialCustom.startYmd);
  const [customEnd, setCustomEnd] = useState(initialCustom.endYmd);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Resolve the active period window.
  const periodWindow = useMemo(() => {
    if (preset === 'custom') return periodWindowForCustom(customStart, customEnd);
    return periodWindowForPreset(preset);
  }, [preset, customStart, customEnd]);

  // Merge + filter the entries.
  const entries = useMemo(() => {
    return buildSkuLogEntries({
      sku,
      productionOrders,
      transfers,
      inventoryLogs,
      periodStart: periodWindow.startIso,
      periodEnd: periodWindow.endIso,
    });
  }, [sku, productionOrders, transfers, inventoryLogs, periodWindow]);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async () => {
    if (entries.length === 0) return;
    setIsExporting(true);
    setExportError(null);
    try {
      // Lazy import keeps exceljs (~660KB) out of the initial bundle.
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'MagBak Inventory';
      wb.created = new Date();
      const ws = wb.addWorksheet(`${sku} log`);
      ws.columns = [
        { header: 'Date', key: 'date', width: 22 },
        { header: 'Type', key: 'type', width: 10 },
        { header: 'Reference', key: 'ref', width: 14 },
        { header: 'From', key: 'from', width: 18 },
        { header: 'To', key: 'to', width: 18 },
        { header: 'Ship Type', key: 'ship', width: 14 },
        { header: 'Qty', key: 'qty', width: 10 },
        { header: 'Previous', key: 'prev', width: 10 },
        { header: 'Counted', key: 'counted', width: 10 },
        { header: 'Delta', key: 'delta', width: 10 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'User', key: 'user', width: 18 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const e of entries) {
        ws.addRow({
          date: formatFullTimestamp(e.date),
          type: TYPE_BADGE[e.type].label,
          ref: e.refLabel || '',
          from: e.fromLocation || '',
          to: e.toLocation || '',
          ship: e.shipmentType || '',
          qty: e.qty ?? '',
          prev: e.countPrevious ?? '',
          counted: e.countCounted ?? '',
          delta: e.countDelta ?? '',
          status: e.status || '',
          user: e.user || '',
        });
      }
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const ts = new Date().toISOString().slice(0, 10);
      link.download = `sku-log-${sku}-${ts}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('SKU log export failed:', err);
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              <span className="font-mono">{sku}</span> activity
            </h2>
            {productTitle && (
              <p className="text-sm text-gray-600 mt-0.5">{productTitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Controls */}
        <div className="px-6 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3 bg-gray-50">
          <label className="text-sm text-gray-700 font-medium">Period</label>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as SkuLogPeriodPreset)}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
          >
            <option value="30d">Last 30 days</option>
            <option value="60d">Last 60 days</option>
            <option value="90d">Last 90 days</option>
            <option value="custom">Custom…</option>
          </select>
          {preset === 'custom' && (
            <>
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1"
              />
              <span className="text-sm text-gray-500">to</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1"
              />
            </>
          )}
          <span className="ml-auto text-sm text-gray-600">
            {entries.length} {entries.length === 1 ? 'event' : 'events'}
          </span>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || entries.length === 0}
            className={`text-sm px-3 py-1.5 rounded font-medium ${
              isExporting || entries.length === 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {isExporting ? 'Exporting…' : '📥 Export to Excel'}
          </button>
        </div>

        {exportError && (
          <div className="px-6 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200">
            Export failed: {exportError}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {isLoading && entries.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-sm">
              Loading activity…
            </div>
          ) : loadError ? (
            <div className="p-12 text-center text-red-700 text-sm">
              {loadError}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center text-gray-500 text-sm">
              No activity for <span className="font-mono">{sku}</span> in this period.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Movement</th>
                  <th className="px-4 py-2 font-medium">Route</th>
                  <th className="px-4 py-2 font-medium text-right">Qty</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, idx) => (
                  <SkuLogRow key={e.eventKey} entry={e} zebra={idx % 2 === 1} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 flex justify-between">
          <span>
            Sorted oldest first · POs and Transfers excluded if marked “Non-SKU”
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-700 hover:text-gray-900 font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SkuLogRow({ entry, zebra }: { entry: SkuLogEntry; zebra: boolean }) {
  const badge = TYPE_BADGE[entry.type];
  return (
    <tr className={zebra ? 'bg-gray-50' : 'bg-white'}>
      {/* Date */}
      <td className="px-4 py-2 align-top text-gray-700 whitespace-nowrap" title={formatFullTimestamp(entry.date)}>
        {formatShortDate(entry.date)}
      </td>
      {/* Movement: badge + ref + (ship type) */}
      <td className="px-4 py-2 align-top">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${badge.className}`}>
          <span aria-hidden>{badge.icon}</span>
          {badge.label}
        </span>
        {entry.refId && entry.refLabel && (
          <a
            href={refDeepLink(entry.refId)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 font-mono text-blue-600 hover:underline"
            title={`Open ${entry.refId} in a new tab`}
          >
            {entry.refLabel}
          </a>
        )}
        {entry.shipmentType && (
          <div className="text-xs text-gray-500 mt-0.5">{entry.shipmentType}</div>
        )}
      </td>
      {/* Route */}
      <td className="px-4 py-2 align-top text-gray-700 whitespace-nowrap">
        {entry.type === 'count' ? (
          <span className="text-gray-600">at {entry.toLocation || '—'}</span>
        ) : entry.fromLocation && entry.toLocation ? (
          <>
            <span>{entry.fromLocation}</span>
            <span className="text-gray-400 mx-1">→</span>
            <span>{entry.toLocation}</span>
          </>
        ) : entry.fromLocation || entry.toLocation ? (
          <span>{entry.fromLocation || entry.toLocation}</span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      {/* Qty */}
      <td className="px-4 py-2 align-top text-right whitespace-nowrap font-mono">
        {entry.type === 'count' ? (
          <span title={`Δ ${formatDelta(entry.countDelta)}`}>
            <span className="text-gray-700">{(entry.countPrevious ?? 0).toLocaleString()}</span>
            <span className="text-gray-400 mx-1">→</span>
            <span className="text-gray-900 font-medium">{(entry.countCounted ?? 0).toLocaleString()}</span>
            <span className={`ml-2 text-xs ${
              (entry.countDelta ?? 0) > 0
                ? 'text-green-600'
                : (entry.countDelta ?? 0) < 0
                ? 'text-red-600'
                : 'text-gray-400'
            }`}>
              ({formatDelta(entry.countDelta ?? 0)})
            </span>
          </span>
        ) : entry.qty != null ? (
          <span className={entry.status === 'Cancelled' ? 'text-gray-400 line-through' : 'text-gray-900'}>
            {entry.qty.toLocaleString()}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      {/* Status */}
      <td className="px-4 py-2 align-top whitespace-nowrap">
        {entry.status ? (
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[entry.status]}`}>
            {entry.status}
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      {/* User */}
      <td className="px-4 py-2 align-top text-gray-700 whitespace-nowrap" title={entry.user}>
        {compactName(entry.user)}
      </td>
    </tr>
  );
}

function formatDelta(d: number | null): string {
  if (d == null) return '0';
  if (d > 0) return `+${d.toLocaleString()}`;
  return d.toLocaleString();
}
