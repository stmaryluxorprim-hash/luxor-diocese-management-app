'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { UserPlus, Loader2, Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { userIdToEmail } from '@/lib/types';
import type { Church, Service, ClassRoom } from '@/lib/types';

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const params = useSearchParams();
  const supabase = createClient();

  // Invite-link scope (locked when present)
  const inviteChurch = params.get('church') ?? '';
  const inviteService = params.get('service') ?? '';
  const inviteClass = params.get('class') ?? '';

  const [form, setForm] = useState({
    full_name: '',
    user_id: '',
    phone: '',
    password: '',
    confirm: '',
  });
  const [churchId, setChurchId] = useState(inviteChurch);
  const [serviceId, setServiceId] = useState(inviteService);
  const [classId, setClassId] = useState(inviteClass);

  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Load structure lists (anon-readable via migration 0003)
  useEffect(() => {
    (async () => {
      const [{ data: ch }, { data: sv }, { data: cl }] = await Promise.all([
        supabase.from('churches').select('*').order('name'),
        supabase.from('services').select('*').order('name'),
        supabase.from('classes').select('*').order('name'),
      ]);
      setChurches(ch ?? []);
      setServices(sv ?? []);
      setClasses(cl ?? []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const scopedServices = services.filter((s) => !churchId || s.church_id === churchId);
  const scopedClasses = classes.filter((c) => !serviceId || c.service_id === serviceId);

  const churchLocked = !!inviteChurch;
  const serviceLocked = !!inviteService;
  const classLocked = !!inviteClass;

  const churchName = churches.find((c) => c.id === churchId)?.name;
  const serviceName = services.find((s) => s.id === serviceId)?.name;
  const className = classes.find((c) => c.id === classId)?.name;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(form.user_id)) {
      setError('معرف المستخدم يجب أن يكون بالإنجليزية (3-30 حرف/رقم بدون مسافات)');
      return;
    }
    if (form.password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (form.password !== form.confirm) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }

    setLoading(true);

    // 1) Create auth user
    const { data, error: signErr } = await supabase.auth.signUp({
      email: userIdToEmail(form.user_id),
      password: form.password,
    });

    if (signErr || !data.user) {
      setError(
        signErr?.message?.includes('already registered')
          ? 'هذا المعرف مستخدم بالفعل، اختر معرفاً آخر'
          : 'حدث خطأ أثناء إنشاء الحساب، حاول مرة أخرى'
      );
      setLoading(false);
      return;
    }

    // 2) Create pending profile WITH chosen scope.
    //    Visibility of the request follows the scope:
    //    none -> owner only | church -> +church manager | +service -> +service manager
    const { error: profErr } = await supabase.from('profiles').insert({
      id: data.user.id,
      full_name: form.full_name.trim(),
      user_id: form.user_id.trim().toLowerCase(),
      phone: form.phone.trim(),
      role: 'class_servant',
      status: 'pending',
      church_id: churchId || null,
      service_id: serviceId || null,
      class_id: classId || null,
    });

    if (profErr) {
      setError(
        profErr.message.includes('duplicate')
          ? 'هذا المعرف مستخدم بالفعل، اختر معرفاً آخر'
          : 'تعذر حفظ البيانات، حاول مرة أخرى'
      );
      setLoading(false);
      return;
    }

    // 3) Hard navigation so AuthProvider re-initializes with the fresh
    //    profile — pending screen shows immediately (part of the gate bug fix)
    window.location.href = '/';
  };

  const selectCls = (locked: boolean) =>
    `input-field ${locked ? 'bg-primary-50 text-primary-800 font-bold pointer-events-none' : ''}`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <section id="signup-card" className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 h-24 w-24 overflow-hidden rounded-3xl shadow-lg ring-2 ring-gold-300/50">
            <Image
              src="/icons/icon-192.png"
              alt="شعار الإيبارشية"
              width={96}
              height={96}
              priority
              className="h-full w-full object-cover"
            />
          </div>
          <h1 className="text-2xl font-extrabold">تسجيل خادم جديد</h1>
          <p className="text-sm text-slate-500 mt-1">
            سيتم مراجعة طلبك من المسؤول قبل التفعيل
          </p>
        </div>

        {/* Invite banner when arriving via a scoped link */}
        {(churchLocked || serviceLocked || classLocked) && (
          <div id="invite-banner" className="mb-4 rounded-2xl bg-gradient-to-l from-primary-600 to-accent-600 px-4 py-3 text-white text-sm font-bold flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0" />
            <span>
              دعوة للانضمام إلى: {churchName ?? '...'}
              {serviceName ? ` ← ${serviceName}` : ''}
              {className ? ` ← ${className}` : ''}
            </span>
          </div>
        )}

        <form onSubmit={handleSignup} className="card space-y-4">
          <div>
            <label htmlFor="su-name" className="mb-1.5 block text-sm font-bold">الاسم الكامل</label>
            <input id="su-name" className="input-field" placeholder="مثال: مينا صموئيل"
              value={form.full_name} onChange={set('full_name')} required />
          </div>

          <div>
            <label htmlFor="su-user-id" className="mb-1.5 block text-sm font-bold">معرف المستخدم (للدخول)</label>
            <input id="su-user-id" className="input-field" placeholder="mina.samuel" dir="ltr"
              value={form.user_id} onChange={set('user_id')} required autoComplete="username" />
          </div>

          <div>
            <label htmlFor="su-phone" className="mb-1.5 block text-sm font-bold">رقم الهاتف</label>
            <input id="su-phone" type="tel" className="input-field" placeholder="01xxxxxxxxx" dir="ltr"
              value={form.phone} onChange={set('phone')} required />
          </div>

          {/* Scope selection — optional; locked levels come from invite link */}
          <div id="scope-section" className="rounded-xl bg-slate-50 p-3 space-y-2">
            <p className="text-xs font-extrabold text-slate-500">
              مكان الخدمة <span className="font-normal">(اختياري — يمكن للمسؤول تحديده عند القبول)</span>
            </p>

            <select
              id="su-church"
              className={selectCls(churchLocked)}
              value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}
              tabIndex={churchLocked ? -1 : 0}
            >
              <option value="">اختر الكنيسة</option>
              {churches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {churchId && (
              <select
                id="su-service"
                className={selectCls(serviceLocked)}
                value={serviceId}
                onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}
                tabIndex={serviceLocked ? -1 : 0}
              >
                <option value="">اختر الخدمة</option>
                {scopedServices.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}

            {serviceId && (
              <select
                id="su-class"
                className={selectCls(classLocked)}
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                tabIndex={classLocked ? -1 : 0}
              >
                <option value="">اختر الفصل</option>
                {scopedClasses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label htmlFor="su-password" className="mb-1.5 block text-sm font-bold">كلمة المرور</label>
            <input id="su-password" type="password" className="input-field" placeholder="••••••••" dir="ltr"
              value={form.password} onChange={set('password')} required autoComplete="new-password" />
          </div>

          <div>
            <label htmlFor="su-confirm" className="mb-1.5 block text-sm font-bold">تأكيد كلمة المرور</label>
            <input id="su-confirm" type="password" className="input-field" placeholder="••••••••" dir="ltr"
              value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
            إرسال طلب التسجيل
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          لديك حساب بالفعل؟{' '}
          <Link href="/login" className="font-bold text-primary-600 hover:underline">
            تسجيل الدخول
          </Link>
        </p>
      </section>
    </main>
  );
}
