'use client';

// ---------- Child portal — النقاط ----------
// Every points change: cause points (± with the cause name), the points
// that came with attendance (event name) and — since migration 0026 — the
// points REDEEMED in the points store (إستبدال النقاط). Store rows are
// tappable and open the bill (items, quantities, balance before / after).
// Filter by source, totals for added / removed, grouped by day.

import { useMemo, useState } from 'react';
import Image from 'next/image';
import {
  Star, Loader2, Clock, User, Layers, Plus, Minus, CalendarCheck, Award, ShoppingBag, X, Receipt, Ban, Check, ChevronLeft, ImageIcon,
} from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { EmptyState, PageTitle, fmtDate, fmtTime, usePortalList } from '@/components/child/ChildBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import {
  fetchChildPoints, fetchChildStoreOrders, sumBy, type ChildPointsRow, type ChildStoreOrder,
} from '@/lib/child-portal';
import { APP_TZ } from '@/lib/time';

type Filter = 'all' | 'cause' | 'attendance' | 'store';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'cause', label: 'أسباب النقاط' },
  { value: 'attendance', label: 'نقاط الحضور' },
  { value: 'store', label: 'إستبدال النقاط' },
];

const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', { timeZone: APP_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

export default function ChildPointsPage() {
  return (
    <ChildShell>
      <PointsContent />
    </ChildShell>
  );
}

