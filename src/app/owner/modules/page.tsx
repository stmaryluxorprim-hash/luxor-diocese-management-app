'use client';

// ---------- OWNER MODULE → صلاحيات الوحدات ----------
// For every module in the registry the owner sees its grants (كنيسة → خدمة
// → فصل, each level can be "all") and can add / remove grants. A module
// with NO grants is hidden from everyone but the owner. Realtime: the side
// menu & settings of every signed-in servant react instantly.

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowRight, Layers, Plus, X, Trash2, Loader2, Globe, Church as ChurchIcon, School,
  EyeOff, Eye, ShieldCheck,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { cachedLookup } from '@/lib/queries';
import { useModules } from '@/lib/modules-context';
import { MODULES, type AppModule, type ModuleAccess } from '@/lib/modules';
import type { Church, Service, ClassRoom } from '@/lib/types';

const ALL = 'all';

export default function OwnerModulesPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const { grants, loading, reload } = useModules();

  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [adding, setAdding] = useState<AppModule | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (profile?.role !== 'owner') return;
    (async () => {
      const [c, s, cl] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
      ]);
      setChurches(c); setServices(s); setClasses(cl);
    })();
  }, [supabase, profile?.role]);

  const byModule = useMemo(() => {
    const m = new Map<string, ModuleAccess[]>();
    for (const g of grants) {
      const list = m.get(g.module_key) ?? [];
      list.push(g);
      m.set(g.module_key, list);
    }
    return m;
  }, [grants]);

  const name = {
    church: (id: string | null) => churches.find((c) => c.id === id)?.name ?? '…',
    service: (id: string | null) => services.find((s) => s.id === id)?.name ?? '…',
    class: (id: string | null) => classes.find((c) => c.id === id)?.name ?? '…',
  };

  const scopeLabel = (g: ModuleAccess) => {
    if (g.church_id === null) return 'كل الكنائس';
    if (g.service_id === null) return `${name.church(g.church_id)} ← كل الخدمات`;
    if (g.class_id === null) return `${name.church(g.church_id)} ← ${name.service(g.service_id)} ← كل الفصول`;
    return `${name.church(g.church_id)} ← ${name.service(g.service_id)} ← ${name.class(g.class_id)}`;
  };

  const ScopeIcon = (g: ModuleAccess) =>
    g.church_id === null ? Globe : g.service_id === null ? ChurchIcon : g.class_id === null ? Layers : School;

  const removeGrant = useCallback(async (g: ModuleAccess) => {
    setError('');
    setBusy(g.id);
    const { error: err } = await supabase.from('module_access').delete().eq('id', g.id);
    if (err) setError('تعذر حذف الصلاحية — تأكد من تشغيل الترحيل 0024');
    await reload();
    setBusy(null);
  }, [supabase, reload]);

  const hideAll = useCallback(async (m: AppModule) => {
    if (!confirm(`إخفاء وحدة «${m.label}» عن جميع الخدام؟ ستبقى ظاهرة لك فقط.`)) return;
    setError('');
    setBusy(m.key);
    const { error: err } = await supabase.from('module_access').delete().eq('module_key', m.key);
    if (err) setError('تعذر الحذف — تأكد من تشغيل الترحيل 0024');
    await reload();
    setBusy(null);
  }, [supabase, reload]);

  const showAll = useCallback(async (m: AppModule) => {
    setError('');
    setBusy(m.key);
    // one global grant replaces every narrower one
    await supabase.from('module_access').delete().eq('module_key', m.key);
    const { error: err } = await supabase.from('module_access').insert({
      module_key: m.key, church_id: null, service_id: null, class_id: null, created_by: profile?.id,
    });
    if (err) setError('تعذر الحفظ — تأكد من تشغيل الترحيل 0024');
    await reload();
    setBusy(null);
  }, [supabase, reload, profile?.id]);

  return (
    <AppShell>
      <OwnerGate>
        <section className="mb-4 flex items-center gap-2">
          <Link href="/owner" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Layers className="h-5 w-5 text-primary-600" />
            صلاحيات الوحدات
            <span className="badge bg-primary-100 text-primary-700">{MODULES.length}</span>
          </h2>
        </section>

        <p className="mb-4 rounded-2xl bg-indigo-50 px-4 py-3 text-xs font-bold text-indigo-700">
          كل صلاحية تربط وحدة بنطاق: كنيسة ← خدمة ← فصل (أي مستوى يمكن أن يكون «الكل»).
          يرى الخادم الوحدة إذا تقاطع نطاقه مع أي صلاحية. وحدة بلا صلاحيات لا تظهر إلا لك.
        </p>

        {error && (
          <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
        ) : (
          <ul className="space-y-4">
            {MODULES.map((m) => {
              const list = byModule.get(m.key) ?? [];
              const Icon = m.icon;
              const global = list.some((g) => g.church_id === null);
              return (
                <li key={m.key} id={`module-${m.key}`} className="card !p-0 overflow-hidden">
                  {/* module header */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-indigo-50">
                    <span className="rounded-xl bg-slate-50 p-2"><Icon className={`h-5 w-5 ${m.color}`} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-sm">{m.label}</p>
                      <p className="text-xs text-slate-400 truncate">{m.desc}</p>
                    </div>
                    {list.length === 0 ? (
                      <span className="badge bg-slate-100 text-slate-500 flex items-center gap-1">
                        <EyeOff className="h-3 w-3" /> مخفية
                      </span>
                    ) : global ? (
                      <span className="badge bg-emerald-100 text-emerald-700 flex items-center gap-1">
                        <Globe className="h-3 w-3" /> للجميع
                      </span>
                    ) : (
                      <span className="badge bg-primary-100 text-primary-700 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> {list.length} نطاق
                      </span>
                    )}
                  </div>

                  {/* grants */}
                  {list.length === 0 ? (
                    <p className="px-4 py-4 text-center text-xs font-bold text-slate-400">
                      لا توجد صلاحيات — الوحدة لا تظهر إلا لمالك التطبيق
                    </p>
                  ) : (
                    <ul className="divide-y divide-indigo-50">
                      {list.map((g) => {
                        const SIcon = ScopeIcon(g);
                        return (
                          <li key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                            <SIcon className="h-4 w-4 shrink-0 text-slate-400" />
                            <span className="flex-1 min-w-0 truncate text-sm font-bold text-slate-700">{scopeLabel(g)}</span>
                            <button
                              onClick={() => removeGrant(g)}
                              disabled={busy === g.id}
                              aria-label="حذف الصلاحية"
                              className="rounded-xl bg-red-50 p-2 text-red-600 hover:bg-red-100 transition disabled:opacity-50"
                            >
                              {busy === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* actions */}
                  <div className="flex flex-wrap gap-2 px-4 py-3 bg-slate-50/60">
                    <button
                      id={`module-${m.key}-add`}
                      onClick={() => setAdding(m)}
                      className="btn-primary !py-2 !px-3 flex items-center gap-1 text-xs"
                    >
                      <Plus className="h-4 w-4" /> إضافة نطاق
                    </button>
                    {!global && (
                      <button
                        onClick={() => showAll(m)}
                        disabled={busy === m.key}
                        className="btn-secondary !py-2 !px-3 flex items-center gap-1 text-xs"
                      >
                        <Eye className="h-4 w-4" /> إظهار للجميع
                      </button>
                    )}
                    {list.length > 0 && (
                      <button
                        onClick={() => hideAll(m)}
                        disabled={busy === m.key}
                        className="mr-auto rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100 transition flex items-center gap-1"
                      >
                        <EyeOff className="h-4 w-4" /> إخفاء عن الجميع
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {adding && (
          <AddGrantModal
            module={adding}
            churches={churches}
            services={services}
            classes={classes}
            existing={byModule.get(adding.key) ?? []}
            onClose={() => setAdding(null)}
            onSaved={async () => { setAdding(null); await reload(); }}
          />
        )}
      </OwnerGate>
    </AppShell>
  );
}

// ---------- Add grant modal: church → service → class, each may be ALL ----------
function AddGrantModal({
  module, churches, services, classes, existing, onClose, onSaved,
}: {
  module: AppModule;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  existing: ModuleAccess[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const [churchId, setChurchId] = useState<string>('');
  const [serviceId, setServiceId] = useState<string>('');
  const [classId, setClassId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredServices = services.filter((s) => s.church_id === churchId);
  const filteredClasses = classes.filter((c) => c.service_id === serviceId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const row = {
      module_key: module.key,
      church_id: churchId === ALL ? null : churchId,
      service_id: churchId === ALL || serviceId === ALL ? null : serviceId,
      class_id: churchId === ALL || serviceId === ALL || classId === ALL ? null : classId,
      created_by: profile?.id,
    };
    if (!row.church_id && churchId !== ALL) { setError('اختر الكنيسة'); return; }
    if (row.church_id && !row.service_id && serviceId !== ALL) { setError('اختر الخدمة'); return; }
    if (row.service_id && !row.class_id && classId !== ALL) { setError('اختر الفصل'); return; }

    const dup = existing.some(
      (g) => g.church_id === row.church_id && g.service_id === row.service_id && g.class_id === row.class_id
    );
    if (dup) { setError('هذه الصلاحية موجودة بالفعل'); return; }

    setSaving(true);
    const { error: err } = await supabase.from('module_access').insert(row);
    if (err) {
      setError(err.code === '23505' ? 'هذه الصلاحية موجودة بالفعل' : 'تعذر الحفظ — تأكد من تشغيل الترحيل 0024');
      setSaving(false);
      return;
    }
    onSaved();
  };

  const Icon = module.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">
            <Icon className={`h-5 w-5 ${module.color}`} />
            إضافة نطاق — {module.label}
          </h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
            <select
              id="grant-church"
              className="input-field"
              value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}
              required
            >
              <option value="">اختر الكنيسة</option>
              <option value={ALL}>✳ كل الكنائس</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {churchId && churchId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
              <select
                id="grant-service"
                className="input-field"
                value={serviceId}
                onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}
                required
              >
                <option value="">اختر الخدمة</option>
                <option value={ALL}>✳ كل الخدمات</option>
                {filteredServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {churchId !== ALL && serviceId && serviceId !== ALL && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الفصل *</label>
              <select
                id="grant-class"
                className="input-field"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                required
              >
                <option value="">اختر الفصل</option>
                <option value={ALL}>✳ كل الفصول</option>
                {filteredClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {error && <p className="text-xs font-bold text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">إلغاء</button>
            <button id="grant-save" type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              إضافة
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
