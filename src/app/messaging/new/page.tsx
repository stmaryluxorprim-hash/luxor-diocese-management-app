'use client';

// ---------- NEW CONVERSATION (محادثة جديدة) ----------
// Three modes: مخدوم (direct two-way chat with a child, picked from scope) ·
// خادم (private staff chat) · مجموعة (group of children in a scope, one-way
// announcement or two-way discussion, with optional first message).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, MessageSquareText, ShieldCheck, Megaphone, Users, ChevronLeft, Info } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { MsgHeader, Segmented, Toast, ConvAvatar } from '@/components/messaging/MessagingBits';
import { ScopeSelectors, useScopeState, useStoreLookups } from '@/components/store/StoreBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { fetchEnrollmentsPage } from '@/lib/queries';
import { openDirect, openStaff, createGroup, previewAudience, messagingErrorMessage } from '@/lib/messaging';
import type { EnrollmentWithPerson, Profile } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/types';
import type { ConversationMode } from '@/lib/messaging-types';

type Mode = 'direct' | 'staff' | 'group';

export default function NewConversationPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useStoreLookups(supabase, approved);
  const scope = useScopeState();

  const [mode, setMode] = useState<Mode>('direct');
  const [search, setSearch] = useState('');
  const [kids, setKids] = useState<EnrollmentWithPerson[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  // group form
  const [subject, setSubject] = useState('');
  const [gMode, setGMode] = useState<ConversationMode>('one_way');
  const [first, setFirst] = useState('');
  const [members, setMembers] = useState<number | null>(null);

  const loadKids = useCallback(async () => {
    setLoading(true);
    try {
      const { rows } = await fetchEnrollmentsPage(supabase, { church: scope.church, service: scope.service, class: scope.class }, { page: 0, pageSize: 60, search });
      setKids(rows);
    } catch { setKids([]); } finally { setLoading(false); }
  }, [supabase, scope.church, scope.service, scope.class, search]);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('profiles').select('*').eq('status', 'approved').neq('id', profile?.id ?? '').order('role').order('full_name').limit(300);
      setStaff((data ?? []) as Profile[]);
    } catch { setStaff([]); } finally { setLoading(false); }
  }, [supabase, profile?.id]);

  useEffect(() => { if (!approved) return; if (mode === 'direct') { const t = setTimeout(loadKids, 250); return () => clearTimeout(t); } }, [approved, mode, loadKids]);
  useEffect(() => { if (approved && mode === 'staff') loadStaff(); }, [approved, mode, loadStaff]);
  useEffect(() => {
    if (!approved || mode !== 'group') return;
    setMembers(null);
    previewAudience(supabase, { church: scope.church, service: scope.service, class: scope.class }, 'children')
      .then((p) => setMembers(p.children_count)).catch(() => setMembers(null));
  }, [approved, mode, supabase, scope.church, scope.service, scope.class]);

  const visibleStaff = useMemo(() => {
    const s = search.trim().toLowerCase();
    return staff.filter((p) => !s || p.full_name.toLowerCase().includes(s) || p.phone.includes(s));
  }, [staff, search]);

  const go = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try { const id = await fn(); router.push(`/messaging/chat/${id}`); }
    catch (e) { flash(messagingErrorMessage(e, 'تعذر فتح المحادثة')); setBusy(null); }
  };

  const makeGroup = async () => {
    if (!subject.trim()) { flash('اكتب اسم المجموعة'); return; }
    setBusy('group');
    try {
      const r = await createGroup(supabase, { subject: subject.trim(), mode: gMode, scope: { church: scope.church, service: scope.service, class: scope.class }, firstMessage: first.trim() || null });
      router.push(`/messaging/chat/${r.id}`);
    } catch (e) { flash(messagingErrorMessage(e, 'تعذر إنشاء المجموعة')); setBusy(null); }
  };

  return (
    <AppShell>
      <MsgHeader title="محادثة جديدة" />
      <Segmented<Mode>
        value={mode} onChange={(m) => { setMode(m); setSearch(''); }} className="mb-3"
        options={[
          { value: 'direct', label: 'مخدوم', icon: MessageSquareText },
          { value: 'staff', label: 'خادم', icon: ShieldCheck },
          { value: 'group', label: 'مجموعة', icon: Users },
        ]}
      />

      {mode !== 'staff' && <ScopeSelectors idPrefix="newconv" scope={scope} churches={churches} services={services} classes={classes} />}

      {mode !== 'group' && (
        <div className="relative mb-3">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input id="newconv-search" className="input-field pr-9" placeholder={mode === 'direct' ? 'ابحث باسم المخدوم أو الهاتف…' : 'ابحث باسم الخادم…'} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      {mode === 'direct' && (
        <section id="newconv-kids">
          <p className="mb-2 flex items-start gap-2 rounded-2xl bg-sky-50 px-3 py-2 text-[11px] font-bold text-sky-800">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> محادثة خاصة بين المخدوم وخدام فصله — يراها المخدوم في بوابته ويمكنه الرد إن كانت الردود مفعّلة.
          </p>
          {loading ? <p className="py-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></p>
          : kids.length === 0 ? <p className="card py-8 text-center text-sm font-bold text-slate-400">لا يوجد مخدومون في هذا النطاق</p>
          : (
            <ul className="space-y-1.5">
              {kids.map((e) => (
                <li key={e.id}>
                  <button type="button" disabled={!!busy} onClick={() => go(e.id, () => openDirect(supabase, e.id))}
                    className="card flex w-full items-center gap-3 !p-3 text-right transition hover:shadow-md disabled:opacity-60">
                    <ConvAvatar kind="direct" title={e.person.name} url={e.person.image_url} size={42} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold">{e.person.name}</span>
                      <span className="block truncate text-[11px] font-bold text-slate-400">{classes.find((c) => c.id === e.class_id)?.name ?? ''}{e.person.phone ? ` · ${e.person.phone}` : ''}</span>
                    </span>
                    {busy === e.id ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <ChevronLeft className="h-4 w-4 text-slate-300" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {mode === 'staff' && (
        <section id="newconv-staff">
          {loading ? <p className="py-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></p>
          : visibleStaff.length === 0 ? <p className="card py-8 text-center text-sm font-bold text-slate-400">لا يوجد خدام</p>
          : (
            <ul className="space-y-1.5">
              {visibleStaff.map((p) => (
                <li key={p.id}>
                  <button type="button" disabled={!!busy} onClick={() => go(p.id, () => openStaff(supabase, p.id))}
                    className="card flex w-full items-center gap-3 !p-3 text-right transition hover:shadow-md disabled:opacity-60">
                    <ConvAvatar kind="direct" title={p.full_name} url={p.photo_url} size={42} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold">{p.full_name}</span>
                      <span className="block truncate text-[11px] font-bold text-slate-400">{ROLE_LABELS[p.role]}{p.class_id ? ` · ${classes.find((c) => c.id === p.class_id)?.name ?? ''}` : p.service_id ? ` · ${services.find((s) => s.id === p.service_id)?.name ?? ''}` : ''}</span>
                    </span>
                    {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <ChevronLeft className="h-4 w-4 text-slate-300" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {mode === 'group' && (
        <section id="newconv-group" className="card space-y-3">
          <div>
            <label htmlFor="grp-subject" className="mb-1 block text-xs font-bold text-slate-600">اسم المجموعة</label>
            <input id="grp-subject" className="input-field" placeholder="مثال: إعلانات فصل رابعة" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <p className="mb-1 text-xs font-bold text-slate-600">نوع المجموعة</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['one_way', 'إعلانات فقط', 'الخدام يكتبون والمخدومون يقرؤون', Megaphone, 'border-amber-300 bg-amber-50 ring-2 ring-amber-200', 'text-amber-600'],
                ['two_way', 'نقاش مفتوح', 'الجميع يمكنه الكتابة', Users, 'border-emerald-300 bg-emerald-50 ring-2 ring-emerald-200', 'text-emerald-600'],
              ] as const).map(([v, l, d, Icon, onCls, iconCls]) => (
                <button key={v} type="button" onClick={() => setGMode(v)} aria-pressed={gMode === v}
                  className={`rounded-2xl border p-3 text-right transition ${gMode === v ? onCls : 'border-slate-200 bg-white'}`}>
                  <Icon className={`mb-1 h-5 w-5 ${gMode === v ? iconCls : 'text-slate-400'}`} />
                  <p className="text-sm font-extrabold">{l}</p>
                  <p className="text-[11px] font-bold text-slate-400">{d}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="grp-first" className="mb-1 block text-xs font-bold text-slate-600">أول رسالة (اختياري)</label>
            <textarea id="grp-first" rows={3} className="input-field resize-none" placeholder="تصل لكل الأعضاء كإشعار فوراً…" value={first} onChange={(e) => setFirst(e.target.value)} />
          </div>
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
            الأعضاء: {members === null ? '…' : `${members} مخدوم`} في النطاق المحدد
          </p>
          <button id="grp-create" type="button" onClick={makeGroup} disabled={busy === 'group' || !subject.trim() || members === 0}
            className="btn-primary flex w-full items-center justify-center gap-2 !from-emerald-600 !to-teal-500">
            {busy === 'group' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} إنشاء المجموعة
          </button>
        </section>
      )}

      <Toast msg={toast} />
    </AppShell>
  );
}
