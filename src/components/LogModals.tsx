'use client';

// ---------- Log modals (opened from the badges on a person's card) ----------
// AttendanceLogModal — سجل الحضور: every attendance entry of an enrollment
//                      (event name, day, points granted, recorded by).
//                      Optionally scoped to ONE event (the event selected on
//                      the children page); a toggle switches to all events.
// PointsLogModal     — سجل النقاط: every points change of an enrollment —
//                      manual cause points (points_log) AND points that came
//                      with attendance (attendance_log.points_delta), merged
//                      and sorted newest first.

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck, Star, Loader2, User, CalendarDays, Layers, ListChecks,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ModalFrame } from '@/components/PersonDataModals';
import type {
  AppEvent, Cause, EnrollmentWithPerson, AttendanceLog, PointsLog,
} from '@/lib/types';
import { APP_TZ } from '@/lib/time';

// ---------- Shared helpers ----------

const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', {
    timeZone: APP_TZ,
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));

const fmtDay = (ymd: string) => {
  // 'YYYY-MM-DD' (Cairo calendar day) — render as a Cairo date
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** Load names of the servants who recorded the rows (RLS may hide some) */
function useRecorderNames(ids: (string | null)[]) {
  const supabase = createClient();
  const [names, setNames] = useState<Record<string, string>>({});
  const key = useMemo(
    () => Array.from(new Set(ids.filter((x): x is string => !!x))).sort().join(','),
    [ids]
  );
  useEffect(() => {
    if (!key) { setNames({}); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', key.split(','));
      if (cancelled) return;
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: { id: string; full_name: string }) => { map[p.id] = p.full_name; });
      setNames(map);
    })();
    return () => { cancelled = true; };
  }, [supabase, key]);
  return names;
}

function PersonHeader({ enrollment, subtitle }: { enrollment: EnrollmentWithPerson; subtitle: string }) {
  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
        <User className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-extrabold">{enrollment.person.name}</p>
        <p className="truncate text-xs font-bold text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-10 text-center text-slate-400">
      <ListChecks className="mx-auto mb-2 h-8 w-8" />
      <p className="text-sm font-bold">{text}</p>
    </div>
  );
}

