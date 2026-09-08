'use client';

// ---------- Automation editor (محرر الرسالة التلقائية) ----------
// Full-screen sheet: preset picker (new) → trigger + config → audience (scope
// + filters) → message (title/body/[vars]/kind/link) with live server preview
// → channels & behaviour (quiet hours, cooldown, active) → save.

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Save, Eye, Sparkles, Zap, ChevronRight } from 'lucide-react';
import { ChannelChips, VarChips, KindIcon } from '@/components/messaging/MessagingBits';
import { ScopeSelectors, useStoreLookups, type ScopeState } from '@/components/store/StoreBits';
import { createClient } from '@/lib/supabase/client';
import { ALL } from '@/lib/queries';
import { saveAutomation, previewTemplate, renderPreview, SAMPLE_CHILD_CTX, messagingErrorMessage } from '@/lib/messaging';
import { AUTOMATION_PRESETS, emptyAutomation } from '@/lib/messaging-presets';
import { TRIGGER_META, KIND_META, CHILD_VARS, SERVANT_VARS, WEEKDAYS_AR } from '@/lib/messaging-meta';
import type { Automation, AutomationInput, AutomationTrigger, Audience, NotificationKind, TriggerConfig } from '@/lib/messaging-types';
import type { Profile } from '@/lib/types';

const TRIGGERS = Object.keys(TRIGGER_META) as AutomationTrigger[];
const KINDS = Object.keys(KIND_META) as NotificationKind[];

function useEditorScope(input: AutomationInput, set: (p: Partial<AutomationInput>) => void): ScopeState {
  return {
    church: input.church_id ?? ALL, service: input.service_id ?? ALL, class: input.class_id ?? ALL,
    setChurch: (v) => set({ church_id: v === ALL ? null : v, service_id: null, class_id: null }),
    setService: (v) => set({ service_id: v === ALL ? null : v, class_id: null }),
    setClass: (v) => set({ class_id: v === ALL ? null : v }),
  };
}

