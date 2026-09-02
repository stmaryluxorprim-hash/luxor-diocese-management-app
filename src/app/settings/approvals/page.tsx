'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  UserCheck, Check, X, Phone, Loader2, ArrowRight, ShieldQuestion,
} from 'lucide-react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import type { Profile, Church, Service, ClassRoom, AppRole } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/types';

export default function ApprovalsPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [pending, setPending] = useState<Profile[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: p }, { data: ch }, { data: sv }, { data: cl }] = await Promise.all([
      supabase.from('profiles').select('*').eq('status', 'pending').order('created_at'),
      supabase.from('churches').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('classes').select('*').order('name'),
    ]);
    setPending(p ?? []);
    setChurches(ch ?? []);
    setServices(sv ?? []);
    setClasses(cl ?? []);
    setLoading(false);
  }, [supabase]);

  // Initial fetch — the realtime hook below only reloads on DB change events,
  // so without this the page would sit on the spinner until something changed.
  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'approvals-page', [{ table: 'profiles' }], load, { enabled: !!profile });

  const isManager =
    profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  if (profile && !isManager) {
    return (
      <AppShell>
        <div className="card py-12 text-center text-slate-400">
          <ShieldQuestion className="mx-auto mb-3 h-10 w-10" />
          <p className="font-bold">هذه الصفحة متاحة للمسؤولين فقط</p>
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
          <UserCheck className="h-5 w-5 text-emerald-600" />
          طلبات الانضمام
          <span className="badge bg-red-100 text-red-600">{pending.length}</span>
        </h2>
      </section>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : pending.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <UserCheck className="mx-auto mb-3 h-10 w-10" />
          <p className="font-bold">لا توجد طلبات معلقة 🎉</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {pending.map((p) => (
            <ApprovalCard
              key={p.id}
              request={p}
              approver={profile!}
              churches={churches}
              services={services}
              classes={classes}
              onDone={load}
            />
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function ApprovalCard({
  request, approver, churches, services, classes, onDone,
}: {
  request: Profile;
  approver: Profile;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onDone: () => void;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Assignment scope defaults follow the approver's own scope
  const [role, setRole] = useState<AppRole>('class_servant');
  const [churchId, setChurchId] = useState(request.church_id ?? approver.church_id ?? '');
  const [serviceId, setServiceId] = useState(request.service_id ?? approver.service_id ?? '');
  const [classId, setClassId] = useState(request.class_id ?? '');

  // Roles the approver is allowed to grant
  const grantableRoles: AppRole[] =
    approver.role === 'owner'
      ? ['church_manager', 'service_manager', 'class_servant']
      : approver.role === 'church_manager'
      ? ['service_manager', 'class_servant']
      : ['class_servant'];

  const scopedServices = services.filter((s) => !churchId || s.church_id === churchId);
  const scopedClasses = classes.filter((c) => !serviceId || c.service_id === serviceId);

  const needService = role === 'service_manager' || role === 'class_servant';
  const needClass = role === 'class_servant';

  const approve = async () => {
    setError('');
    // church is required except for owner-level assignments;
    // empty service/class = "كل الـ..." under the parent scope (null in DB)
    if (!churchId) return setError('اختر الكنيسة');

    setBusy(true);
    const { error: err } = await supabase
      .from('profiles')
      .update({
        status: 'approved',
        role,
        church_id: churchId,
        service_id: needService ? (serviceId || null) : null,
        class_id: needClass ? (classId || null) : null,
        approved_by: approver.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', request.id);
    setBusy(false);
    if (err) return setError('تعذر الاعتماد، حاول مجدداً');
    onDone();
  };

  const reject = async () => {
    setBusy(true);
    await supabase.from('profiles').update({ status: 'rejected' }).eq('id', request.id);
    setBusy(false);
    onDone();
  };

  return (
    <li className="card">
      <div className="mb-3">
        <p className="font-extrabold">{request.full_name}</p>
        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-3">
          <span dir="ltr">@{request.user_id}</span>
          <span className="flex items-center gap-1" dir="ltr">
            <Phone className="h-3 w-3" /> {request.phone}
          </span>
        </p>
        {(request.church_id || request.service_id || request.class_id) && (
          <p className="mt-1.5 text-xs font-bold text-primary-600 bg-primary-50 rounded-lg px-2 py-1 inline-block">
            طلب الانضمام إلى: {churches.find((c) => c.id === request.church_id)?.name ?? '—'}
            {request.service_id ? ` ← ${services.find((s) => s.id === request.service_id)?.name ?? ''}` : ''}
            {request.class_id ? ` ← ${classes.find((c) => c.id === request.class_id)?.name ?? ''}` : ''}
          </p>
        )}
      </div>

      <div className="space-y-2 mb-3">
        <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
          {grantableRoles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>

        <select
          className="input-field"
          value={churchId}
          onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}
          disabled={approver.role !== 'owner'}
        >
          <option value="">اختر الكنيسة</option>
          {churches.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {needService && (
          <select
            className="input-field"
            value={serviceId}
            onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}
            disabled={approver.role === 'service_manager'}
          >
            <option value="">كل الخدمات (بدون تحديد)</option>
            {scopedServices.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}

        {needClass && (
          <select className="input-field" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">كل الفصول (بدون تحديد)</option>
            {scopedClasses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
      )}

      <div className="flex gap-2">
        <button onClick={approve} disabled={busy}
          className="btn-primary flex-1 !py-2.5 flex items-center justify-center gap-1 text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          اعتماد
        </button>
        <button onClick={reject} disabled={busy}
          className="flex-1 rounded-xl border border-red-200 bg-white py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 transition flex items-center justify-center gap-1">
          <X className="h-4 w-4" />
          رفض
        </button>
      </div>
    </li>
  );
}
