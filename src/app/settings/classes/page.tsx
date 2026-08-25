'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { School, Plus, ArrowRight, Loader2, X } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { ClassRoom, Service } from '@/lib/types';

export default function ClassesPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  const canAdd = profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  const load = useCallback(async () => {
    const [{ data: cl }, { data: sv }] = await Promise.all([
      supabase.from('classes').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
    ]);
    setClasses(cl ?? []);
    setServices(sv ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile, load]);

  useEffect(() => {
    if (!profile) return;
    const ch = supabase
      .channel('classes-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classes' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile, supabase, load]);

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? '';

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <School className="h-5 w-5 text-sky-600" />
            الفصول
            <span className="badge bg-sky-100 text-sky-700">{classes.length}</span>
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
          {classes.map((c) => (
            <li key={c.id} className="card">
              <p className="font-extrabold">{c.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{serviceName(c.service_id)}</p>
              {c.description && <p className="text-xs text-slate-500 mt-1">{c.description}</p>}
            </li>
          ))}
          {classes.length === 0 && (
            <li className="card py-12 text-center text-slate-400 font-bold">لا توجد فصول بعد</li>
          )}
        </ul>
      )}

      {showAdd && (
        <AddClassModal
          services={services}
          fixedServiceId={profile?.role === 'service_manager' ? profile.service_id : null}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}
    </AppShell>
  );
}

function AddClassModal({
  services, fixedServiceId, onClose, onSaved,
}: {
  services: Service[]; fixedServiceId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [serviceId, setServiceId] = useState(fixedServiceId ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) return setError('اختر الخدمة');
    setSaving(true);
    const { error: err } = await supabase.from('classes').insert({
      church_id: svc.church_id,
      service_id: svc.id,
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
          <h3 className="text-lg font-extrabold">إضافة فصل</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {!fixedServiceId && (
            <select className="input-field" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
              <option value="">اختر الخدمة *</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <input className="input-field" placeholder="اسم الفصل * (مثال: ابتدائي أول)" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <textarea className="input-field" placeholder="وصف الفصل" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            حفظ الفصل
          </button>
        </form>
      </div>
    </div>
  );
}