export default function AutomationEditor({ existing, profile, onClose, onSaved }: {
  existing: Automation | null; profile: Profile | null; onClose: () => void; onSaved: (a: Automation, created: boolean) => void;
}) {
  const [supabase] = useState(() => createClient());
  const isOwner = profile?.role === 'owner';
  const [step, setStep] = useState<'preset' | 'form'>(existing ? 'form' : 'preset');
  const [input, setInput] = useState<AutomationInput>(() => existing
    ? { ...existing }
    : emptyAutomation(profile?.church_id ?? null));
  const set = (p: Partial<AutomationInput>) => setInput((x) => ({ ...x, ...p }));
  const setCfg = (p: Partial<TriggerConfig>) => setInput((x) => ({ ...x, trigger_config: { ...x.trigger_config, ...p } }));
  const scope = useEditorScope(input, set);
  const { churches, services, classes } = useStoreLookups(supabase, true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [sample, setSample] = useState<{ title: string | null; body: string; sample: string | null } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // lock scope to the servant's own when not owner
  useEffect(() => {
    if (!profile || isOwner) return;
    setInput((x) => ({
      ...x,
      church_id: profile.church_id,
      service_id: x.service_id ?? profile.service_id,
      class_id: x.class_id ?? profile.class_id,
    }));
  }, [profile, isOwner]);

  useEffect(() => {
    if (!input.body.trim()) { setSample(null); return; }
    const t = setTimeout(() => previewTemplate(supabase, input.title || null, input.body, null).then(setSample).catch(() => setSample(null)), 400);
    return () => clearTimeout(t);
  }, [supabase, input.title, input.body]);

  const meta = TRIGGER_META[input.trigger];
  const vars = useMemo(() => [...(input.audience === 'servants' ? SERVANT_VARS : CHILD_VARS), ...meta.vars], [input.audience, meta]);
  const cfg = input.trigger_config;

  const insertVar = (token: string) => {
    const el = bodyRef.current; const b = input.body;
    if (!el) { set({ body: b + token }); return; }
    const s = el.selectionStart ?? b.length, e = el.selectionEnd ?? b.length;
    set({ body: b.slice(0, s) + token + b.slice(e) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };

  const save = async () => {
    setErr('');
    if (!input.name.trim()) { setErr('اكتب اسماً للرسالة التلقائية'); return; }
    if (!input.body.trim()) { setErr('اكتب نص الرسالة'); return; }
    if (!input.channels.length) { setErr('اختر قناة واحدة على الأقل'); return; }
    if (!isOwner && !input.church_id) { setErr('اختر الكنيسة'); return; }
    setSaving(true);
    try {
      const a = await saveAutomation(supabase, { ...input, name: input.name.trim(), body: input.body.trim(), title: input.title?.trim() || null }, existing?.id);
      onSaved(a, !existing);
    } catch (e) { setErr(messagingErrorMessage(e, 'تعذر الحفظ')); }
    finally { setSaving(false); }
  };

  const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
    <div>
      <p className="mb-1 text-xs font-bold text-slate-600">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[10px] font-bold text-slate-400">{hint}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-50" role="dialog" aria-modal="true" aria-label="الرسالة التلقائية">
      <header className="flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-3">
        <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        <h2 className="flex-1 text-base font-extrabold">{existing ? 'تعديل رسالة تلقائية' : step === 'preset' ? 'رسالة تلقائية جديدة' : 'إعداد الرسالة التلقائية'}</h2>
        {step === 'form' && (
          <button id="auto-save" type="button" onClick={save} disabled={saving} className="btn-primary flex items-center gap-1.5 !px-3 !py-2 text-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {step === 'preset' ? (
          <section className="mx-auto max-w-lg space-y-2">
            <p className="mb-3 text-xs font-bold text-slate-500">ابدأ من وصفة جاهزة ثم عدّل ما تريد، أو أنشئ من الصفر.</p>
            {AUTOMATION_PRESETS.map((p) => {
              const Icon = p.icon;
              return (
                <button key={p.key} type="button" onClick={() => { setInput({ ...p.build(isOwner ? null : profile?.church_id ?? null), service_id: isOwner ? null : profile?.service_id ?? null, class_id: isOwner ? null : profile?.class_id ?? null }); setStep('form'); }}
                  className="card flex w-full items-center gap-3 !p-3 text-right transition hover:shadow-md">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${p.color}`}><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold">{p.title}</span>
                    <span className="block text-[11px] font-bold text-slate-400">{p.desc}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 rotate-180 text-slate-300" />
                </button>
              );
            })}
            <button type="button" onClick={() => setStep('form')} className="btn-secondary mt-2 flex w-full items-center justify-center gap-2"><Sparkles className="h-4 w-4" /> إنشاء من الصفر</button>
          </section>
        ) : (
          <section className="mx-auto max-w-lg space-y-4">
            {err && <p className="rounded-2xl bg-red-50 px-4 py-2 text-xs font-bold text-red-700">{err}</p>}

            <div className="card space-y-3">
              <Field label="اسم الرسالة التلقائية">
                <input id="auto-name" className="input-field" value={input.name} onChange={(e) => set({ name: e.target.value })} placeholder="مثال: تهنئة عيد ميلاد" />
              </Field>
              <label className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-amber-500" /> مفعّلة</span>
                <input type="checkbox" checked={input.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
              </label>
            </div>

            {/* trigger */}
            <div className="card space-y-3">
              <h3 className="text-sm font-extrabold">متى تُرسل؟</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {TRIGGERS.map((t) => {
                  const m = TRIGGER_META[t]; const Icon = m.icon; const on = input.trigger === t;
                  return (
                    <button key={t} type="button" onClick={() => set({ trigger: t, trigger_config: t === 'birthday' ? { at: '09:00', days_before: 0 } : t === 'schedule' ? { at: '09:00', repeat: 'weekly', weekdays: [5] } : t === 'absent' ? { consecutive: 1, hours_after: 3 } : t === 'inactive' ? { at: '10:00', days: 30 } : t === 'event_reminder' ? { minutes_before: 60 } : t === 'points' ? { direction: 'any', min_abs: 1 } : { only: 'any' } })}
                      aria-pressed={on} className={`flex items-center gap-2 rounded-2xl border p-2 text-right ${on ? 'border-sky-300 bg-sky-50 ring-2 ring-sky-200' : 'border-slate-200 bg-white'}`}>
                      <Icon className={`h-4 w-4 shrink-0 ${on ? 'text-sky-700' : m.color}`} />
                      <span className="truncate text-xs font-bold">{m.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">{meta.desc}</p>

              {/* trigger config */}
              <div className="grid grid-cols-2 gap-2">
                {meta.timeBased && input.trigger !== 'event_reminder' && (
                  <Field label="الساعة (القاهرة)"><input type="time" className="input-field" value={cfg.at ?? '09:00'} onChange={(e) => setCfg({ at: e.target.value })} /></Field>
                )}
                {input.trigger === 'birthday' && (
                  <Field label="قبل العيد بـ (أيام)"><input type="number" min={0} max={30} className="input-field" value={cfg.days_before ?? 0} onChange={(e) => setCfg({ days_before: +e.target.value })} /></Field>
                )}
                {input.trigger === 'schedule' && (
                  <>
                    <Field label="التكرار">
                      <select className="input-field" value={cfg.repeat ?? 'once'} onChange={(e) => setCfg({ repeat: e.target.value as TriggerConfig['repeat'] })}>
                        <option value="once">مرة واحدة</option><option value="daily">يومياً</option><option value="weekly">أسبوعياً</option><option value="monthly">شهرياً</option>
                      </select>
                    </Field>
                    {(cfg.repeat ?? 'once') === 'once' && <Field label="التاريخ"><input type="date" className="input-field" value={cfg.date ?? ''} onChange={(e) => setCfg({ date: e.target.value })} /></Field>}
                    {cfg.repeat === 'monthly' && <Field label="يوم الشهر"><input type="number" min={1} max={31} className="input-field" value={cfg.day_of_month ?? 1} onChange={(e) => setCfg({ day_of_month: +e.target.value })} /></Field>}
                    {cfg.repeat === 'weekly' && (
                      <div className="col-span-2">
                        <p className="mb-1 text-xs font-bold text-slate-600">أيام الأسبوع</p>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAYS_AR.map((d, i) => {
                            const on = (cfg.weekdays ?? []).includes(i);
                            return <button key={d} type="button" aria-pressed={on} onClick={() => setCfg({ weekdays: on ? (cfg.weekdays ?? []).filter((x) => x !== i) : [...(cfg.weekdays ?? []), i] })}
                              className={`rounded-full px-3 py-1 text-[11px] font-bold ${on ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{d}</button>;
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {input.trigger === 'absent' && (
                  <>
                    <Field label="مرات غياب متتالية"><input type="number" min={1} max={20} className="input-field" value={cfg.consecutive ?? 1} onChange={(e) => setCfg({ consecutive: +e.target.value })} /></Field>
                    <Field label="بعد انتهاء المناسبة بـ (ساعات)"><input type="number" min={0} max={72} className="input-field" value={cfg.hours_after ?? 3} onChange={(e) => setCfg({ hours_after: +e.target.value })} /></Field>
                  </>
                )}
                {input.trigger === 'inactive' && (
                  <Field label="أيام بدون حضور"><input type="number" min={7} max={365} className="input-field" value={cfg.days ?? 30} onChange={(e) => setCfg({ days: +e.target.value })} /></Field>
                )}
                {input.trigger === 'event_reminder' && (
                  <Field label="قبل المناسبة بـ (دقائق)"><input type="number" min={5} max={2880} className="input-field" value={cfg.minutes_before ?? 60} onChange={(e) => setCfg({ minutes_before: +e.target.value })} /></Field>
                )}
                {input.trigger === 'points' && (
                  <>
                    <Field label="الاتجاه">
                      <select className="input-field" value={cfg.direction ?? 'any'} onChange={(e) => setCfg({ direction: e.target.value as TriggerConfig['direction'] })}>
                        <option value="any">أي تغيير</option><option value="add">إضافة فقط</option><option value="subtract">خصم فقط</option>
                      </select>
                    </Field>
                    <Field label="هدف كل (نقطة)" hint="اتركه فارغاً للإرسال عند كل تغيير"><input type="number" min={0} className="input-field" value={cfg.milestone ?? ''} onChange={(e) => setCfg({ milestone: e.target.value === '' ? undefined : +e.target.value })} placeholder="100" /></Field>
                  </>
                )}
                {(input.trigger === 'exam_result' || input.trigger === 'data_request') && (
                  <Field label="فقط عند">
                    <select className="input-field" value={cfg.only ?? 'any'} onChange={(e) => setCfg({ only: e.target.value as TriggerConfig['only'] })}>
                      <option value="any">الكل</option>
                      {input.trigger === 'exam_result' ? <><option value="passed">النجاح</option><option value="failed">عدم النجاح</option></> : <><option value="approved">الموافقة</option><option value="rejected">الرفض</option></>}
                    </select>
                  </Field>
                )}
              </div>
            </div>

            {/* audience */}
            <div className="card space-y-3">
              <h3 className="text-sm font-extrabold">لمن؟</h3>
              <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
                {(['children', 'servants', 'both'] as Audience[]).map((a) => (
                  <button key={a} type="button" onClick={() => set({ audience: a, channels: a === 'servants' ? input.channels.filter((c) => c !== 'chat') : input.channels })}
                    className={`flex-1 rounded-xl px-2 py-2 text-xs font-bold ${input.audience === a ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500'}`}>
                    {a === 'children' ? 'المخدومون' : a === 'servants' ? 'الخدام' : 'الجميع'}
                  </button>
                ))}
              </div>
              <p className="text-[11px] font-bold text-slate-400">{input.audience === 'servants' ? 'يستلم الخدام إشعاراً عن المخدوم/الحدث (مع اسم المخدوم كمتغير).' : 'يستلم المخدوم الرسالة في بوابته.'}</p>
              {isOwner ? <ScopeSelectors idPrefix="auto" scope={scope} churches={churches} services={services} classes={classes} />
                : <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">النطاق: {[classes.find((c) => c.id === input.class_id)?.name, services.find((s) => s.id === input.service_id)?.name, churches.find((c) => c.id === input.church_id)?.name].filter(Boolean).join(' · ') || 'نطاقك'}</p>}
              {input.audience !== 'servants' && (
                <div className="flex flex-wrap gap-2">
                  <select aria-label="النوع" className="input-field !w-auto !py-1.5 text-xs" value={input.audience_filter.gender ?? ''} onChange={(e) => set({ audience_filter: { ...input.audience_filter, gender: e.target.value as '' | 'male' | 'female' } })}>
                    <option value="">كل الأنواع</option><option value="male">ذكور</option><option value="female">إناث</option>
                  </select>
                  <input aria-label="من سن" type="number" className="input-field !w-24 !py-1.5 text-xs" placeholder="من سن" value={input.audience_filter.min_age ?? ''} onChange={(e) => set({ audience_filter: { ...input.audience_filter, min_age: e.target.value === '' ? '' : +e.target.value } })} />
                  <input aria-label="إلى سن" type="number" className="input-field !w-24 !py-1.5 text-xs" placeholder="إلى سن" value={input.audience_filter.max_age ?? ''} onChange={(e) => set({ audience_filter: { ...input.audience_filter, max_age: e.target.value === '' ? '' : +e.target.value } })} />
                </div>
              )}
            </div>

            {/* message */}
            <div className="card space-y-3">
              <h3 className="text-sm font-extrabold">ماذا تقول؟</h3>
              <input id="auto-title" className="input-field" placeholder="العنوان (اختياري)" value={input.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
              <textarea id="auto-body" ref={bodyRef} rows={4} className="input-field resize-none" placeholder="نص الرسالة مع المتغيرات…" value={input.body} onChange={(e) => set({ body: e.target.value })} />
              <VarChips vars={vars} onInsert={insertVar} />
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                {KINDS.map((k) => (
                  <button key={k} type="button" onClick={() => set({ kind: k })} aria-pressed={input.kind === k}
                    className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold ${input.kind === k ? `${KIND_META[k].bg} ${KIND_META[k].fg} border-transparent ring-2 ${KIND_META[k].ring}` : 'border-slate-200 text-slate-500'}`}>
                    <KindIcon kind={k} size={18} /> {KIND_META[k].label}
                  </button>
                ))}
              </div>
              <input className="input-field text-xs" dir="ltr" placeholder="رابط يفتح من الإشعار (اختياري) مثل /child/points" value={input.link ?? ''} onChange={(e) => set({ link: e.target.value })} />
              {input.body.trim() && (
                <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-3">
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-bold text-sky-600"><Eye className="h-3 w-3" /> معاينة {sample?.sample ? `(${sample.sample})` : 'بأسماء تجريبية'}</p>
                  <div className="flex items-start gap-2">
                    <KindIcon kind={input.kind} size={32} />
                    <div className="min-w-0">
                      {(sample?.title ?? input.title) && <p className="text-sm font-extrabold">{sample?.title ?? renderPreview(input.title ?? '', SAMPLE_CHILD_CTX)}</p>}
                      <p className="whitespace-pre-line text-xs text-slate-700">{sample?.body ?? renderPreview(input.body, SAMPLE_CHILD_CTX)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* channels & behaviour */}
            <div className="card space-y-3">
              <h3 className="text-sm font-extrabold">كيف تُرسل؟</h3>
              <ChannelChips value={input.channels} onChange={(v) => set({ channels: v })} allowed={input.audience === 'servants' ? ['in_app', 'whatsapp', 'sms'] : undefined} />
              <label className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                <span>احترام ساعات الهدوء</span>
                <input type="checkbox" checked={input.respect_quiet_hours} onChange={(e) => set({ respect_quiet_hours: e.target.checked })} />
              </label>
              <Field label="أقل فاصل لنفس المستلم (ساعات)" hint="0 = لا تكرار لنفس الحدث فقط. مثال: 168 = مرة أسبوعياً كحد أقصى.">
                <input type="number" min={0} className="input-field" value={input.cooldown_hours} onChange={(e) => set({ cooldown_hours: Math.max(0, +e.target.value) })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="تبدأ من"><input type="date" className="input-field" value={input.starts_at.slice(0, 10)} onChange={(e) => set({ starts_at: e.target.value ? new Date(e.target.value).toISOString() : new Date().toISOString() })} /></Field>
                <Field label="تنتهي في (اختياري)"><input type="date" className="input-field" value={input.ends_at?.slice(0, 10) ?? ''} onChange={(e) => set({ ends_at: e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : null })} /></Field>
              </div>
            </div>

            <button type="button" onClick={save} disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2 !py-3">
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />} {existing ? 'حفظ التعديلات' : 'إنشاء الرسالة التلقائية'}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
