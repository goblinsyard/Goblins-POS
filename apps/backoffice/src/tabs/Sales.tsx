import { useState, useEffect } from 'react';
import { api, downloadCsv, egp, cairoTime } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Table, useLoad } from '../lib/ui';

const SECTIONS = ['sales reports', 'receipts', 'shifts report'] as const;
const GROUPS = ['hour', 'day', 'department', 'category', 'item', 'method', 'staff'] as const;

export function SalesView() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('sales reports');
  return (
    <div className="space-y-4">
      <div className="mb-4"><Pills value={section} onChange={setSection} options={SECTIONS} /></div>
      {section === 'sales reports' && <SalesReports />}
      {section === 'receipts' && <ReceiptsList />}
      {section === 'shifts report' && <ShiftsReport />}
    </div>
  );
}

// old Sales reports view
function SalesReports() {
  const [groupBy, setGroupBy] = useState<(typeof GROUPS)[number]>('day');
  const { data } = useLoad(
    () => api<{ key: string; orders: number; revenueCents: number; quantity: number }[]>(`/reports/sales?groupBy=${groupBy}`),
    [groupBy],
  );
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Pills value={groupBy} onChange={setGroupBy} options={GROUPS} />
        <a href={`/api/reports/sales.csv?groupBy=${groupBy}`} target="_blank" rel="noreferrer"
          onClick={(e) => { e.preventDefault(); void downloadCsv(`/reports/sales.csv?groupBy=${groupBy}`, `sales-${groupBy}.csv`); }}
          className="ml-auto rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white">
          Export CSV
        </a>
      </div>
      <Table
        headers={[groupBy, 'Orders', 'Qty', 'Revenue']}
        rows={(data ?? []).map((r) => [r.key, String(r.orders), String(r.quantity), egp(r.revenueCents)])}
      />
    </div>
  );
}

interface OrderPayment {
  id: string;
  amountCents: number;
  method: { id: string; name: string };
}
interface ClosedOrder {
  id: string;
  number: number;
  type: string;
  status: string;
  totalCents: number;
  openedAt: string;
  closedAt: string | null;
  customer?: { name: string; phone: string } | null;
  payments: OrderPayment[];
  openedBy: { name: string };
}

function getLocalDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ReceiptsList() {
  const [timePeriod, setTimePeriod] = useState<string>('today');
  const [startDate, setStartDate] = useState(getLocalDateString(0));
  const [endDate, setEndDate] = useState(getLocalDateString(0));
  const [search, setSearch] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<ClosedOrder | null>(null);

  useEffect(() => {
    if (timePeriod === 'today') {
      setStartDate(getLocalDateString(0));
      setEndDate(getLocalDateString(0));
    } else if (timePeriod === 'yesterday') {
      setStartDate(getLocalDateString(1));
      setEndDate(getLocalDateString(1));
    } else if (timePeriod === 'last7') {
      setStartDate(getLocalDateString(6));
      setEndDate(getLocalDateString(0));
    } else if (timePeriod === 'last30') {
      setStartDate(getLocalDateString(29));
      setEndDate(getLocalDateString(0));
    }
  }, [timePeriod]);

  const { data: receipts, reload } = useLoad(() => {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (search.trim()) params.set('search', search.trim());
    return api<ClosedOrder[]>(`/orders/history?${params.toString()}`);
  }, [startDate, endDate, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="w-48">
          <Field label="Time Period">
            <Select
              value={timePeriod}
              onChange={setTimePeriod}
              options={[
                { value: 'today', label: 'Today' },
                { value: 'yesterday', label: 'Yesterday' },
                { value: 'last7', label: 'Last 7 Days' },
                { value: 'last30', label: 'Last 30 Days' },
                { value: 'custom', label: 'Custom Range' },
              ]}
            />
          </Field>
        </div>

        {timePeriod === 'custom' && (
          <>
            <div className="w-36">
              <Field label="From Date">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-sm bg-white"
                />
              </Field>
            </div>
            <div className="w-36">
              <Field label="To Date">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-sm bg-white"
                />
              </Field>
            </div>
          </>
        )}

        <div className="flex-1 min-w-[200px]">
          <Field label="Smart Filter">
            <div className="relative">
              <input
                type="text"
                placeholder="Search Order #, Customer, Server..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-2 pr-8 text-sm"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm font-bold"
                >
                  ×
                </button>
              )}
            </div>
          </Field>
        </div>

        <div className="self-end pb-1">
          <Btn onClick={reload}>Refresh</Btn>
        </div>
      </div>

      <div className="rounded-xl bg-white p-4 shadow overflow-hidden">
        <Table
          headers={['Date/Time', 'Order #', 'Type', 'Status', 'Customer', 'Total', 'Payments', 'Actions']}
          rows={(receipts ?? []).map((r) => {
            const statusBadge = (
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                r.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' :
                r.status === 'VOIDED' ? 'bg-red-100 text-red-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {r.status}
              </span>
            );
            return [
              r.closedAt ? cairoTime(r.closedAt) : `${cairoTime(r.openedAt)} (Open)`,
              `#${r.number}`,
              r.type,
              statusBadge,
              r.customer?.name ?? '—',
              egp(r.totalCents),
              r.payments.map((p) => `${p.method.name} (${egp(p.amountCents)})`).join(', ') || '—',
              <Btn key={r.id} onClick={() => setSelectedReceipt(r)}>Details & Edit</Btn>
            ];
          })}
        />
        {!receipts?.length && <p className="p-4 text-slate-400">No orders found.</p>}
      </div>

      {selectedReceipt && (
        <ReceiptDetailModal
          receipt={selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
          onDone={() => { setSelectedReceipt(null); reload(); }}
        />
      )}
    </div>
  );
}

