'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Award, Plus, ArrowRight, Loader2, X, Pencil, Save, Trash2,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { Cause, ClassRoom, Service, Church } from '@/lib/types';

export default function CausesPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [causes, setCauses] = useState<Cause[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Cause | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: ca }, { data: cl }, { data: sv }, { data: ch }] = await Promise.all([
      supabase.from('causes').select('*').order('name'),
      supabase.from('classes').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('churches').select('*').order('name'),
    ]);
    setCauses(ca ?? []);
    setClasses(cl ?? []);
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
      .channel('causes-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'causes' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile, supabase, load]);

  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '';
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? '';
  const churchName = (id: string) => churches.find((c) => c.id === id)?.name ?? '';

  const remove = async (ca: Cause) => {
    if (!confirm(`حذف السبب «${ca.name}»؟ سجلات النقاط المرتبطة به ستبقى بدون سبب.`)) return;
    await supabase.from('causes').delete().eq('id', ca.id);
    load();
  };

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Award className="h-5 w-5 text-amber-600" />
            أسباب النقاط
            <span className="badge bg-amber-100 text-amber-700">{causes.length}</span>
          </h2>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary !py-2 !px-3 flex items-center gap-1 text-sm">
          <Plus className="h-4 w-4" /> إضافة
        </button>
      </section>

      <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
        النقاط تُسجَّل بسبب (حفظ آية، سلوك، مسابقة...) مرتبط بكنيسة وخدمة وفصل.
      </p>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <ul className="space-y-3">
          {causes.map((ca) => (
            <li key={ca.id} className="card flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 ring-2 ring-amber-100">
                <Award className="h-6 w-6 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold">{ca.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {churchName(ca.church_id)} ← {serviceName(ca.service_id)} ← {className(ca.class_id)}
                </p>
                {ca.description && <p className="text-xs text-slate-500 mt-1">{ca.description}</p>}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => setEditing(ca)}
                  aria-label={`تعديل ${ca.name}`}
                  className="rounded-xl bg-amber-50 p-2 text-amber-600 hover:bg-amber-100 transition"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => remove(ca)}
                  aria-label={`حذف ${ca.name}`}
                  className="rounded-xl bg-red-50 p-2 text-red-600 hover:bg-red-100 transition"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
          {causes.length === 0 && (
            <li className="card py-12 text-center text-slate-400 font-bold">لا توجد أسباب بعد</li>
          )}
        </ul>
      )}

      {showAdd && (
        <CauseModal
          mode="add"
          churches={churches}
          services={services}
          classes={classes}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}
      {editing && (
        <CauseModal
          mode="edit"
          cause={editing}
          churches={churches}
          services={services}
          classes={classes}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </AppShell>
  );
}

function CauseModal({
  mode, cause, churches, services, classes, onClose, onSaved,
}: {
  mode: 'add' | 'edit';
  cause?: Cause;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const supabase = createClient();
  const [name, setName] = useState(cause?.name ?? '');
  const [description, setDescription] = useState(cause?.description ?? '');
  const [churchId, setChurchId] = useState(cause?.church_id ?? '');
  const [serviceId, setServiceId] = useState(cause?.service_id ?? '');
  const [classId, setClassId] = useState(cause?.class_id ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredServices = churchId ? services.filter((s) => s.church_id === churchId) : services;
  const filteredClasses = classes.filter(
    (c) => (!churchId || c.church_id === churchId) && (!serviceId || c.service_id === serviceId)
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cls = classes.find((c) => c.id === classId);
    if (!cls) return setError('اختر الفصل');
    setSaving(true);

    const base = {
      church_id: cls.church_id,
      service_id: cls.service_id,
      class_id: cls.id,
      name: name.trim(),
      description: description.trim() || null,
    };

    const { error: err } = mode === 'add'
      ? await supabase.from('causes').insert({ ...base, created_by: profile?.id })
      : await supabase.from('causes').update({ ...base, edited_by: profile?.id }).eq('id', cause!.id);

    if (err) {
      setError('تعذر الحفظ، تأكد من الصلاحيات');
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">{mode === 'add' ? 'إضافة سبب' : 'تعديل السبب'}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
            <select
              className="input-field"
              value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}
              required
            >
              <option value="">اختر الكنيسة</option>
              {churches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
            <select
              className="input-field"
              value={serviceId}
              onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}
              required
            >
              <option value="">اختر الخدمة</option>
              {filteredServices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الفصل *</label>
            <select
              className="input-field"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              required
            >
              <option value="">اختر الفصل</option>
              {filteredClasses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <input className="input-field" placeholder="اسم السبب * (مثال: حفظ آية)" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <textarea className="input-field" placeholder="وصف السبب" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === 'add' ? <Plus className="h-5 w-5" /> : <Save className="h-5 w-5" />}
            {mode === 'add' ? 'حفظ السبب' : 'حفظ التعديلات'}
          </button>
        </form>
      </div>
    </div>
  );
}
