'use client';

// ---------- TEMPLATES & SETTINGS (القوالب والإعدادات) ----------
// Settings (owner: global / church manager: own church): children can reply /
// start, quiet hours, default channels, signature. Templates: list + editor
// (owner may create global ones; others within their scope).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Settings2, Save, Plus, Pencil, Trash2, Sparkles, Moon, MessageSquareText, Globe, Info, X } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { MsgHeader, Segmented, Toast, MigrationBanner, ChannelChips, VarChips } from '@/components/messaging/MessagingBits';
import { useStoreLookups } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import {
  fetchSettings, saveSettings, effectiveSettings, fetchTemplates, saveTemplate, deleteTemplate, isMigrationMissing, messagingErrorMessage, renderPreview, SAMPLE_CHILD_CTX,
} from '@/lib/messaging';
import { CHILD_VARS, TEMPLATE_CATEGORY_LABELS } from '@/lib/messaging-meta';
import type { MessagingSettings, MessageTemplate, TemplateCategory, Channel } from '@/lib/messaging-types';

type Tab = 'settings' | 'templates';
type TplForm = { id?: string; name: string; category: TemplateCategory; title: string; body: string; global: boolean };

export default function MessagingSettingsPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const isOwner = profile?.role === 'owner';
  const canEditSettings = isOwner || profile?.role === 'church_manager';
  const { churches } = useStoreLookups(supabase, approved);

  const [tab, setTab] = useState<Tab>('settings');
  const [rows, setRows] = useState<MessagingSettings[]>([]);
  const [churchId, setChurchId] = useState<string | null>(profile?.church_id ?? null);
  const [form, setForm] = useState<MessagingSettings | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [tpl, setTpl] = useState<TplForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([fetchSettings(supabase), fetchTemplates(supabase)]);
      setRows(s); setTemplates(t); setMigrationMissing(false);
    } catch (e) { if (isMigrationMissing(e)) setMigrationMissing(true); }
    finally { setLoading(false); }
  }, [supabase]);
  useEffect(() => { if (approved) load(); }, [approved, load]);
  useEffect(() => { if (profile && !isOwner) setChurchId(profile.church_id); }, [profile, isOwner]);
  useEffect(() => { setForm(effectiveSettings(rows, churchId)); }, [rows, churchId]);

  const hasOwnRow = useMemo(() => rows.some((r) => r.church_id === churchId), [rows, churchId]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await saveSettings(supabase, churchId, {
        children_can_reply: form.children_can_reply, children_can_start: form.children_can_start,
        quiet_hours_start: form.quiet_hours_start || null, quiet_hours_end: form.quiet_hours_end || null,
        default_channels: form.default_channels, signature: form.signature?.trim() || null,
      });
      await load(); flash('تم حفظ الإعدادات');
    } catch (e) { flash(messagingErrorMessage(e, 'تعذر الحفظ')); }
    finally { setSaving(false); }
  };

  const saveTpl = async () => {
    if (!tpl || !tpl.name.trim() || !tpl.body.trim()) { flash('اكتب اسم القالب ونصه'); return; }
    setSaving(true);
    try {
      await saveTemplate(supabase, {
        name: tpl.name.trim(), category: tpl.category, title: tpl.title.trim() || null, body: tpl.body.trim(),
        church_id: tpl.global && isOwner ? null : (profile?.church_id ?? churchId), service_id: tpl.global || isOwner ? null : profile?.service_id ?? null, class_id: tpl.global || isOwner ? null : profile?.class_id ?? null,
      }, tpl.id);
      setTpl(null); await load(); flash(tpl.id ? 'تم تحديث القالب' : 'تم إنشاء القالب');
    } catch (e) { flash(messagingErrorMessage(e, 'تعذر الحفظ')); }
    finally { setSaving(false); }
  };
  const removeTpl = async (t: MessageTemplate) => {
    if (!confirm(`حذف قالب «${t.name}»؟`)) return;
    try { await deleteTemplate(supabase, t.id); await load(); flash('تم الحذف'); }
    catch (e) { flash(messagingErrorMessage(e)); }
  };

  const grouped = useMemo(() => {
    const m = new Map<TemplateCategory, MessageTemplate[]>();
    for (const t of templates) m.set(t.category, [...(m.get(t.category) ?? []), t]);
    return [...m.entries()];
  }, [templates]);

  const Row = ({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <label className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
      <span><span className="block text-sm font-bold">{label}</span><span className="block text-[11px] text-slate-400">{desc}</span></span>
      <input type="checkbox" className="h-5 w-5" checked={checked} disabled={!canEditSettings} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );

  return (
    <AppShell>
      <MsgHeader title="القوالب والإعدادات" icon={<Settings2 className="h-5 w-5 text-violet-600" />} />
      {migrationMissing && <div className="mb-3"><MigrationBanner /></div>}
      <Segmented<Tab> value={tab} onChange={setTab} className="mb-3"
        options={[{ value: 'settings', label: 'الإعدادات', icon: Settings2 }, { value: 'templates', label: 'القوالب', icon: Sparkles, count: templates.length }]} />

      {loading || !form ? <p className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></p>
      : tab === 'settings' ? (
        <section className="space-y-3">
          {isOwner && (
            <div className="card">
              <p className="mb-1 text-xs font-bold text-slate-600">نطاق الإعدادات</p>
              <select className="input-field" value={churchId ?? ''} onChange={(e) => setChurchId(e.target.value || null)}>
                <option value="">🌐 الإعداد العام (كل الكنائس)</option>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {churchId && !hasOwnRow && <p className="mt-1 text-[10px] font-bold text-slate-400">هذه الكنيسة تستخدم الإعداد العام حالياً — الحفظ ينشئ إعداداً خاصاً بها.</p>}
            </div>
          )}
          {!canEditSettings && <p className="rounded-2xl bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500">الإعدادات للعرض فقط — يعدّلها مدير الكنيسة أو المالك.</p>}

          <div className="card space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold"><MessageSquareText className="h-4 w-4 text-sky-600" /> المخدومون</h3>
            <Row label="يمكن للمخدوم الرد" desc="في المحادثات ثنائية الاتجاه (المباشرة ومجموعات النقاش)" checked={form.children_can_reply} onChange={(v) => setForm({ ...form, children_can_reply: v })} />
            <Row label="يمكن للمخدوم بدء محادثة" desc="فتح محادثة جديدة مع خدام فصله من بوابته" checked={form.children_can_start} onChange={(v) => setForm({ ...form, children_can_start: v })} />
          </div>

          <div className="card space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold"><Moon className="h-4 w-4 text-indigo-600" /> ساعات الهدوء</h3>
            <p className="text-[11px] font-bold text-slate-400">الرسائل التلقائية والجماعية التي تحترم الهدوء تُؤجَّل لنهاية الفترة (توقيت القاهرة). اترك الحقلين فارغين للإلغاء.</p>
            <div className="grid grid-cols-2 gap-2">
              <div><p className="mb-1 text-xs font-bold text-slate-600">من</p><input type="time" className="input-field" disabled={!canEditSettings} value={form.quiet_hours_start ?? ''} onChange={(e) => setForm({ ...form, quiet_hours_start: e.target.value || null })} /></div>
              <div><p className="mb-1 text-xs font-bold text-slate-600">إلى</p><input type="time" className="input-field" disabled={!canEditSettings} value={form.quiet_hours_end ?? ''} onChange={(e) => setForm({ ...form, quiet_hours_end: e.target.value || null })} /></div>
            </div>
          </div>

          <div className="card space-y-2">
            <h3 className="text-sm font-extrabold">القنوات الافتراضية للرسالة الجماعية</h3>
            <ChannelChips value={form.default_channels} onChange={(v: Channel[]) => canEditSettings && setForm({ ...form, default_channels: v })} />
          </div>

          <div className="card space-y-2">
            <h3 className="text-sm font-extrabold">توقيع الرسائل (واتساب / SMS)</h3>
            <input className="input-field" disabled={!canEditSettings} placeholder="مثال: — خدمة مدارس الأحد، كنيسة العذراء" value={form.signature ?? ''} onChange={(e) => setForm({ ...form, signature: e.target.value })} />
          </div>

          {canEditSettings && (
            <button id="settings-save" type="button" onClick={save} disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2 !from-violet-600 !to-purple-500">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ الإعدادات
            </button>
          )}
          <p className="flex items-start gap-1.5 text-[11px] font-bold text-slate-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> إرسال واتساب و SMS يتم من هاتف الخادم عبر قائمة الإرسال — لا يحتاج أي اشتراك أو مزود خارجي.</p>
        </section>
      ) : (
        <section className="space-y-3">
          <button type="button" onClick={() => setTpl({ name: '', category: 'general', title: '', body: '', global: isOwner })} className="btn-primary flex w-full items-center justify-center gap-2 !from-violet-600 !to-purple-500">
            <Plus className="h-4 w-4" /> قالب جديد
          </button>
          {grouped.length === 0 && <p className="card py-8 text-center text-sm font-bold text-slate-400">لا توجد قوالب</p>}
          {grouped.map(([cat, list]) => (
            <div key={cat}>
              <p className="mb-1.5 text-xs font-extrabold text-slate-500">{TEMPLATE_CATEGORY_LABELS[cat]}</p>
              <ul className="space-y-1.5">
                {list.map((t) => (
                  <li key={t.id} className="card flex items-start gap-2 !p-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-extrabold">{t.church_id === null && <Globe className="h-3.5 w-3.5 text-slate-400" />}<span className="truncate">{t.name}</span></p>
                      {t.title && <p className="text-xs font-bold text-slate-600">{t.title}</p>}
                      <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-slate-500">{t.body}</p>
                    </div>
                    <button type="button" onClick={() => setTpl({ id: t.id, name: t.name, category: t.category, title: t.title ?? '', body: t.body, global: t.church_id === null })} aria-label="تعديل" className="rounded-full bg-slate-100 p-1.5 text-slate-600"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => removeTpl(t)} aria-label="حذف" className="rounded-full bg-red-50 p-1.5 text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {tpl && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 sm:rounded-3xl">
            <div className="mb-3 flex items-center justify-between"><h3 className="text-base font-extrabold">{tpl.id ? 'تعديل القالب' : 'قالب جديد'}</h3><button type="button" onClick={() => setTpl(null)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
            <div className="space-y-3">
              <input className="input-field" placeholder="اسم القالب" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />
              <select className="input-field" value={tpl.category} onChange={(e) => setTpl({ ...tpl, category: e.target.value as TemplateCategory })}>
                {(Object.keys(TEMPLATE_CATEGORY_LABELS) as TemplateCategory[]).map((c) => <option key={c} value={c}>{TEMPLATE_CATEGORY_LABELS[c]}</option>)}
              </select>
              <input className="input-field" placeholder="العنوان (اختياري)" value={tpl.title} onChange={(e) => setTpl({ ...tpl, title: e.target.value })} />
              <textarea rows={4} className="input-field resize-none" placeholder="نص القالب مع المتغيرات…" value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} />
              <VarChips vars={CHILD_VARS} onInsert={(v) => setTpl({ ...tpl, body: tpl.body + v })} />
              {tpl.body && <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">{renderPreview(tpl.body, SAMPLE_CHILD_CTX)}</p>}
              {isOwner && (
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={tpl.global} onChange={(e) => setTpl({ ...tpl, global: e.target.checked })} /> <Globe className="h-3.5 w-3.5" /> قالب عام لكل الكنائس</label>
              )}
              <button type="button" onClick={saveTpl} disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2 !from-violet-600 !to-purple-500">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
