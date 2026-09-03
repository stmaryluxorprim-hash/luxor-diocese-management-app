'use client';

// ---------- Child portal — النقاط ----------
// Every points change: cause points (± with the cause name) and the points
// that came with attendance (event name). Filter by source, totals for
// added / removed, grouped by day, with date & time of registration.

import { useMemo, useState } from 'react';
import { Star, Loader2, Clock, User, Layers, Plus, Minus, CalendarCheck, Award } from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { EmptyState, PageTitle, fmtDate, fmtTime, usePortalList } from '@/components/child/ChildBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { fetchChildPoints, sumBy, type ChildPointsRow } from '@/lib/child-portal';
import { APP_TZ } from '@/lib/time';

type Filter = 'all' | 'cause' | 'attendance';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'cause', label: 'أسباب النقاط' },
  { value: 'attendance', label: 'نقاط الحضور' },
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
  const { rows, error } = usePortalList<ChildPointsRow>(
    token ? () => fetchChildPoints(supabase, token) : null,
    `pts-${token}-${profile?.enrollments.map((e) => e.points).join(',')}`
  );
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(
    () => (rows ?? []).filter((r) => filter === 'all' || r.source === filter),
    [rows, filter]
  );
  const added = sumBy(visible.filter((r) => r.delta > 0), (r) => r.delta);
  const removed = sumBy(visible.filter((r) => r.delta < 0), (r) => -r.delta);
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

  return (
    <>
      <PageTitle
        icon={<Star className="h-5 w-5 text-gold-600" />}
        title="سجل النقاط"
        sub="كل النقاط التي حصلت عليها أو خُصمت منك — السبب والتاريخ والوقت"
      />

      {/* Balance + totals */}
      <section className="card mb-4 bg-gradient-to-l from-gold-500 to-gold-400 text-white border-0">
        <p className="text-xs font-bold text-gold-50">رصيدك الحالي</p>
        <p className="text-4xl font-extrabold tabular-nums">{balance}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-white/20 py-2">
            <p className="text-lg font-extrabold tabular-nums">+{rows ? added : '…'}</p>
            <p className="text-[11px] font-bold">مضافة</p>
          </div>
          <div className="rounded-xl bg-white/20 py-2">
            <p className="text-lg font-extrabold tabular-nums">−{rows ? removed : '…'}</p>
            <p className="text-[11px] font-bold">مخصومة</p>
          </div>
        </div>
      </section>

      {/* Filter chips */}
      <section className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            id={`child-pts-filter-${f.value}`}
            onClick={() => setFilter(f.value)}
            className={`flex-1 rounded-xl px-3 py-2 text-xs font-extrabold transition ${
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
                    return (
                      <div key={`${r.source}-${r.id}`} className="flex items-center gap-3 px-4 py-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                          r.source === 'attendance' ? 'bg-emerald-100 text-emerald-600' : pos ? 'bg-gold-100 text-gold-600' : 'bg-red-100 text-red-500'
                        }`}>
                          {r.source === 'attendance' ? <CalendarCheck className="h-5 w-5" /> : pos ? <Plus className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-extrabold">
                            {r.reason ?? (r.source === 'attendance' ? 'حضور' : 'نقاط')}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-400">
                            <span className="flex items-center gap-1">
                              {r.source === 'attendance' ? <CalendarCheck className="h-3 w-3" /> : <Award className="h-3 w-3" />}
                              {r.source === 'attendance' ? 'حضور' : 'سبب'}
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
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
