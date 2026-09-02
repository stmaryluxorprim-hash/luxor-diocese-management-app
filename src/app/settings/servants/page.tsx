'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Users, ArrowRight, Loader2, X, Pencil, Save, Upload, User,
  Phone, ShieldCheck, PauseCircle, PlayCircle, Trash2,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { uploadPhoto } from '@/lib/upload';
import type { Profile, Church, Service, ClassRoom, AppRole } from '@/lib/types';
import { ROLE_LABELS, STATUS_LABELS } from '@/lib/types';

export default function ServantsPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [servants, setServants] = useState<Profile[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const isManager = profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  // Manage per level: owner → all, church manager → his church, service manager → his service
  const canManage = (p: Profile) => {
    if (!profile || p.id === profile.id) return false; // own data edited from settings
    if (profile.role === 'owner') return true;
    if (profile.role === 'church_manager') return p.church_id === profile.church_id && p.role !== 'owner';
    if (profile.role === 'service_manager')
      return p.service_id === profile.service_id && ['class_servant'].includes(p.role);
    return false;
  };

  const load = useCallback(async () => {
    const [{ data: pr }, { data: ch }, { data: sv }, { data: cl }] = await Promise.all([
      supabase.from('profiles').select('*').neq('status', 'pending').order('full_name'),
      supabase.from('churches').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('classes').select('*').order('name'),
    ]);
    setServants(pr ?? []);
    setChurches(ch ?? []);
    setServices(sv ?? []);
    setClasses(cl ?? []);
    setLoading(false);
  }, [supabase]);

  useDebouncedRealtime(supabase, 'servants-page', [{ table: 'profiles' }], load, { enabled: !!profile });

  const churchName = (id: string | null) => churches.find((c) => c.id === id)?.name;
  const serviceName = (id: string | null) => services.find((s) => s.id === id)?.name;
  const className = (id: string | null) => classes.find((c) => c.id === id)?.name;

  const toggleSuspend = async (p: Profile) => {
    const next = p.status === 'suspended' ? 'approved' : 'suspended';
    await supabase.from('profiles').update({ status: next }).eq('id', p.id);
    load();
  };

  const remove = async (p: Profile) => {
    if (!window.confirm(`هل أنت متأكد من حذف الخادم "${p.full_name}"؟ لا يمكن التراجع.`)) return;
    await supabase.from('profiles').delete().eq('id', p.id);
    load();
  };

  if (!isManager) {
    return (
      <AppShell>
        <div className="card py-12 text-center text-slate-400 font-bold">
          هذه الصفحة متاحة للمديرين فقط
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="mb-4 flex items-center gap-2">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Users className="h-5 w-5 text-emerald-600" />
          إدارة الخدام
          <span className="badge bg-emerald-100 text-emerald-700">{servants.length}</span>
        </h2>
      </section>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <ul className="space-y-3">
          {servants.map((p) => (
            <li key={p.id} className={`card ${p.status === 'suspended' ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-emerald-50 ring-2 ring-emerald-100 flex items-center justify-center">
                  {p.photo_url ? (
                    <Image src={p.photo_url} alt={p.full_name} fill sizes="48px" className="object-cover" />
                  ) : (
                    <User className="h-6 w-6 text-emerald-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold truncate">{p.full_name}</p>
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="badge bg-primary-100 text-primary-700">
                      <ShieldCheck className="h-3 w-3" /> {ROLE_LABELS[p.role]}
                    </span>
                    {p.status !== 'approved' && (
                      <span className="badge bg-amber-100 text-amber-700">{STATUS_LABELS[p.status]}</span>
                    )}
                    <span className="flex items-center gap-1" dir="ltr">
                      <Phone className="h-3 w-3" /> {p.phone}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {[churchName(p.church_id), serviceName(p.service_id), className(p.class_id)]
                      .filter(Boolean).join(' ← ') || 'بدون نطاق محدد'}
                  </p>
                </div>
              </div>
              {canManage(p) && (
                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                  <button
                    onClick={() => setEditing(p)}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary-50 py-2 text-xs font-bold text-primary-600 hover:bg-primary-100 transition"
                  >
                    <Pencil className="h-3.5 w-3.5" /> تعديل
                  </button>
                  <button
                    onClick={() => toggleSuspend(p)}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition ${
                      p.status === 'suspended'
                        ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                        : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                    }`}
                  >
                    {p.status === 'suspended'
                      ? (<><PlayCircle className="h-3.5 w-3.5" /> تفعيل</>)
                      : (<><PauseCircle className="h-3.5 w-3.5" /> إيقاف</>)}
                  </button>
                  <button
                    onClick={() => remove(p)}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-red-50 py-2 text-xs font-bold text-red-600 hover:bg-red-100 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> حذف
                  </button>
                </div>
              )}
            </li>
          ))}
          {servants.length === 0 && (
            <li className="card py-12 text-center text-slate-400 font-bold">لا يوجد خدام بعد</li>
          )}
        </ul>
      )}

      {editing && profile && (
        <EditServantModal
          servant={editing}
          approver={profile}
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

function EditServantModal({
  servant, approver, churches, services, classes, onClose, onSaved,
}: {
  servant: Profile;
  approver: Profile;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [fullName, setFullName] = useState(servant.full_name);
  const [phone, setPhone] = useState(servant.phone);
  const [role, setRole] = useState<AppRole>(servant.role);
  const [churchId, setChurchId] = useState(servant.church_id ?? '');
  const [serviceId, setServiceId] = useState(servant.service_id ?? '');
  const [classId, setClassId] = useState(servant.class_id ?? '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Roles the approver may grant
  const grantableRoles: AppRole[] =
    approver.role === 'owner'
      ? ['church_manager', 'service_manager', 'class_servant']
      : approver.role === 'church_manager'
      ? ['service_manager', 'class_servant']
      : ['class_servant'];

  // Scope locking per approver level
  const churchLocked = approver.role !== 'owner';
  const serviceLocked = approver.role === 'service_manager';

  const scopedServices = services.filter((s) => !churchId || s.church_id === churchId);
  const scopedClasses = classes.filter((c) => !serviceId || c.service_id === serviceId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    let photo_url = servant.photo_url ?? null;
    if (photoFile) {
      try {
        photo_url = await uploadPhoto(supabase, 'servants', photoFile);
      } catch {
        setError('تعذر رفع الصورة');
        setSaving(false);
        return;
      }
    }

    // Empty scope = "كل الـ..." at that manager level (null in DB)
    const { error: err } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        phone: phone.trim(),
        role,
        church_id: churchId || null,
        service_id: serviceId || null,
        class_id: classId || null,
        photo_url,
      })
      .eq('id', servant.id);

    if (err) {
      setError('تعذر الحفظ، تأكد من الصلاحيات');
      setSaving(false);
      return;
    }
    onSaved();
  };

  const lockCls = (locked: boolean) =>
    `input-field ${locked ? 'bg-primary-50 pointer-events-none opacity-80' : ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">تعديل الخادم</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input className="input-field" placeholder="الاسم الكامل *" value={fullName}
            onChange={(e) => setFullName(e.target.value)} required />
          <input className="input-field" placeholder="رقم الهاتف" dir="ltr" value={phone}
            onChange={(e) => setPhone(e.target.value)} />

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الدور</label>
            <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
              {grantableRoles.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة</label>
            <select
              className={lockCls(churchLocked)}
              value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}
            >
              <option value="">كل الكنائس (بدون تحديد)</option>
              {churches.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة</label>
            <select
              className={lockCls(serviceLocked)}
              value={serviceId}
              onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}
            >
              <option value="">كل الخدمات (بدون تحديد)</option>
              {scopedServices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الفصل</label>
            <select
              className="input-field"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">كل الفصول (بدون تحديد)</option>
              {scopedClasses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 px-4 py-3 text-sm font-bold text-emerald-600">
            <Upload className="h-4 w-4" />
            {photoFile ? photoFile.name : servant.photo_url ? 'تغيير صورة الخادم' : 'إضافة صورة الخادم (اختياري)'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
          </label>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            حفظ التعديلات
          </button>
        </form>
      </div>
    </div>
  );
}
