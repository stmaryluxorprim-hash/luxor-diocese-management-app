'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Layers, Plus, ArrowRight, Loader2, X } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { Service, Church } from '@/lib/types';

export default function ServicesPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [services, setServices] = useState<Service[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  const canAdd = profile && ['owner', 'church_manager'].includes(profile.role);

  const load = useCallback(async () => {
    const [{ data: sv }, { data: ch }] = await Promise.all([
      supabase.from('services').select('*').order('name'),
      supabase.from('churches').select('*').order('name'),
    ]);
    setServices(sv ?? []);
    setChurches(ch ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile, load]);

  useEffect(() => {
    if (!profile) return;
    const ch = supabase
      .channel('services-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'services' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile, supabase, load]);

  const churchName = (id: string) => churches.find((c) => c.id === id)?.name ?? '';

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Layers className="h-5 w-5 text-accent-600" />
            الخدمات
            <span className="badge bg-accent-100 text-accent-700">{services.length}</span>
          </h2>
        </div>
        {canAdd && (
          <button onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
            <Plus className="h-4 w-4" /> إضافة
          </button>
        )}
      </section>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <ul className="space-y-3">
          {services.map((s) => (
            <li key={s.id} className="card">
              <p className="font-extrabold">{s.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{churchName(s.church_id)}</p>
              {s.description && <p className="text-xs text-slate-500 mt-1">{s.description}</p>}
            </li>
          ))}
          {services.length === 0 && (
            <li className="card py-12 text-center text-slate-400 font-bold">لا توجد خدمات بعد</li>
          )}
        </ul>
      )}

      {showAdd && (
        <AddServiceModal
          churches={churches}
          fixedChurchId={profile?.role === 'church_manager' ? profile.church_id : null}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}
    </AppShell>
  );
}

function AddServiceModal({
  churches, fixedChurchId, onClose, onSaved,
}: {
  churches: Church[]; fixedChurchId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [churchId, setChurchId] = useState(fixedChurchId ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!churchId) return setError('اختر الكنيسة');
    setSaving(true);
    const { error: err } = await supabase.from('services').insert({
      church_id: churchId,
      name: name.trim(),
      description: description.trim() || null,
    });
    if (err) {
      setError('تعذر الحفظ، تأكد من الصلاحيات');
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">إضافة خدمة</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {!fixedChurchId && (
            <select className="input-field" value={churchId} onChange={(e) => setChurchId(e.target.value)} required>
              <option value="">اختر الكنيسة *</option>
              {churches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <input className="input-field" placeholder="اسم الخدمة * (مثال: مدارس الأحد)" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <textarea className="input-field" placeholder="وصف الخدمة" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            حفظ الخدمة
          </button>
        </form>
      </div>
    </div>
  );
}
