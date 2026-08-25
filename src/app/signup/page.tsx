'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { UserPlus, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { userIdToEmail } from '@/lib/types';

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    full_name: '',
    user_id: '',
    phone: '',
    password: '',
    confirm: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

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

    // 1) Create auth user (user_id mapped to synthetic email)
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

    // 2) Create pending profile (RLS: user can insert own pending profile)
    const { error: profErr } = await supabase.from('profiles').insert({
      id: data.user.id,
      full_name: form.full_name.trim(),
      user_id: form.user_id.trim().toLowerCase(),
      phone: form.phone.trim(),
      role: 'class_servant',
      status: 'pending',
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

    router.replace('/');
    router.refresh();
  };

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
