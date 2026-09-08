'use client';

// ---------- BULK SEND (رسالة جماعية) ----------
// 1) الجمهور: scope + children/servants/both + filters, live count/preview
// 2) الرسالة: template picker · title · body with [variables] · kind · live sample
// 3) القنوات: in_app / chat / whatsapp / sms · quiet-hours toggle
// → msg_send. WhatsApp/SMS recipients land in the outbound queue → link to /messaging/queue.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Users, Baby, ShieldCheck, Send, Eye, Sparkles, Info, CheckCircle2, Clock, Smartphone, ListChecks, Moon } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { MsgHeader, ChannelChips, VarChips, Segmented, Toast, KindIcon, MigrationBanner } from '@/components/messaging/MessagingBits';
import { ScopeSelectors, useScopeState, useStoreLookups } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import {
  previewAudience, sendBulk, fetchTemplates, fetchSettings, effectiveSettings, previewTemplate, renderPreview, SAMPLE_CHILD_CTX,
  isMigrationMissing, messagingErrorMessage,
} from '@/lib/messaging';
import type { Audience, AudiencePreview, AudienceFilter, Channel, MessageTemplate, NotificationKind, SendResult } from '@/lib/messaging-types';
import { KIND_META, CHILD_VARS, SERVANT_VARS, TEMPLATE_CATEGORY_LABELS } from '@/lib/messaging-meta';
import { ALL } from '@/lib/queries';

const KINDS = Object.keys(KIND_META) as NotificationKind[];

