'use client';

import { useState } from 'react';
import { X, Save, User, Phone } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';

export default function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { profile, refresh } = useAuth();
  const supabase = createClient();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!profile) return;
    if (!fullName.trim()) return setError('الاسم مطلوب');
    setBusy(true);
    setError('');
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() })
      .eq('id', profile.id);
    setBusy(false);
    if (err) return setError('تعذر حفظ التعديلات، حاول مجدداً');
    await refresh();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-gray-800">تعديل بياناتي</h2>
          <button onClick={onClose} className="rounded-xl bg-gray-100 p-2">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
              <User className="h-3.5 w-3.5" /> الاسم الكامل
            </label>
            <input
              className="input-field"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="الاسم الكامل"
            />
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
              <Phone className="h-3.5 w-3.5" /> رقم الهاتف
            </label>
            <input
              className="input-field"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01xxxxxxxxx"
              dir="ltr"
            />
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
          )}

          <button
            onClick={save}
            disabled={busy}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {busy ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  );
}