function PointsContent() {
  const { token, profile } = useChild();
  const supabase = useMemo(() => createClient(), []);
  const key = `${token}-${profile?.enrollments.map((e) => e.points).join(',')}`;
  const { rows, error } = usePortalList<ChildPointsRow>(
    token ? () => fetchChildPoints(supabase, token) : null, `pts-${key}`
  );
  const { rows: orders } = usePortalList<ChildStoreOrder>(
    token ? () => fetchChildStoreOrders(supabase, token) : null, `orders-${key}`
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [bill, setBill] = useState<ChildStoreOrder | null>(null);

  const hasStore = (rows ?? []).some((r) => r.source === 'store');
  const filters = FILTERS.filter((f) => f.value !== 'store' || hasStore);

  const visible = useMemo(
    () => (rows ?? []).filter((r) => filter === 'all' || r.source === filter),
    [rows, filter]
  );
  const added = sumBy(visible.filter((r) => r.delta > 0), (r) => r.delta);
  const removed = sumBy(visible.filter((r) => r.delta < 0), (r) => -r.delta);
  const redeemed = sumBy((rows ?? []).filter((r) => r.source === 'store' && r.delta < 0), (r) => -r.delta);
  const balance = sumBy(profile?.enrollments ?? [], (e) => e.points);

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; list: ChildPointsRow[] }>();
    visible.forEach((r) => {
      const k = dayKey(r.created_at);
      const g = m.get(k) ?? { label: dayLabel(r.created_at), list: [] };
      g.list.push(r);
      m.set(k, g);
    });
    return Array.from(m.values());
  }, [visible]);

  const multiEnrollment = (profile?.enrollments.length ?? 0) > 1;
  const orderById = (id: string | null | undefined) => (id ? orders?.find((o) => o.id === id) ?? null : null);

  const iconFor = (r: ChildPointsRow) => {
    const pos = r.delta >= 0;
    if (r.source === 'attendance') return { cls: 'bg-emerald-100 text-emerald-600', icon: <CalendarCheck className="h-5 w-5" /> };
    if (r.source === 'store') return { cls: pos ? 'bg-orange-100 text-orange-600' : 'bg-orange-500 text-white', icon: <ShoppingBag className="h-5 w-5" /> };
    return pos ? { cls: 'bg-gold-100 text-gold-600', icon: <Plus className="h-5 w-5" /> } : { cls: 'bg-red-100 text-red-500', icon: <Minus className="h-5 w-5" /> };
  };

  return (
    <>
      <PageTitle
        icon={<Star className="h-5 w-5 text-gold-600" />}
        title="سجل النقاط"
        sub="كل النقاط التي حصلت عليها أو خُصمت منك أو استبدلتها — السبب والتاريخ والوقت"
      />

      {/* Balance + totals */}
      <section className="card mb-4 bg-gradient-to-l from-gold-500 to-gold-400 text-white border-0">
        <p className="text-xs font-bold text-gold-50">رصيدك الحالي</p>
        <p className="text-4xl font-extrabold tabular-nums">{balance}</p>
        <div className={`mt-3 grid gap-2 text-center ${hasStore ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div className="rounded-xl bg-white/20 py-2">
            <p className="text-lg font-extrabold tabular-nums">+{rows ? added : '…'}</p>
            <p className="text-[11px] font-bold">مضافة</p>
          </div>
          <div className="rounded-xl bg-white/20 py-2">
            <p className="text-lg font-extrabold tabular-nums">−{rows ? removed : '…'}</p>
            <p className="text-[11px] font-bold">مخصومة</p>
          </div>
          {hasStore && (
            <div className="rounded-xl bg-white/20 py-2">
              <p className="text-lg font-extrabold tabular-nums">{redeemed}</p>
              <p className="text-[11px] font-bold">استبدلتها بأصناف</p>
            </div>
          )}
        </div>
      </section>

      {/* Filter chips */}
      <section className="mb-4 flex gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            id={`child-pts-filter-${f.value}`}
            onClick={() => setFilter(f.value)}
            className={`flex-1 rounded-xl px-2 py-2 text-xs font-extrabold transition ${
              filter === f.value ? 'bg-primary-600 text-white shadow' : 'bg-white text-slate-500 border border-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </section>

      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}

      {!rows ? (
        <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-primary-500" /></div>
      ) : groups.length === 0 ? (
        <EmptyState text="لا توجد نقاط مسجلة بعد" />
      ) : (
        <div className="space-y-4">
          {groups.map((g, i) => {
            const net = sumBy(g.list, (r) => r.delta);
            return (
              <section key={i}>
                <h3 className="mb-1.5 flex items-center justify-between text-xs font-extrabold text-slate-500">
                  <span>{g.label}</span>
                  <span className={`badge ${net >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {net > 0 ? '+' : ''}{net}
                  </span>
                </h3>
                <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
                  {g.list.map((r) => {
                    const pos = r.delta >= 0;
                    const ic = iconFor(r);
                    const order = r.source === 'store' ? orderById(r.order_id) : null;
                    const Row = (
                      <>
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${ic.cls}`}>{ic.icon}</span>
                        <div className="min-w-0 flex-1 text-right">
                          <p className="truncate text-sm font-extrabold">
                            {r.reason ?? (r.source === 'attendance' ? 'حضور' : r.source === 'store' ? 'إستبدال نقاط' : 'نقاط')}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-400">
                            <span className="flex items-center gap-1">
                              {r.source === 'attendance' ? <CalendarCheck className="h-3 w-3" /> : r.source === 'store' ? <ShoppingBag className="h-3 w-3" /> : <Award className="h-3 w-3" />}
                              {r.source === 'attendance' ? 'حضور' : r.source === 'store' ? 'المتجر' : 'سبب'}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {fmtDate(r.created_at)} · {fmtTime(r.created_at)}
                            </span>
                            {r.recorded_by_name && (
                              <span className="flex items-center gap-1"><User className="h-3 w-3" /> {r.recorded_by_name}</span>
                            )}
                            {multiEnrollment && (
                              <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {r.service_name} · {r.class_name}</span>
                            )}
                          </p>
                        </div>
                        <span className={`badge shrink-0 ${pos ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {pos ? '+' : ''}{r.delta}
                        </span>
                        {order && <ChevronLeft className="h-4 w-4 shrink-0 text-slate-300" />}
                      </>
                    );
                    return order ? (
                      <button key={`${r.source}-${r.id}`} id={`child-pts-row-${r.id}`} type="button" onClick={() => setBill(order)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-orange-50/50">
                        {Row}
                      </button>
                    ) : (
                      <div key={`${r.source}-${r.id}`} className="flex items-center gap-3 px-4 py-3">{Row}</div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ---------- bill sheet ---------- */}
      {bill && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={() => setBill(null)}>
          <div id="child-bill" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-extrabold"><Receipt className="h-5 w-5 text-orange-600" /> فاتورة إستبدال النقاط</h3>
              <button type="button" onClick={() => setBill(null)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-3 flex flex-wrap items-center gap-x-2 text-xs font-bold text-slate-500">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDate(bill.created_at)} · {fmtTime(bill.created_at)}</span>
              {bill.recorded_by_name && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {bill.recorded_by_name}</span>}
              <span className={`badge ${bill.status === 'cancelled' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                {bill.status === 'cancelled' ? <><Ban className="h-3 w-3" /> ملغاة — استُردّت النقاط</> : <><Check className="h-3 w-3" /> مكتملة</>}
              </span>
            </p>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
              <div className="rounded-xl bg-slate-50 py-2"><p className="text-lg font-extrabold tabular-nums text-slate-500">{bill.balance_before}</p>الرصيد قبل</div>
              <div className="rounded-xl bg-orange-50 py-2"><p className="text-lg font-extrabold tabular-nums text-orange-600">−{bill.total_points}</p>المستبدل</div>
              <div className="rounded-xl bg-emerald-50 py-2"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{bill.balance_after}</p>الرصيد بعد</div>
            </div>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
              {bill.items.map((l) => (
                <li key={l.id} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-orange-50 text-orange-300 ring-1 ring-orange-100">
                    {l.image_url ? <Image src={l.image_url} alt={l.item_name} fill sizes="40px" className="object-cover" /> : <ImageIcon className="absolute inset-0 m-auto h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">{l.item_name}</p>
                    <p className="text-[11px] font-bold text-slate-400">{l.unit_price} × {l.qty}</p>
                  </div>
                  <span className="tabular-nums text-sm font-extrabold text-orange-700">{l.line_total}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