export default function BulkSendPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const scope = useScopeState();

  const [audience, setAudience] = useState<Audience>('children');
  const [filter, setFilter] = useState<AudienceFilter>({});
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [showList, setShowList] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [channels, setChannels] = useState<Channel[]>(['in_app']);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<NotificationKind>('info');
  const [respectQuiet, setRespectQuiet] = useState(true);
  const [sample, setSample] = useState<{ title: string | null; body: string; sample: string | null } | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const scopeSel = useMemo(() => ({ church: scope.church, service: scope.service, class: scope.class }), [scope.church, scope.service, scope.class]);

  useEffect(() => {
    if (!approved) return;
    Promise.all([fetchTemplates(supabase), fetchSettings(supabase)]).then(([t, s]) => {
      setTemplates(t);
      const eff = effectiveSettings(s, scope.church !== ALL ? scope.church : profile?.church_id ?? null);
      if (eff.default_channels?.length) setChannels(eff.default_channels);
    }).catch((e) => { if (isMigrationMissing(e)) setMigrationMissing(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved, supabase]);

  const loadPreview = useCallback(async () => {
    try { setPreview(await previewAudience(supabase, scopeSel, audience, filter)); }
    catch (e) { if (isMigrationMissing(e)) setMigrationMissing(true); setPreview(null); }
  }, [supabase, scopeSel, audience, filter]);
  useEffect(() => { if (approved) { const t = setTimeout(loadPreview, 300); return () => clearTimeout(t); } }, [approved, loadPreview]);

  // server-side sample render (debounced) on the first previewed child
  useEffect(() => {
    if (!approved || !body.trim()) { setSample(null); return; }
    const enr = preview?.children[0]?.enrollment_id ?? null;
    const t = setTimeout(() => previewTemplate(supabase, title || null, body, enr).then(setSample).catch(() => setSample(null)), 400);
    return () => clearTimeout(t);
  }, [approved, supabase, title, body, preview?.children]);

  const insertVar = (token: string) => {
    const el = bodyRef.current;
    if (!el) { setBody((b) => b + token); return; }
    const s = el.selectionStart ?? body.length, e = el.selectionEnd ?? body.length;
    const next = body.slice(0, s) + token + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };

  const applyTemplate = (t: MessageTemplate) => { setTitle(t.title ?? ''); setBody(t.body); flash(`تم تحميل قالب «${t.name}»`); };

  const total = (preview?.children_count ?? 0) + (preview?.servants_count ?? 0);
  const needsPhone = channels.includes('whatsapp') || channels.includes('sms');
  const canSend = body.trim().length > 0 && channels.length > 0 && total > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    if (!confirm(`إرسال الرسالة إلى ${total} مستلم عبر ${channels.length} قناة؟`)) return;
    setSending(true);
    try {
      const r = await sendBulk(supabase, { scope: scopeSel, audience, filter, channels, title: title.trim() || null, body: body.trim(), kind, respectQuiet });
      setResult(r);
    } catch (e) { flash(messagingErrorMessage(e, 'تعذر الإرسال')); }
    finally { setSending(false); }
  };

  const vars = audience === 'servants' ? SERVANT_VARS : CHILD_VARS;
  const localSample = renderPreview(body, SAMPLE_CHILD_CTX);

  if (result) {
    return (
      <AppShell>
        <MsgHeader title="تم الإرسال" />
        <section className="card text-center">
          <CheckCircle2 className="mx-auto mb-2 h-14 w-14 text-emerald-500" />
          <p className="text-lg font-extrabold">وصلت الرسالة إلى {result.sent + result.queued + result.deferred} من {result.recipients}</p>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[['أُرسلت', result.sent, 'text-emerald-600'], ['بالقائمة', result.queued, 'text-green-600'], ['مؤجلة', result.deferred, 'text-amber-600'], ['متخطاة', result.skipped, 'text-slate-400']].map(([l, v, c]) => (
              <div key={l as string} className="rounded-2xl bg-slate-50 p-2"><p className={`text-xl font-extrabold tabular-nums ${c}`}>{v as number}</p><p className="text-[10px] font-bold text-slate-400">{l}</p></div>
            ))}
          </div>
          {result.deferred > 0 && <p className="mt-3 flex items-center justify-center gap-1 text-xs font-bold text-amber-700"><Moon className="h-3.5 w-3.5" /> {result.deferred} رسالة مؤجلة لما بعد ساعات الهدوء</p>}
          <div className="mt-4 flex flex-col gap-2">
            {result.queued > 0 && (
              <Link href="/messaging/queue" className="btn-primary flex items-center justify-center gap-2 !from-green-600 !to-emerald-500">
                <Smartphone className="h-4 w-4" /> أرسل {result.queued} رسالة واتساب/SMS الآن
              </Link>
            )}
            <button type="button" onClick={() => { setResult(null); setBody(''); setTitle(''); }} className="btn-secondary">رسالة أخرى</button>
            <Link href="/messaging" className="text-xs font-bold text-slate-500">رجوع للرسائل</Link>
          </div>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <MsgHeader title="رسالة جماعية" />
      {migrationMissing && <div className="mb-3"><MigrationBanner /></div>}

      {/* 1. audience */}
      <section id="send-audience" className="card mb-3 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-extrabold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs text-white">1</span> الجمهور</h3>
        <Segmented<Audience>
          value={audience} onChange={setAudience}
          options={[{ value: 'children', label: 'المخدومون', icon: Baby }, { value: 'servants', label: 'الخدام', icon: ShieldCheck }, { value: 'both', label: 'الجميع', icon: Users }]}
        />
        <ScopeSelectors idPrefix="send" scope={scope} churches={churches} services={services} classes={classes} />
        {audience !== 'servants' && (
          <div className="flex flex-wrap gap-2">
            <select aria-label="النوع" className="input-field !w-auto !py-1.5 text-xs" value={filter.gender ?? ''} onChange={(e) => setFilter({ ...filter, gender: e.target.value as AudienceFilter['gender'] })}>
              <option value="">كل الأنواع</option><option value="male">ذكور</option><option value="female">إناث</option>
            </select>
            <input aria-label="من سن" type="number" min={0} className="input-field !w-24 !py-1.5 text-xs" placeholder="من سن" value={filter.min_age ?? ''} onChange={(e) => setFilter({ ...filter, min_age: e.target.value === '' ? '' : +e.target.value })} />
            <input aria-label="إلى سن" type="number" min={0} className="input-field !w-24 !py-1.5 text-xs" placeholder="إلى سن" value={filter.max_age ?? ''} onChange={(e) => setFilter({ ...filter, max_age: e.target.value === '' ? '' : +e.target.value })} />
            <label className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-2 text-xs font-bold text-slate-600">
              <input type="checkbox" checked={!!filter.has_phone} onChange={(e) => setFilter({ ...filter, has_phone: e.target.checked })} /> لديهم هاتف
            </label>
          </div>
        )}
        <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
          <p className="text-xs font-bold text-slate-600">
            {preview === null ? '…' : (
              <>
                <span className="text-base font-extrabold text-sky-700 tabular-nums">{total}</span> مستلم
                {audience !== 'servants' && <span className="text-slate-400"> · {preview.children_with_phone} لديهم هاتف</span>}
              </>
            )}
          </p>
          <button type="button" onClick={() => setShowList((v) => !v)} className="flex items-center gap-1 text-xs font-bold text-sky-700"><Eye className="h-3.5 w-3.5" /> {showList ? 'إخفاء' : 'عرض الأسماء'}</button>
        </div>
        {showList && preview && (
          <div className="max-h-48 overflow-y-auto rounded-2xl border border-slate-100 p-2 text-xs">
            {preview.children.map((c) => <p key={c.enrollment_id} className="flex justify-between py-0.5"><span className="font-bold">{c.name}</span><span className="text-slate-400 tabular-nums">{c.phone ?? '—'}</span></p>)}
            {preview.servants.map((s) => <p key={s.profile_id} className="flex justify-between py-0.5 text-emerald-800"><span className="font-bold">{s.name}</span><span className="text-slate-400">{s.role}</span></p>)}
          </div>
        )}
      </section>

      {/* 2. message */}
      <section id="send-message" className="card mb-3 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-extrabold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs text-white">2</span> الرسالة</h3>
        {templates.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {templates.map((t) => (
              <button key={t.id} type="button" onClick={() => applyTemplate(t)} className="shrink-0 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-bold text-violet-700">
                <Sparkles className="me-1 inline h-3 w-3" />{t.name} <span className="opacity-60">· {TEMPLATE_CATEGORY_LABELS[t.category]}</span>
              </button>
            ))}
          </div>
        )}
        <input id="send-title" className="input-field" placeholder="العنوان (اختياري)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea id="send-body" ref={bodyRef} rows={4} className="input-field resize-none" placeholder="نص الرسالة… استخدم المتغيرات مثل [الاسم الأول]" value={body} onChange={(e) => setBody(e.target.value)} />
        <VarChips vars={vars} onInsert={insertVar} />
        <div>
          <p className="mb-1 text-xs font-bold text-slate-600">نوع الإشعار</p>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold ${kind === k ? `${KIND_META[k].bg} ${KIND_META[k].fg} border-transparent ring-2 ${KIND_META[k].ring}` : 'border-slate-200 text-slate-500'}`}>
                <KindIcon kind={k} size={18} /> {KIND_META[k].label}
              </button>
            ))}
          </div>
        </div>
        {body.trim() && (
          <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-3">
            <p className="mb-1 flex items-center gap-1 text-[10px] font-bold text-sky-600"><Eye className="h-3 w-3" /> معاينة {sample?.sample ? `كما ستصل إلى ${sample.sample}` : 'بأسماء تجريبية'}</p>
            <div className="flex items-start gap-2">
              <KindIcon kind={kind} size={32} />
              <div className="min-w-0">
                {(sample?.title ?? (title ? renderPreview(title, SAMPLE_CHILD_CTX) : '')) && <p className="text-sm font-extrabold">{sample?.title ?? renderPreview(title, SAMPLE_CHILD_CTX)}</p>}
                <p className="whitespace-pre-line text-xs text-slate-700">{sample?.body ?? localSample}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 3. channels */}
      <section id="send-channels" className="card mb-3 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-extrabold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs text-white">3</span> القنوات</h3>
        <ChannelChips value={channels} onChange={setChannels} allowed={audience === 'servants' ? ['in_app', 'whatsapp', 'sms'] : undefined} />
        {needsPhone && (
          <p className="flex items-start gap-1.5 rounded-xl bg-green-50 px-3 py-2 text-[11px] font-bold text-green-800">
            <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0" /> رسائل واتساب/SMS تُجمع في قائمة الإرسال وتُرسل من هاتفك برسالة واحدة لكل مستلم (بدون تكلفة خدمة).
          </p>
        )}
        <label className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
          <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> احترام ساعات الهدوء (تأجيل الإرسال ليلاً)</span>
          <input type="checkbox" checked={respectQuiet} onChange={(e) => setRespectQuiet(e.target.checked)} />
        </label>
      </section>

      <button id="send-go" type="button" onClick={send} disabled={!canSend} className="btn-primary flex w-full items-center justify-center gap-2 !py-3 text-base">
        {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
        إرسال إلى {total} مستلم
      </button>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] font-bold text-slate-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> تُسجَّل كل رسالة جماعية كحملة في سجل الإرسال مع عدد المستلمين ونتيجة كل تسليم.</p>
      <Toast msg={toast} />
    </AppShell>
  );
}
