'use client';

// ---------- Child portal — الرئيسية ----------
// Name, picture, attendance and points (totals + per enrollment), plus
// quick links to the other tabs and a peek at the latest activity.

import { useMemo } from 'react';
import Link from 'next/link';
import {
  CalendarCheck, Star, ChevronLeft, School, Layers, Church, Sparkles, Database,
} from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { Avatar, Kpi, fmtDateTime, usePortalList } from '@/components/child/ChildBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import {
  fetchChildAttendance, fetchChildPoints, ageFromBirthdate, sumBy,
  type ChildAttendanceRow, type ChildPointsRow,
} from '@/lib/child-portal';
import { GENDER_LABELS } from '@/lib/types';

export default function ChildHomePage() {
  return (
    <ChildShell>
      <HomeContent />
    </ChildShell>
  );
}

function HomeContent() {
  const { token, profile } = useChild();
  const supabase = useMemo(() => createClient(), []);

  const { rows: attendance } = usePortalList<ChildAttendanceRow>(
    token ? () => fetchChildAttendance(supabase, token) : null,
    `att-${token}-${profile?.enrollments.map((e) => e.attendance_count).join(',')}`
  );
  const { rows: points } = usePortalList<ChildPointsRow>(
    token ? () => fetchChildPoints(supabase, token) : null,
    `pts-${token}-${profile?.enrollments.map((e) => e.points).join(',')}`
  );

  if (!profile) return null;
  const { person, enrollments } = profile;
  const totalAttendance = sumBy(enrollments, (e) => e.attendance_count);
  const totalPoints = sumBy(enrollments, (e) => e.points);
  const age = ageFromBirthdate(person.birthdate);
  const lastAtt = attendance?.[0];
  const lastPts = points?.[0];

  return (
    <>
      {/* Identity card */}
      <section id="child-identity" className="card mb-4 overflow-hidden !p-0">
        <div className="bg-gradient-to-l from-primary-600 to-accent-600 px-4 pt-4 pb-10 text-white">
          <p className="text-xs font-bold text-indigo-100">أهلاً بك 👋</p>
          <h2 className="text-xl font-extrabold">{person.name}</h2>
        </div>
        <div className="-mt-8 flex items-end gap-3 px-4 pb-4">
          <Avatar person={person} size={80} className="ring-4 ring-white shadow-lg" />
          <div className="min-w-0 flex-1 pb-1 text-xs font-bold text-slate-500">
            <p className="truncate">
              {person.gender ? GENDER_LABELS[person.gender] : '—'}
              {age !== null && ` · ${age} سنة`}
            </p>
            <p className="truncate">
              {enrollments.length === 1
                ? `${enrollments[0].service_name} · ${enrollments[0].class_name}`
                : `${enrollments.length} تسجيلات`}
            </p>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="mb-4 grid grid-cols-2 gap-3">
        <Link href="/child/attendance">
          <Kpi
            label="مرات الحضور"
            value={totalAttendance}
            tone="bg-emerald-50 border-emerald-100"
            icon={<CalendarCheck className="h-6 w-6 text-emerald-600" />}
          />
        </Link>
        <Link href="/child/points">
          <Kpi
            label="رصيد النقاط"
            value={totalPoints}
            tone="bg-gold-50 border-gold-100"
            icon={<Star className="h-6 w-6 text-gold-600" />}
          />
        </Link>
      </section>

      {/* Enrollments */}
      <section className="mb-4">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">تسجيلاتي</h3>
        <div className="space-y-2">
          {enrollments.map((e) => (
            <div key={e.id} className="card flex items-center gap-3 !py-3">
              <span className="rounded-xl bg-primary-50 p-2 text-primary-600">
                <School className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold text-sm">{e.class_name}</p>
                <p className="truncate text-xs text-slate-500 flex items-center gap-1">
                  <Layers className="h-3 w-3" /> {e.service_name}
                  <span className="text-slate-300">·</span>
                  <Church className="h-3 w-3" /> {e.church_name}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="badge bg-emerald-100 text-emerald-700">
                  <CalendarCheck className="h-3 w-3" /> {e.attendance_count}
                </span>
                <span className="badge bg-gold-100 text-gold-700">
                  <Star className="h-3 w-3" /> {e.points}
                </span>
              </div>
            </div>
          ))}
          {enrollments.length === 0 && (
            <div className="card text-center text-sm font-bold text-slate-400">لا توجد تسجيلات بعد</div>
          )}
        </div>
      </section>

      {/* Latest activity */}
      <section className="mb-4">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">آخر نشاط</h3>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          <Link href="/child/attendance" className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50/50">
            <span className="rounded-xl bg-emerald-50 p-2 text-emerald-600"><CalendarCheck className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">آخر حضور</span>
              <span className="block truncate text-xs text-slate-400">
                {lastAtt ? `${lastAtt.event_name ?? 'مناسبة'} — ${fmtDateTime(lastAtt.created_at)}` : attendance ? 'لا يوجد حضور مسجل' : '…'}
              </span>
            </span>
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
          <Link href="/child/points" className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50/50">
            <span className="rounded-xl bg-gold-50 p-2 text-gold-600"><Sparkles className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">آخر نقاط</span>
              <span className="block truncate text-xs text-slate-400">
                {lastPts
                  ? `${lastPts.delta > 0 ? '+' : ''}${lastPts.delta} — ${lastPts.reason ?? (lastPts.source === 'attendance' ? 'حضور' : 'نقاط')} — ${fmtDateTime(lastPts.created_at)}`
                  : points ? 'لا توجد نقاط مسجلة' : '…'}
              </span>
            </span>
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
          <Link href="/child/data" className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50/50">
            <span className="rounded-xl bg-primary-50 p-2 text-primary-600"><Database className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">بياناتي وكارتي</span>
              <span className="block truncate text-xs text-slate-400">كود الـ QR، الصورة، وطلب تعديل البيانات</span>
            </span>
            <ChevronLeft className="h-4 w-4 text-slate-300" />
          </Link>
        </div>
      </section>
    </>
  );
}
