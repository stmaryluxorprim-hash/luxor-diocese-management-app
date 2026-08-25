'use client';

import Link from 'next/link';
import {
  Settings, UserCheck, Church, Layers, School, LogOut, ChevronLeft, User, Phone, ShieldCheck,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABELS } from '@/lib/types';

export default function SettingsPage() {
  const { profile, signOut } = useAuth();

  const isOwner = profile?.role === 'owner';
  const isManager =
    profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  return (
    <AppShell>
      <section className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Settings className="h-5 w-5 text-primary-600" />
          الإعدادات
        </h2>
      </section>

      {/* Profile card */}
      <section id="profile-card" className="card mb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
            <User className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <p className="font-extrabold truncate">{profile?.full_name}</p>
            <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
              <span className="badge bg-primary-100 text-primary-700">
                <ShieldCheck className="h-3 w-3" />
                {profile ? ROLE_LABELS[profile.role] : ''}
              </span>
              <span className="flex items-center gap-1" dir="ltr">
                <Phone className="h-3 w-3" /> {profile?.phone}
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* Management sections */}
      {isManager && (
        <section id="management-links" className="mb-5">
          <h3 className="mb-2 text-sm font-extrabold text-slate-500">الإدارة</h3>
          <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            <SettingsLink
              href="/settings/approvals"
              icon={<UserCheck className="h-5 w-5 text-emerald-600" />}
              label="طلبات انضمام الخدام"
              desc="قبول أو رفض طلبات التسجيل"
            />
            {isOwner && (
              <SettingsLink
                href="/settings/churches"
                icon={<Church className="h-5 w-5 text-gold-500" />}
                label="إدارة الكنائس"
                desc="إضافة وتعديل الكنائس وشعاراتها"
              />
            )}
            <SettingsLink
              href="/settings/services"
              icon={<Layers className="h-5 w-5 text-accent-600" />}
              label="إدارة الخدمات"
              desc="خدمات الكنيسة (مدارس أحد، شباب...)"
            />
            <SettingsLink
              href="/settings/classes"
              icon={<School className="h-5 w-5 text-sky-600" />}
              label="إدارة الفصول"
              desc="فصول كل خدمة"
            />
          </div>
        </section>
      )}

      <button
        id="logout-btn"
        onClick={signOut}
        className="w-full card flex items-center justify-center gap-2 !py-3.5 font-extrabold text-red-600 hover:bg-red-50 transition"
      >
        <LogOut className="h-5 w-5" />
        تسجيل الخروج
      </button>

      <p className="mt-6 text-center text-xs text-slate-400">
        إدارة الإيبارشية — الإصدار 0.1.0
      </p>
    </AppShell>
  );
}

function SettingsLink({
  href, icon, label, desc,
}: {
  href: string; icon: React.ReactNode; label: string; desc: string;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-indigo-50/50 transition">
      <span className="rounded-xl bg-slate-50 p-2">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-sm">{label}</span>
        <span className="block text-xs text-slate-400 truncate">{desc}</span>
      </span>
      <ChevronLeft className="h-4 w-4 text-slate-300" />
    </Link>
  );
}
