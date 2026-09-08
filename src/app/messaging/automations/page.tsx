'use client';

// ---------- AUTOMATIONS (الرسائل التلقائية) ----------
// List of programmable rules in scope: toggle, run now (time-based), edit,
// delete; stats (runs / sent / last run). "+ جديدة" opens the editor sheet.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Zap, ZapOff, Play, Pencil, Trash2, Clock, Info, Sparkles } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { MsgHeader, Toast, MigrationBanner, fmtDateTime } from '@/components/messaging/MessagingBits';
import AutomationEditor from '@/components/messaging/AutomationEditor';
import { useStoreLookups } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { fetchAutomations, toggleAutomation, deleteAutomation, runAutomationNow, runTick, isMigrationMissing, messagingErrorMessage } from '@/lib/messaging';
import { TRIGGER_META, AUDIENCE_LABELS, CHANNEL_META, WEEKDAYS_AR } from '@/lib/messaging-meta';
import type { Automation } from '@/lib/messaging-types';

function describe(a: Automation): string {
  const c = a.trigger_config;
  switch (a.trigger) {
    case 'birthday': return `${c.days_before ? `قبل العيد بـ ${c.days_before} يوم` : 'يوم العيد'} · ${c.at ?? '09:00'}`;
    case 'schedule': {
      const r = c.repeat ?? 'once';
      const when = r === 'once' ? (c.date ?? 'مرة واحدة') : r === 'daily' ? 'يومياً' : r === 'weekly' ? `كل ${(c.weekdays ?? []).map((d) => WEEKDAYS_AR[d]).join('، ') || 'أسبوع'}` : `يوم ${c.day_of_month ?? 1} من كل شهر`;
      return `${when} · ${c.at ?? '09:00'}`;
    }
    case 'absent': return `غياب ${c.consecutive ?? 1} مرة متتالية · بعد ${c.hours_after ?? 3} س من المناسبة`;
    case 'inactive': return `بدون حضور ${c.days ?? 30} يوم · ${c.at ?? '10:00'}`;
    case 'event_reminder': return `قبل المناسبة بـ ${c.minutes_before ?? 60} دقيقة`;
    case 'points': return c.milestone ? `عند كل ${c.milestone} نقطة` : c.direction === 'add' ? 'عند إضافة نقاط' : c.direction === 'subtract' ? 'عند خصم نقاط' : 'عند أي تغيير في النقاط';
    case 'exam_result': return c.only === 'passed' ? 'عند النجاح' : c.only === 'failed' ? 'عند عدم النجاح' : 'عند أي نتيجة';
    case 'data_request': return c.only === 'approved' ? 'عند الموافقة' : c.only === 'rejected' ? 'عند الرفض' : 'عند أي قرار';
    default: return TRIGGER_META[a.trigger].desc;
  }
}