interface PaymentMethod {
  id: string;
  name: string;
  isActive: boolean;
}

function ReceiptDetailModal({ receipt, onClose, onDone }: {
  receipt: ClosedOrder; onClose: () => void; onDone: () => void;
}) {
  const { data: methods } = useLoad(() => api<PaymentMethod[]>('/admin/payment-methods'));
  const [err, setErr] = useState('');
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [selectedMethodId, setSelectedMethodId] = useState('');

  async function handleUpdatePayment(paymentId: string) {
    if (!selectedMethodId) return;
    try {
      await api(`/orders/${receipt.id}/payments/${paymentId}`, {
        method: 'PATCH',
        body: { methodId: selectedMethodId },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update payment method');
    }
  }

  return (
    <Modal title={`Receipt Details #${receipt.number}`} onClose={onClose} wide>
      <ErrorBanner message={err} />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm border-b pb-3">
          <div>
            <p className="text-slate-400">Type</p>
            <p className="font-semibold text-slate-800">{receipt.type}</p>
          </div>
          <div>
            <p className="text-slate-400">Status</p>
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
              receipt.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' :
              receipt.status === 'VOIDED' ? 'bg-red-100 text-red-800' :
              'bg-yellow-100 text-yellow-800'
            }`}>
              {receipt.status}
            </span>
          </div>
          <div>
            <p className="text-slate-400">Date/Time</p>
            <p className="font-semibold text-slate-800">{receipt.closedAt ? cairoTime(receipt.closedAt) : `${cairoTime(receipt.openedAt)} (Open)`}</p>
          </div>
          <div>
            <p className="text-slate-400">Opened By</p>
            <p className="font-semibold text-slate-800">{receipt.openedBy.name}</p>
          </div>
          <div>
            <p className="text-slate-400">Customer</p>
            <p className="font-semibold text-slate-800">{receipt.customer ? `${receipt.customer.name} (${receipt.customer.phone})` : 'Walk-in'}</p>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-2">Payments</h3>
          <div className="space-y-3">
            {receipt.payments.map((p) => (
              <div key={p.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border">
                <div>
                  <span className="font-semibold text-slate-800">{egp(p.amountCents)}</span>
                  <span className="text-xs text-slate-400 ml-2">via {p.method.name}</span>
                </div>
                {editingPaymentId === p.id ? (
                  <div className="flex gap-2 items-center">
                    <Select
                      value={selectedMethodId}
                      onChange={setSelectedMethodId}
                      options={(methods ?? []).filter((m) => m.isActive).map((m) => ({ value: m.id, label: m.name }))}
                    />
                    <Btn kind="primary" onClick={() => void handleUpdatePayment(p.id)}>Save</Btn>
                    <Btn onClick={() => setEditingPaymentId(null)}>Cancel</Btn>
                  </div>
                ) : (
                  <Btn onClick={() => { setEditingPaymentId(p.id); setSelectedMethodId(p.method.id); }}>
                    Edit Payment Method
                  </Btn>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-between items-center border-t pt-3 text-sm font-bold">
          <span>Total Paid</span>
          <span className="text-slate-800">{egp(receipt.totalCents)}</span>
        </div>
      </div>
    </Modal>
  );
}

interface ShiftListItem {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  floatCents: number;
  expectedCents: number | null;
  countedCents: number | null;
  varianceCents: number | null;
  openedBy: { name: string };
  terminal?: { name: string } | null;
  payments: { tipCents: number }[];
}

function ShiftsReport() {
  const { data: shifts, error, reload } = useLoad(() => api<ShiftListItem[]>('/shifts'));
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);

  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-slate-800">Shifts Report</h2>
        <Btn onClick={reload}>Refresh</Btn>
      </div>

      <div className="rounded-xl bg-white p-4 shadow overflow-hidden">
        <Table
          headers={[
            'Opened At',
            'Closed At',
            'Status',
            'Operator',
            'Opening Float',
            'Tips',
            'Expected Cash',
            'Actual Counted',
            'Difference',
            'Actions'
          ]}
          rows={(shifts ?? []).map((s) => {
            const isClosed = s.status === 'CLOSED';
            const statusBadge = (
              <span className={`px-2 py-1 rounded text-xs font-bold ${
                isClosed ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {s.status}
              </span>
            );

            const tipsSum = (s.payments ?? []).reduce((a, p) => a + p.tipCents, 0);

            return [
              cairoTime(s.openedAt),
              s.closedAt ? cairoTime(s.closedAt) : 'Still Open',
              statusBadge,
              s.openedBy.name,
              egp(s.floatCents),
              egp(tipsSum),
              isClosed && s.expectedCents != null ? egp(s.expectedCents) : '—',
              isClosed && s.countedCents != null ? egp(s.countedCents) : '—',
              isClosed && s.varianceCents != null ? (
                <span className={s.varianceCents < 0 ? 'text-red-600 font-semibold' : s.varianceCents > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-800'}>
                  {s.varianceCents > 0 ? '+' : ''}{egp(s.varianceCents)}
                </span>
              ) : '—',
              <Btn key={s.id} onClick={() => setSelectedShiftId(s.id)}>View Report</Btn>
            ];
          })}
        />
        {!shifts?.length && <p className="p-4 text-slate-400">No shifts found.</p>}
      </div>

      {selectedShiftId && (
        <ShiftReportDetailModal
          shiftId={selectedShiftId}
          onClose={() => setSelectedShiftId(null)}
        />
      )}
    </div>
  );
}

