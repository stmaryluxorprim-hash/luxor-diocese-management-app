'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart3, Trophy, TrendingUp, Star, CalendarCheck, Loader2 } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { cairoToday, WEEKDAY_SHORT } from '@/lib/time';
import { useDebouncedRealtime, scopeFilter } from '@/lib/realtime';

interface Leader { enrollment_id: string; person_id: string; name: string; points: number; attendance_count: number }

export default function StatsPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  // Aggregates come from RPCs (numbers only) — the page never downloads
  // the enrollments table any more, whatever its size.
  const [totals, setTotals] = useState({ attendance: 0, points: 0, enrollments: 0, persons: 0 });
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [weekCounts, setWeekCounts] = useState<{ date: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [sum, week, top] = await Promise.all([
      supabase.rpc('stats_summary'),
      supabase.rpc('stats_week', { p_days: 7 }),
      supabase.rpc('stats_leaderboard', { p_limit: 10 }),
    ]);
    const s = (sum.data as { total_attendance: number; total_points: number; enrollments: number; persons: number }[] | null)?.[0];
    setTotals({
      attendance: Number(s?.total_attendance ?? 0),
      points: Number(s?.total_points ?? 0),
      enrollments: Number(s?.enrollments ?? 0),
      persons: Number(s?.persons ?? 0),
    });
    setLeaders((top.data as Leader[] | null) ?? []);

    // last-7-days histogram keyed by Cairo day; fill gaps with 0
    const byDay = new Map<string, number>();
    ((week.data as { day: string; count: number }[] | null) ?? []).forEach((r) => byDay.set(r.day, Number(r.count)));
    const days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const key = cairoToday(new Date(Date.now() - i * 86_400_000));
      days.push({ date: key, count: byDay.get(key) ?? 0 });
    }
    setWeekCounts(days);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile, load]);

  // Debounced + scoped realtime: a burst of scans → one refresh
  useDebouncedRealtime(
    supabase,
    'stats-page',
    [{ table: 'attendance_log' }, { table: 'enrollments', filter: scopeFilter(profile) }],
    load,
    { enabled: profile?.status === 'approved', delayMs: 2000 }
  );

  const totalAttendance = totals.attendance;
  const totalPoints = totals.points;
  const maxWeek = Math.max(1, ...weekCounts.map((d) => d.count));
  // Weekday of a 'YYYY-MM-DD' Cairo date — parse as UTC so device TZ can't shift the day
  const dayName = (iso: string) => WEEKDAY_SHORT[new Date(iso + 'T00:00:00Z').getUTCDay()];

  return (
    <AppShell>
      <section className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <BarChart3 className="h-5 w-5 text-primary-600" />
          الإحصائيات
        </h2>
      </section>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : (
        <>
          <section id="stats-totals" className="grid grid-cols-2 gap-3 mb-5">
            <div className="card flex items-center gap-3">
              <span className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700">
                <CalendarCheck className="h-6 w-6" />
              </span>
              <div>
                <p className="text-2xl font-extrabold leading-none">{totalAttendance}</p>
                <p className="text-xs text-slate-500 mt-1">إجمالي الحضور</p>
              </div>
            </div>
            <div className="card flex items-center gap-3">
              <span className="rounded-xl bg-gold-100 p-2.5 text-gold-600">
                <Star className="h-6 w-6" />
              </span>
              <div>
                <p className="text-2xl font-extrabold leading-none">{totalPoints}</p>
                <p className="text-xs text-slate-500 mt-1">إجمالي النقاط</p>
              </div>
            </div>
          </section>

          <section id="week-chart" className="card mb-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-extrabold text-slate-600">
              <TrendingUp className="h-4 w-4 text-primary-600" />
              حضور آخر 7 أيام
            </h3>
            <div className="flex items-end justify-between gap-2 h-32">
              {weekCounts.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-slate-500">{d.count}</span>
                  <div
                    className="w-full rounded-t-lg bg-gradient-to-t from-primary-600 to-accent-400 transition-all"
                    style={{ height: `${Math.max(4, (d.count / maxWeek) * 100)}%` }}
                  />
                  <span className="text-[10px] text-slate-400">{dayName(d.date)}</span>
                </div>
              ))}
            </div>
          </section>

          <section id="leaderboard">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-600">
              <Trophy className="h-4 w-4 text-gold-500" />
              الأعلى نقاطاً
            </h3>
            <ul className="space-y-2">
              {leaders.map((c, i) => (
                <li key={c.enrollment_id} className="card flex items-center gap-3 !py-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                      i === 0
                        ? 'bg-gold-100 text-gold-600'
                        : i === 1
                        ? 'bg-slate-200 text-slate-600'
                        : i === 2
                        ? 'bg-orange-100 text-orange-600'
                        : 'bg-primary-50 text-primary-600'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <p className="flex-1 truncate font-bold">{c.name}</p>
                  <span className="badge bg-gold-100 text-gold-600">
                    <Star className="h-3 w-3" /> {c.points}
                  </span>
                </li>
              ))}
              {leaders.length === 0 && (
                <li className="card py-10 text-center text-slate-400 font-bold">لا توجد بيانات بعد</li>
              )}
            </ul>
          </section>
        </>
      )}
    </AppShell>
  );
}