export default function AutomationsPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);

  const [rows, setRows] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; row: Automation | null }>({ open: false, row: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    try { setRows(await fetchAutomations(supabase)); setMigrationMissing(false); }
    catch (e) { if (isMigrationMissing(e)) setMigrationMissing(true); }
    finally { setLoading(false); }
  }, [supabase]);
  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, 'msg-automations', [{ table: 'message_automations' }], load, { enabled: approved, delayMs: 500 });

  const scopeOf = (a: Automation) => [
    a.class_id ? classes.find((c) => c.id === a.class_id)?.name : null,
    a.service_id ? services.find((s) => s.id === a.service_id)?.name : null,
    a.church_id ? churches.find((c) => c.id === a.church_id)?.name : 'كل الكنائس',
  ].filter(Boolean).join(' · ');

  const toggle = async (a: Automation) => {
    setBusy(a.id);
    try { await toggleAutomation(supabase, a.id, !a.is_active); await load(); flash(a.is_active ? 'تم الإيقاف' : 'تم التفعيل'); }
    catch (e) { flash(messagingErrorMessage(e)); } finally { setBusy(null); }
  };
  const remove = async (a: Automation) => {
    if (!confirm(`حذف «${a.name}»؟ لن تُحذف الرسائل التي أُرسلت بالفعل.`)) return;
    setBusy(a.id);
    try { await deleteAutomation(supabase, a.id); await load(); flash('تم الحذف'); }
    catch (e) { flash(messagingErrorMessage(e)); } finally { setBusy(null); }
  };
  const runNow = async (a: Automation) => {
    if (!confirm(`تشغيل «${a.name}» الآن على كل المستلمين المطابقين اليوم؟`)) return;
    setBusy(a.id);
    try { const r = await runAutomationNow(supabase, a.id); await load(); flash(`تم الإرسال إلى ${r.sent} من ${r.total}`); }
    catch (e) { flash(messagingErrorMessage(e)); } finally { setBusy(null); }
  };
  const tick = async () => {
    setBusy('tick');
    try { await runTick(supabase, true); await load(); flash('تم تشغيل المجدول'); }
    catch (e) { flash(messagingErrorMessage(e)); } finally { setBusy(null); }
  };

  const stats = useMemo(() => ({ active: rows.filter((r) => r.is_active).length, sent: rows.reduce((s, r) => s + r.sent_count, 0) }), [rows]);

  return (
    <AppShell>
      <MsgHeader
        title="الرسائل التلقائية" icon={<Zap className="h-5 w-5 text-amber-500" />}
        badge={<span className="badge bg-amber-100 text-amber-700 tabular-nums">{stats.active}/{rows.length}</span>}
        actions={<button id="auto-new" type="button" onClick={() => setEditor({ open: true, row: null })} className="btn-primary flex items-center gap-1.5 !from-amber-500 !to-orange-500 !px-3 !py-2 text-sm"><Plus className="h-4 w-4" /> جديدة</button>}
      />
      {migrationMissing && <div className="mb-3"><MigrationBanner /></div>}

      <p className="mb-3 flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        قواعد تعمل وحدها: عيد ميلاد، غياب، انقطاع، تذكير قبل المناسبة، ترحيب بالجديد، نقاط، نتائج الامتحانات… كل قاعدة = محفّز + جمهور + رسالة بمتغيرات + قنوات. لا تتكرر الرسالة لنفس الحدث أبداً.
      </p>

      <section className="mb-3 grid grid-cols-3 gap-2">
        {[['قاعدة', rows.length], ['مفعّلة', stats.active], ['رسالة أُرسلت', stats.sent]].map(([l, v]) => (
          <div key={l as string} className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-amber-600">{loading ? '…' : v}</p><p className="text-[10px] font-bold text-slate-400">{l}</p></div>
        ))}
      </section>

      {loading ? <p className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></p>
      : rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-10 text-center">
          <Sparkles className="h-10 w-10 text-amber-300" />
          <p className="text-sm font-bold text-slate-500">لا توجد رسائل تلقائية بعد</p>
          <p className="text-xs text-slate-400">ابدأ بوصفة جاهزة: تهنئة عيد ميلاد أو افتقاد بعد الغياب.</p>
          <button type="button" onClick={() => setEditor({ open: true, row: null })} className="btn-primary mt-1 !from-amber-500 !to-orange-500 !px-4 !py-2 text-sm">إنشاء أول قاعدة</button>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => {
            const m = TRIGGER_META[a.trigger]; const Icon = m.icon;
            return (
              <li key={a.id} className={`card !p-3 ${a.is_active ? '' : 'opacity-70'}`}>
                <div className="flex items-start gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${a.is_active ? 'bg-amber-50' : 'bg-slate-100'} ${m.color}`}><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2"><span className="truncate text-sm font-extrabold">{a.name}</span>{!a.is_active && <span className="badge bg-slate-100 text-slate-500">متوقفة</span>}</p>
                    <p className="text-[11px] font-bold text-slate-500">{m.label} · {describe(a)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">إلى {AUDIENCE_LABELS[a.audience]} · {scopeOf(a)} · {a.channels.map((c) => CHANNEL_META[c].short).join(' + ')}</p>
                    <p className="mt-1 line-clamp-2 rounded-xl bg-slate-50 px-2 py-1 text-xs text-slate-600">{a.title ? <b>{a.title} — </b> : null}{a.body}</p>
                    <p className="mt-1 flex items-center gap-1 text-[10px] font-bold text-slate-400 tabular-nums"><Clock className="h-3 w-3" /> أُرسلت {a.sent_count} · تشغيل {a.run_count} · آخر تشغيل {fmtDateTime(a.last_run_at)}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2">
                  <button type="button" onClick={() => toggle(a)} disabled={busy === a.id} className={`flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold ${a.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {a.is_active ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />} {a.is_active ? 'مفعّلة' : 'متوقفة'}
                  </button>
                  {m.timeBased && a.trigger !== 'event_reminder' && (
                    <button type="button" onClick={() => runNow(a)} disabled={busy === a.id} className="flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1 text-[11px] font-bold text-sky-700"><Play className="h-3 w-3" /> تشغيل الآن</button>
                  )}
                  <span className="flex-1" />
                  <button type="button" onClick={() => setEditor({ open: true, row: a })} aria-label="تعديل" className="rounded-full bg-slate-100 p-1.5 text-slate-600"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => remove(a)} disabled={busy === a.id} aria-label="حذف" className="rounded-full bg-red-50 p-1.5 text-red-500">{busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rows.some((r) => r.is_active && TRIGGER_META[r.trigger].timeBased) && (
        <button type="button" onClick={tick} disabled={busy === 'tick'} className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs font-bold text-slate-400">
          {busy === 'tick' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />} المجدول يعمل تلقائياً كل 5 دقائق — اضغط لتشغيله الآن
        </button>
      )}

      {editor.open && (
        <AutomationEditor existing={editor.row} profile={profile} onClose={() => setEditor({ open: false, row: null })}
          onSaved={(_, created) => { setEditor({ open: false, row: null }); load(); flash(created ? 'تم إنشاء الرسالة التلقائية' : 'تم الحفظ'); }} />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