// =====================================================================
// 1. ATTENDANCE LOG — سجل الحضور
// =====================================================================
export function AttendanceLogModal({
  enrollment, events, selectedEvent, onClose,
}: {
  enrollment: EnrollmentWithPerson;
  events: AppEvent[];
  /** Event chosen on the children page — scopes the log by default (null = all) */
  selectedEvent: AppEvent | null;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<AttendanceLog[] | null>(null);
  // scope toggle: 'event' (only when an event is selected) / 'all'
  const [scope, setScope] = useState<'event' | 'all'>(selectedEvent ? 'event' : 'all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('attendance_log')
        .select('*')
        .eq('enrollment_id', enrollment.id)
        .order('attended_on', { ascending: false })
        .order('created_at', { ascending: false });
      if (!cancelled) setRows((data ?? []) as AttendanceLog[]);
    })();
    return () => { cancelled = true; };
  }, [supabase, enrollment.id]);

  const visible = useMemo(() => {
    if (!rows) return null;
    if (scope === 'event' && selectedEvent) return rows.filter((r) => r.event_id === selectedEvent.id);
    return rows;
  }, [rows, scope, selectedEvent]);

  const recorders = useRecorderNames((rows ?? []).map((r) => r.recorded_by));
  const eventName = (id: string | null) =>
    id ? events.find((ev) => ev.id === id)?.name ?? 'مناسبة محذوفة' : 'حضور قديم (بدون مناسبة)';

  const totalPts = (visible ?? []).reduce((s, r) => s + r.points_delta, 0);

  return (
    <ModalFrame
      title="سجل الحضور"
      icon={<CalendarCheck className="h-5 w-5 text-emerald-600" />}
      onClose={onClose}
    >
      <PersonHeader
        enrollment={enrollment}
        subtitle={`إجمالي الحضور في كل المناسبات: ${enrollment.attendance_count}`}
      />

      {/* Scope toggle — only meaningful when an event is selected */}
      {selectedEvent && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            id="attlog-scope-event"
            type="button"
            aria-pressed={scope === 'event'}
            onClick={() => setScope('event')}
            className={`truncate rounded-xl px-2 py-2 text-xs font-extrabold transition active:scale-95 ${
              scope === 'event' ? 'bg-emerald-500 text-white shadow' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {selectedEvent.name}
          </button>
          <button
            id="attlog-scope-all"
            type="button"
            aria-pressed={scope === 'all'}
            onClick={() => setScope('all')}
            className={`rounded-xl px-2 py-2 text-xs font-extrabold transition active:scale-95 ${
              scope === 'all' ? 'bg-emerald-500 text-white shadow' : 'bg-slate-100 text-slate-500'
            }`}
          >
            كل المناسبات
          </button>
        </div>
      )}

      {/* Summary strip */}
      {visible && (
        <div className="mb-3 flex items-center justify-between rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm font-extrabold text-emerald-700">
            <CalendarCheck className="h-4 w-4" />
            {visible.length} مرة حضور
          </span>
          <span className="flex items-center gap-1 text-xs font-extrabold text-gold-600">
            <Star className="h-3.5 w-3.5" />
            {totalPts} نقطة
          </span>
        </div>
      )}

      {visible === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-7 w-7 animate-spin text-primary-500" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState text={scope === 'event' ? 'لا يوجد حضور مسجل في هذه المناسبة' : 'لا يوجد حضور مسجل'} />
      ) : (
        <ul id="attendance-log-list" className="divide-y divide-indigo-50 overflow-hidden rounded-2xl border border-indigo-50">
          {visible.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 bg-white px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-extrabold text-slate-700">
                  <Layers className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                  {eventName(r.event_id)}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs font-bold text-slate-500">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  {fmtDay(r.attended_on)}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  سُجّل {fmtDateTime(r.created_at)}
                  {r.recorded_by && recorders[r.recorded_by] ? ` — بواسطة ${recorders[r.recorded_by]}` : ''}
                </p>
              </div>
              <span className="badge shrink-0 bg-gold-100 text-gold-600">
                <Star className="h-3 w-3" /> +{r.points_delta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ModalFrame>
  );
}

// =====================================================================
// 2. POINTS LOG — سجل النقاط
// =====================================================================
type PointsEntry = {
  id: string;
  kind: 'cause' | 'attendance';
  label: string;
  event: string | null;   // the event the points were given IN (4th scope level)
  delta: number;
  created_at: string;
  recorded_by: string | null;
};

export function PointsLogModal({
  enrollment, causes, events, onClose,
}: {
  enrollment: EnrollmentWithPerson;
  causes: Cause[];
  events: AppEvent[];
  onClose: () => void;
}) {
  const supabase = createClient();
  const [entries, setEntries] = useState<PointsEntry[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'cause' | 'attendance'>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: pl }, { data: al }] = await Promise.all([
        supabase.from('points_log').select('*').eq('enrollment_id', enrollment.id),
        supabase.from('attendance_log').select('*').eq('enrollment_id', enrollment.id),
      ]);
      if (cancelled) return;
      const fromCauses: PointsEntry[] = ((pl ?? []) as PointsLog[]).map((r) => ({
        id: `p-${r.id}`,
        kind: 'cause',
        label: r.cause_id
          ? causes.find((c) => c.id === r.cause_id)?.name ?? 'سبب محذوف'
          : 'نقاط يدوية (بدون سبب)',
        // points_log.event_id exists since migration 0022 (older rows: null)
        event: r.event_id
          ? events.find((ev) => ev.id === r.event_id)?.name ?? 'مناسبة محذوفة'
          : null,
        delta: r.delta,
        created_at: r.created_at,
        recorded_by: r.recorded_by,
      }));
      const fromAttendance: PointsEntry[] = ((al ?? []) as AttendanceLog[])
        .filter((r) => r.points_delta !== 0)
        .map((r) => ({
          id: `a-${r.id}`,
          kind: 'attendance',
          label: r.event_id
            ? `حضور «${events.find((ev) => ev.id === r.event_id)?.name ?? 'مناسبة محذوفة'}»`
            : 'حضور (بدون مناسبة)',
          event: null, // already part of the label
          delta: r.points_delta,
          created_at: r.created_at,
          recorded_by: r.recorded_by,
        }));
      setEntries(
        [...fromCauses, ...fromAttendance].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
      );
    })();
    return () => { cancelled = true; };
  }, [supabase, enrollment.id, causes, events]);

  const visible = useMemo(
    () => (entries ? (filter === 'all' ? entries : entries.filter((e) => e.kind === filter)) : null),
    [entries, filter]
  );
  const recorders = useRecorderNames((entries ?? []).map((e) => e.recorded_by));

  const sum = (visible ?? []).reduce((s, e) => s + e.delta, 0);
  const added = (visible ?? []).filter((e) => e.delta > 0).reduce((s, e) => s + e.delta, 0);
  const removed = (visible ?? []).filter((e) => e.delta < 0).reduce((s, e) => s + e.delta, 0);

  const FILTERS: { value: typeof filter; label: string }[] = [
    { value: 'all', label: 'الكل' },
    { value: 'cause', label: 'أسباب النقاط' },
    { value: 'attendance', label: 'نقاط الحضور' },
  ];

  return (
    <ModalFrame
      title="سجل النقاط"
      icon={<Star className="h-5 w-5 text-gold-500" />}
      onClose={onClose}
    >
      <PersonHeader enrollment={enrollment} subtitle={`الرصيد الحالي: ${enrollment.points} نقطة`} />

      <div className="mb-3 grid grid-cols-3 gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            id={`ptslog-filter-${f.value}`}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-xl px-1 py-2 text-xs font-extrabold transition active:scale-95 ${
              filter === f.value ? 'bg-gold-500 text-white shadow' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible && (
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 py-2">
            <p className="text-[11px] font-bold text-emerald-600">مضافة</p>
            <p className="text-sm font-extrabold text-emerald-700">+{added}</p>
          </div>
          <div className="rounded-2xl border border-red-100 bg-red-50 py-2">
            <p className="text-[11px] font-bold text-red-500">مخصومة</p>
            <p className="text-sm font-extrabold text-red-600">{removed}</p>
          </div>
          <div className="rounded-2xl border border-gold-200 bg-gold-100 py-2">
            <p className="text-[11px] font-bold text-gold-600">الصافي</p>
            <p className="text-sm font-extrabold text-gold-600">{sum > 0 ? `+${sum}` : sum}</p>
          </div>
        </div>
      )}

      {visible === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-7 w-7 animate-spin text-primary-500" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState text="لا توجد حركات نقاط مسجلة" />
      ) : (
        <ul id="points-log-list" className="divide-y divide-indigo-50 overflow-hidden rounded-2xl border border-indigo-50">
          {visible.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 bg-white px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-extrabold text-slate-700">
                  {e.kind === 'attendance' ? (
                    <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <Star className="h-3.5 w-3.5 shrink-0 text-gold-500" />
                  )}
                  {e.label}
                </p>
                {e.event && (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-bold text-violet-600">
                    <CalendarDays className="h-3 w-3 shrink-0" />
                    في مناسبة «{e.event}»
                  </p>
                )}
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {fmtDateTime(e.created_at)}
                  {e.recorded_by && recorders[e.recorded_by] ? ` — بواسطة ${recorders[e.recorded_by]}` : ''}
                </p>
              </div>
              <span
                className={`badge shrink-0 ${
                  e.delta > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                }`}
              >
                {e.delta > 0 ? `+${e.delta}` : e.delta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ModalFrame>
  );
}
