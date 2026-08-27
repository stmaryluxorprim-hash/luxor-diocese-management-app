'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Users, ScanLine, BarChart3, UserCheck, Church, Layers, School, Sparkles,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { ROLE_LABELS } from '@/lib/types';

interface Counts {
  persons: number;
  enrollments: number;
  todayAttendance: number;
  pendingServants: number;
  churches: number;
  services: number;
  classes: number;
}

export default function HomePage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [counts, setCounts] = useState<Counts>({
    persons: 0, enrollments: 0, todayAttendance: 0, pendingServants: 0, churches: 0, services: 0, classes: 0,
  });

  const isManager =
    profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  const loadCounts = useCallback(async () => {
    if (!profile || profile.status !== 'approved') return;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [persons, enrollments, attendance, pending, churches, services, classes] = await Promise.all([
      supabase.from('persons').select('id', { count: 'exact', head: true }),
      supabase.from('enrollments').select('id', { count: 'exact', head: true }),
      supabase
        .from('attendance_log')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'add')
        .gte('created_at', todayStart.toISOString()),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('churches').select('id', { count: 'exact', head: true }),
      supabase.from('services').select('id', { count: 'exact', head: true }),
      supabase.from('classes').select('id', { count: 'exact', head: true }),
    ]);

    setCounts({
      persons: persons.count ?? 0,
      enrollments: enrollments.count ?? 0,
      todayAttendance: attendance.count ?? 0,
      pendingServants: pending.count ?? 0,
      churches: churches.count ?? 0,
      services: services.count ?? 0,
      classes: classes.count ?? 0,
    });
  }, [profile, supabase]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // Realtime refresh on any relevant change
  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel('home-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'persons' }, loadCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, loadCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_log' }, loadCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadCounts)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, supabase, loadCounts]);

  return (
    <AppShell>
      <section id="welcome-section" className="mb-5">
        <div className="card bg-gradient-to-l from-primary-600 to-accent-600 border-0 text-white">
          <div className="flex items-center gap-3">
            <Sparkles className="h-8 w-8 text-gold-300" />
            <div>
              <h2 className="text-lg font-extrabold">أهلاً، {profile?.full_name} 👋</h2>
              <p className="text-sm text-indigo-100">
                {profile ? ROLE_LABELS[profile.role] : ''}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="stats-grid" className="grid grid-cols-2 gap-3 mb-5">
        <StatCard icon={<Users className="h-6 w-6" />} label="الأشخاص" value={counts.persons} color="bg-primary-100 text-primary-700" />
        <StatCard icon={<UserCheck className="h-6 w-6" />} label="حضور اليوم" value={counts.todayAttendance} color="bg-emerald-100 text-emerald-700" />
        <StatCard icon={<Users className="h-6 w-6" />} label="التسجيلات" value={counts.enrollments} color="bg-sky-100 text-sky-700" />
        {profile?.role === 'owner' && (
          <StatCard icon={<Church className="h-6 w-6" />} label="الكنائس" value={counts.churches} color="bg-gold-100 text-gold-600" />
        )}
        {isManager && (
          <>
            <StatCard icon={<Layers className="h-6 w-6" />} label="الخدمات" value={counts.services} color="bg-accent-100 text-accent-700" />
            <StatCard icon={<School className="h-6 w-6" />} label="الفصول" value={counts.classes} color="bg-sky-100 text-sky-700" />
            <StatCard icon={<UserCheck className="h-6 w-6" />} label="طلبات معلقة" value={counts.pendingServants} color="bg-red-100 text-red-600" href="/settings/approvals" />
          </>
        )}
      </section>

      <section id="quick-actions">
        <h3 className="mb-3 text-sm font-extrabold text-slate-500">إجراءات سريعة</h3>
        <div className="grid grid-cols-3 gap-3">
          <QuickAction href="/scanner" icon={<ScanLine className="h-6 w-6" />} label="تسجيل حضور" />
          <QuickAction href="/children" icon={<Users className="h-6 w-6" />} label="المخدومين" />
          <QuickAction href="/stats" icon={<BarChart3 className="h-6 w-6" />} label="الإحصائيات" />
        </div>
      </section>
    </AppShell>
  );
}

function StatCard({
  icon, label, value, color, href,
}: {
  icon: React.ReactNode; label: string; value: number; color: string; href?: string;
}) {
  const content = (
    <div className="card flex items-center gap-3">
      <span className={`rounded-xl p-2.5 ${color}`}>{icon}</span>
      <div>
        <p className="text-2xl font-extrabold leading-none">{value}</p>
        <p className="text-xs text-slate-500 mt-1">{label}</p>
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="card flex flex-col items-center gap-2 py-4 text-primary-600 hover:bg-primary-50 transition"
    >
      {icon}
      <span className="text-xs font-bold text-slate-600">{label}</span>
    </Link>
  );
}
