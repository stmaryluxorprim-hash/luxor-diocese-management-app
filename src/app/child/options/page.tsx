'use client';

// ---------- Child portal — الخيارات ----------
// Profile summary, quick links, refresh, install hint, and logout.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  SlidersHorizontal, LogOut, RefreshCw, ChevronLeft, Database, CalendarCheck, Star, Camera,
  Pencil, Church, Layers, School, Loader2, Info, ShieldCheck, Smartphone,
} from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { Avatar, PageTitle, fmtDate } from '@/components/child/ChildBits';
import { useChild } from '@/lib/child-context';

export default function ChildOptionsPage() {
  return (
    <ChildShell>
      <OptionsContent />
    </ChildShell>
  );
}

function OptionsContent() {
  const { profile, refresh, logout } = useChild();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  if (!profile) return null;
  const { person, enrollments } = profile;

  const doRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <>
      <PageTitle icon={<SlidersHorizontal className="h-5 w-5 text-primary-600" />} title="الخيارات" />

      {/* Profile card */}
      <section className="card mb-5 flex items-center gap-3">
        <Avatar person={person} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold">{person.name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
            <ShieldCheck className="h-3 w-3" /> مخدوم · مسجل منذ {fmtDate(person.created_at)}
          </p>
        </div>
        <Link href="/child/data" aria-label="بياناتي" className="rounded-xl bg-primary-50 p-2.5 text-primary-600 hover:bg-primary-100">
          <Pencil className="h-4 w-4" />
        </Link>
      </section>

      {/* Data & requests */}
      <section className="mb-5">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">بياناتي</h3>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          <OptLink href="/child/data" icon={<Pencil className="h-5 w-5 text-primary-600" />} label="طلب تعديل البيانات" desc="الاسم، تاريخ الميلاد، الهاتف، العنوان — بموافقة الخادم" />
          <OptLink href="/child/data" icon={<Camera className="h-5 w-5 text-gold-600" />} label="تغيير الصورة" desc="ارفع صورة جديدة لكارتك — تظهر بعد الموافقة" />
          <OptLink href="/child/data" icon={<Database className="h-5 w-5 text-accent-600" />} label="كارتي وكود الـ QR" desc="عرض الكود وحفظه على الهاتف" />
        </div>
      </section>

      {/* Records */}
      <section className="mb-5">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">السجلات</h3>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          <OptLink href="/child/attendance" icon={<CalendarCheck className="h-5 w-5 text-emerald-600" />} label="سجل الحضور" desc="كل مرات الحضور بالتاريخ والوقت" />
          <OptLink href="/child/points" icon={<Star className="h-5 w-5 text-gold-600" />} label="سجل النقاط" desc="الرصيد وكل الإضافات والخصومات" />
        </div>
      </section>

      {/* Enrollments */}
      <section className="mb-5">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">تسجيلاتي</h3>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          {enrollments.map((e) => (
            <div key={e.id} className="px-4 py-3 text-xs font-bold text-slate-600 space-y-0.5">
              <p className="flex items-center gap-1.5"><Church className="h-3.5 w-3.5 text-gold-500" /> {e.church_name}</p>
              <p className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-accent-600" /> {e.service_name}</p>
              <p className="flex items-center gap-1.5"><School className="h-3.5 w-3.5 text-sky-600" /> {e.class_name}</p>
            </div>
          ))}
        </div>
      </section>

      {/* App */}
      <section className="mb-5">
        <h3 className="mb-2 text-sm font-extrabold text-slate-500">التطبيق</h3>
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          <button
            id="child-refresh-btn"
            onClick={doRefresh}
            disabled={refreshing}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-right hover:bg-indigo-50/50 transition"
          >
            <span className="rounded-xl bg-slate-50 p-2">
              {refreshing ? <Loader2 className="h-5 w-5 animate-spin text-primary-600" /> : <RefreshCw className="h-5 w-5 text-primary-600" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-sm">تحديث البيانات</span>
              <span className="block text-xs text-slate-400">إعادة تحميل الحضور والنقاط والبيانات</span>
            </span>
          </button>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="rounded-xl bg-slate-50 p-2"><Smartphone className="h-5 w-5 text-slate-500" /></span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-sm">إضافة للشاشة الرئيسية</span>
              <span className="block text-xs text-slate-400">من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية» لفتح البوابة كتطبيق</span>
            </span>
          </div>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="rounded-xl bg-slate-50 p-2"><Info className="h-5 w-5 text-slate-500" /></span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-sm">عن البوابة</span>
              <span className="block text-xs text-slate-400">تدخل بكارتك فقط — لا يمكنك تعديل الحضور أو النقاط، وأي تعديل في البيانات يحتاج موافقة الخادم</span>
            </span>
          </div>
        </div>
      </section>

      {/* Logout */}
      {!confirmOut ? (
        <button
          id="child-options-logout"
          onClick={() => setConfirmOut(true)}
          className="w-full card flex items-center justify-center gap-2 !py-3.5 font-extrabold text-red-600 hover:bg-red-50 transition"
        >
          <LogOut className="h-5 w-5" />
          خروج من البوابة
        </button>
      ) : (
        <div className="card space-y-3 border-red-100">
          <p className="text-center text-sm font-bold">ستحتاج لمسح كارتك مرة أخرى للدخول — متأكد؟</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmOut(false)} className="btn-secondary flex-1">إلغاء</button>
            <button
              id="child-options-logout-confirm"
              onClick={() => { logout(); router.replace('/child/login'); }}
              className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-bold text-white hover:bg-red-700"
            >
              خروج
            </button>
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-slate-400">بوابة المخدوم — إدارة الإيبارشية</p>
    </>
  );
}

function OptLink({ href, icon, label, desc }: { href: string; icon: React.ReactNode; label: string; desc: string }) {
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