interface ShiftDetails {
  shift: {
    id: string;
    status: 'OPEN' | 'CLOSED';
    openedAt: string;
    closedAt: string | null;
    floatCents: number;
    expectedCents: number | null;
    countedCents: number | null;
    varianceCents: number | null;
    openedBy: { name: string };
    terminal?: { name: string } | null;
    cashMovements: {
      id: string;
      kind: 'PAID_IN' | 'PAID_OUT' | 'PETTY_CASH' | 'DRAWER_OPEN' | 'CASH_TRANSFER';
      amountCents: number;
      reason: string;
      createdAt: string;
      user: { name: string };
    }[];
  };
  report: {
    shiftId: string;
    openedAt: string;
    floatCents: number;
    orderCount: number;
    voidedCount: number;
    grossCents: number;
    subtotalCents: number;
    taxCents: number;
    serviceChargeCents: number;
    discountCents: number;
    discountCount: number;
    tipsCents: number;
    byMethod: Record<string, { count: number; amountCents: number }>;
    byDepartment: Record<string, number>;
    cash: {
      floatCents: number;
      salesCents: number;
      movementsCents: number;
      expectedCents: number;
    };
    countedCents?: number;
    varianceCents?: number;
  };
}

function ShiftReportDetailModal({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { data, error } = useLoad(() => api<ShiftDetails>(`/shifts/${shiftId}/details`), [shiftId]);

  if (error) {
    return (
      <Modal title="Shift Report Details" onClose={onClose} wide>
        <ErrorBanner message={error} />
      </Modal>
    );
  }

  if (!data) {
    return (
      <Modal title="Shift Report Details" onClose={onClose} wide>
        <p className="p-8 text-center text-slate-400">Loading shift report details...</p>
      </Modal>
    );
  }

  const { shift, report } = data;
  const isClosed = shift.status === 'CLOSED';

  const formatMovementKind = (kind: string) => {
    return kind.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <Modal title={`Shift Report Details - ${isClosed ? 'Z-Report' : 'X-Report (Live)'}`} onClose={onClose} wide>
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold ${
              isClosed ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-800'
            }`}>
              {shift.status}
            </span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Operator</p>
            <p className="font-semibold text-slate-800 mt-1">{shift.openedBy.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Opened At</p>
            <p className="font-semibold text-slate-800 mt-1">{cairoTime(shift.openedAt)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Closed At</p>
            <p className="font-semibold text-slate-800 mt-1">{shift.closedAt ? cairoTime(shift.closedAt) : 'Still Open'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-slate-700 border-b pb-2 mb-2">Sales Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Gross Sales</span>
                <span className="font-semibold text-slate-800">{egp(report.grossCents)}</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>Discounts ({report.discountCount})</span>
                <span>-{egp(report.discountCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tax</span>
                <span className="font-semibold text-slate-800">{egp(report.taxCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Service Charge</span>
                <span className="font-semibold text-slate-800">{egp(report.serviceChargeCents)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Tips</span>
                <span>{egp(report.tipsCents)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-bold text-base text-slate-800">
                <span>Net Sales</span>
                <span>{egp(report.subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400 pt-1">
                <span>Paid Orders: {report.orderCount}</span>
                <span>Voided Orders: {report.voidedCount}</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-slate-700 border-b pb-2 mb-2">Cash Drawer Reconciliation</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Opening Float</span>
                <span className="font-semibold text-slate-800">{egp(report.cash.floatCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cash Sales</span>
                <span className="font-semibold text-slate-800">{egp(report.cash.salesCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cash Movements</span>
                <span className={`font-semibold ${report.cash.movementsCents < 0 ? 'text-red-600' : report.cash.movementsCents > 0 ? 'text-emerald-700' : 'text-slate-800'}`}>
                  {report.cash.movementsCents > 0 ? '+' : ''}{egp(report.cash.movementsCents)}
                </span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold text-slate-800">
                <span>Expected Drawer Cash</span>
                <span>{egp(report.cash.expectedCents)}</span>
              </div>

              {isClosed ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">Actual Counted Cash</span>
                    <span className="font-bold text-slate-800">{egp(report.countedCents ?? shift.countedCents ?? 0)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-bold text-base">
                    <span>Variance (Difference)</span>
                    <span className={(report.varianceCents ?? shift.varianceCents ?? 0) < 0 ? 'text-red-600' : (report.varianceCents ?? shift.varianceCents ?? 0) > 0 ? 'text-emerald-700' : 'text-slate-800'}>
                      {(report.varianceCents ?? shift.varianceCents ?? 0) > 0 ? '+' : ''}{egp(report.varianceCents ?? shift.varianceCents ?? 0)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="p-2 bg-yellow-50 text-yellow-800 rounded-lg text-xs border border-yellow-100 mt-2">
                  ⚠️ This shift is still active. Final counted cash and variance will be determined upon shift closure.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-slate-700 border-b pb-2 mb-2">Payment Methods Breakdown</h3>
            <div className="space-y-2 text-sm">
              {Object.entries(report.byMethod).map(([methodName, data]) => (
                <div key={methodName} className="flex justify-between">
                  <span className="text-slate-500">{methodName} ({data.count} tx)</span>
                  <span className="font-semibold text-slate-800">{egp(data.amountCents)}</span>
                </div>
              ))}
              {Object.keys(report.byMethod).length === 0 && (
                <p className="text-xs text-slate-400 py-2">No payments recorded in this shift.</p>
              )}
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-slate-700 border-b pb-2 mb-2">Departments Breakdown</h3>
            <div className="space-y-2 text-sm">
              {Object.entries(report.byDepartment).map(([dept, amountCents]) => (
                <div key={dept} className="flex justify-between">
                  <span className="text-slate-500">{dept}</span>
                  <span className="font-semibold text-slate-800">{egp(amountCents)}</span>
                </div>
              ))}
              {Object.keys(report.byDepartment).length === 0 && (
                <p className="text-xs text-slate-400 py-2">No sales recorded in this shift.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-700">Cash Movements History</h3>
          <div className="max-h-60 overflow-y-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                <tr>
                  <th className="p-3">Time</th>
                  <th className="p-3">Kind</th>
                  <th className="p-3">Cashier</th>
                  <th className="p-3">Reason</th>
                  <th className="p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shift.cashMovements.map((move) => (
                  <tr key={move.id} className="hover:bg-slate-50">
                    <td className="p-3 text-xs text-slate-500">{cairoTime(move.createdAt)}</td>
                    <td className="p-3 text-xs">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                        move.kind === 'PAID_IN' ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' :
                        move.kind === 'PAID_OUT' || move.kind === 'PETTY_CASH' || move.kind === 'CASH_TRANSFER' ? 'bg-red-50 text-red-800 border border-red-100' :
                        'bg-slate-50 text-slate-600 border border-slate-100'
                      }`}>
                        {formatMovementKind(move.kind)}
                      </span>
                    </td>
                    <td className="p-3 text-slate-700">{move.user.name}</td>
                    <td className="p-3 text-slate-600 truncate max-w-[200px]">{move.reason || '—'}</td>
                    <td className={`p-3 text-right font-semibold ${move.amountCents < 0 ? 'text-red-600' : move.amountCents > 0 ? 'text-emerald-700' : 'text-slate-800'}`}>
                      {move.amountCents > 0 ? '+' : ''}{egp(move.amountCents)}
                    </td>
                  </tr>
                ))}
                {shift.cashMovements.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-slate-400 text-sm">No cash movements recorded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
