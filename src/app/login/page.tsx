'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Church, LogIn, Loader2, User, Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { userIdToEmail } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: err } = await supabase.auth.signInWithPassword({
      email: userIdToEmail(userId),
      password,
    });

    if (err) {
      setError('بيانات الدخول غير صحيحة، تأكد من المعرف وكلمة المرور');
      setLoading(false);
      return;
    }
    router.replace('/');
    router.refresh();
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <section id="login-card" className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-600 to-accent-600 shadow-lg">
            <Church className="h-10 w-10 text-gold-300" />
          </div>
          <h1 className="text-2xl font-extrabold">إدارة الإيبارشية</h1>
          <p className="text-sm text-slate-500 mt-1">سجّل دخولك للمتابعة</p>
        </div>

        <form onSubmit={handleLogin} className="card space-y-4">
          <div>
            <label htmlFor="login-user-id" className="mb-1.5 block text-sm font-bold">
              معرف المستخدم
            </label>
            <div className="relative">
              <User className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                id="login-user-id"
                className="input-field pr-9"
                placeholder="user_id"
                dir="ltr"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-sm font-bold">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                id="login-password"
                type="password"
                className="input-field pr-9"
                placeholder="••••••••"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
            تسجيل الدخول
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          خادم جديد؟{' '}
          <Link href="/signup" className="font-bold text-primary-600 hover:underline">
            إنشاء حساب
          </Link>
        </p>
      </section>
    </main>
  );
}
