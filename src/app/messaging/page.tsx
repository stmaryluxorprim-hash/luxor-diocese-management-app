'use client';

// ---------- MESSAGING HUB (الرسائل والإشعارات) ----------
// Tabs: الإشعارات (my notifications) · المحادثات (inbox).
// Quick actions: رسالة جماعية · محادثة جديدة · الرسائل التلقائية · قائمة الإرسال · القوالب والإعدادات.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bell, MessageSquareText, Megaphone, Zap, Send, Settings2, Plus, CheckCheck, Loader2, Search, Archive, Info, ClipboardList,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { MsgHeader, NotificationCard, ConvAvatar, Segmented, Toast, MigrationBanner } from '@/components/messaging/MessagingBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import {
  fetchNotifications, markNotificationsRead, fetchInbox, fetchBadge, isMigrationMissing, messagingErrorMessage, relTime, runTick,
} from '@/lib/messaging';
import type { AppNotification, InboxRow, Badge, ConversationKind } from '@/lib/messaging-types';
import { CONV_KIND_LABELS } from '@/lib/messaging-meta';

type Tab = 'notifications' | 'chats';
type ConvFilter = 'all' | ConversationKind;

const ACTIONS = [
  { href: '/messaging/send', label: 'رسالة جماعية', desc: 'لفصل أو خدمة أو كنيسة', icon: Megaphone, tone: 'from-sky-500 to-indigo-500' },
  { href: '/messaging/new', label: 'محادثة جديدة', desc: 'مخدوم · خادم · مجموعة', icon: Plus, tone: 'from-emerald-500 to-teal-500' },
  { href: '/messaging/automations', label: 'الرسائل التلقائية', desc: 'عيد ميلاد · غياب · تذكير…', icon: Zap, tone: 'from-amber-500 to-orange-500' },
  { href: '/messaging/queue', label: 'قائمة الإرسال', desc: 'واتساب و SMS بضغطة', icon: Send, tone: 'from-green-500 to-emerald-600' },
  { href: '/messaging/log', label: 'سجل الإرسال', desc: 'الحملات والتسليمات', icon: ClipboardList, tone: 'from-slate-500 to-slate-700' },
  { href: '/messaging/settings', label: 'القوالب والإعدادات', desc: 'ساعات الهدوء · الردود', icon: Settings2, tone: 'from-violet-500 to-purple-600' },
];

export default function MessagingHubPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';

  const [tab, setTab] = useState<Tab>('notifications');
  const [notifs, setNotifs] = useState<AppNotification[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [badge, setBadge] = useState<Badge | null>(null);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [convFilter, setConvFilter] = useState<ConvFilter>('all');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    try {
      const [n, i, b] = await Promise.all([fetchNotifications(supabase, 150), fetchInbox(supabase), fetchBadge(supabase)]);
      setNotifs(n); setInbox(i); setBadge(b);
      setMigrationMissing(false);
    } catch (e) {
      if (isMigrationMissing(e)) setMigrationMissing(true);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  // opportunistic scheduler tick (throttled server-side to once/min; pg_cron does the rest)
  useEffect(() => { if (approved) runTick(supabase).catch(() => {}); }, [approved, supabase]);
  useDebouncedRealtime(
    supabase, 'messaging-hub',
    [{ table: 'notifications' }, { table: 'messages' }, { table: 'conversations' }, { table: 'outbound_queue' }],
    load, { enabled: approved, delayMs: 600 },
  );

  const unreadN = badge?.unread_notifications ?? notifs.filter((n) => !n.read_at).length;
  const unreadM = badge?.unread_messages ?? inbox.reduce((s, r) => s + r.unread, 0);

  const readAll = async () => {
    setBusy(true);
    try { await markNotificationsRead(supabase, null); await load(); flash('تم تعليم الكل كمقروء'); }
    catch (e) { flash(messagingErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const openNotif = async (n: AppNotification) => {
    if (n.read_at) return;
    setNotifs((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    markNotificationsRead(supabase, [n.id]).catch(() => {});
  };

  const visibleInbox = useMemo(() => {
    const s = search.trim().toLowerCase();
    return inbox.filter((r) =>
      (showArchived ? r.is_archived : !r.is_archived) &&
      (convFilter === 'all' || r.kind === convFilter) &&
      (!s || (r.title ?? '').toLowerCase().includes(s) || (r.last_message_preview ?? '').toLowerCase().includes(s) || (r.class_name ?? '').toLowerCase().includes(s)));
  }, [inbox, search, convFilter, showArchived]);

  const counts = useMemo(() => ({
    direct: inbox.filter((r) => r.kind === 'direct' && !r.is_archived).length,
    staff: inbox.filter((r) => r.kind === 'staff' && !r.is_archived).length,
    group: inbox.filter((r) => r.kind === 'group' && !r.is_archived).length,
  }), [inbox]);

  return (
    <AppShell>
      <MsgHeader
        back="/settings"
        badge={(unreadN + unreadM) > 0 ? <span className="badge bg-sky-100 text-sky-700 tabular-nums">{unreadN + unreadM}</span> : undefined}
        actions={
          badge && badge.pending_queue > 0 ? (
            <Link href="/messaging/queue" className="btn-primary flex items-center gap-1.5 !px-3 !py-2 text-sm !from-green-600 !to-emerald-500">
              <Send className="h-4 w-4" /> {badge.pending_queue} للإرسال
            </Link>
          ) : undefined
        }
      />

      {migrationMissing && <div className="mb-3"><MigrationBanner /></div>}

      <section id="msg-actions" className="mb-3 grid grid-cols-3 gap-2">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.href} href={a.href} className="card group !p-2.5 text-center transition hover:shadow-md">
              <span className={`mx-auto mb-1.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br ${a.tone} text-white shadow-sm transition group-hover:scale-105`}>
                <Icon className="h-5 w-5" />
              </span>
              <p className="text-xs font-extrabold leading-tight">{a.label}</p>
              <p className="mt-0.5 text-[10px] font-bold text-slate-400 leading-tight">{a.desc}</p>
            </Link>
          );
        })}
      </section>

      <Segmented<Tab>
        value={tab} onChange={setTab} className="mb-3"
        options={[
          { value: 'notifications', label: 'الإشعارات', icon: Bell, count: unreadN },
          { value: 'chats', label: 'المحادثات', icon: MessageSquareText, count: unreadM },
        ]}
      />

      {tab === 'notifications' && (
        <section id="msg-notifications">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500">{notifs.length ? `${notifs.length} إشعار` : ''}</p>
            {unreadN > 0 && (
              <button type="button" onClick={readAll} disabled={busy} className="flex items-center gap-1 text-xs font-bold text-sky-700">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} تعليم الكل كمقروء
              </button>
            )}
          </div>
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></p>
          ) : notifs.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 py-10 text-center">
              <Bell className="h-10 w-10 text-slate-300" />
              <p className="text-sm font-bold text-slate-500">لا توجد إشعارات بعد</p>
              <p className="text-xs text-slate-400">ستظهر هنا تنبيهات الرسائل التلقائية، طلبات المخدومين، وردودهم.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifs.map((n) => <NotificationCard key={n.id} n={n} onOpen={openNotif} />)}
            </div>
          )}
        </section>
      )}

      {tab === 'chats' && (
        <section id="msg-chats">
          <div className="relative mb-2">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="msg-search" className="input-field pr-9" placeholder="ابحث باسم المخدوم أو الخادم أو المجموعة…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="mb-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {([['all', 'الكل', inbox.filter((r) => !r.is_archived).length], ['direct', CONV_KIND_LABELS.direct, counts.direct], ['staff', CONV_KIND_LABELS.staff, counts.staff], ['group', CONV_KIND_LABELS.group, counts.group]] as [ConvFilter, string, number][]).map(([v, l, c]) => (
              <button key={v} type="button" onClick={() => setConvFilter(v)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${convFilter === v ? 'bg-sky-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600'}`}>
                {l} <span className="opacity-70 tabular-nums">{c}</span>
              </button>
            ))}
            <button type="button" onClick={() => setShowArchived((v) => !v)} aria-pressed={showArchived}
              className={`ms-auto shrink-0 rounded-full p-1.5 ${showArchived ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`} title="المؤرشفة">
              <Archive className="h-4 w-4" />
            </button>
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></p>
          ) : visibleInbox.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 py-10 text-center">
              <MessageSquareText className="h-10 w-10 text-slate-300" />
              <p className="text-sm font-bold text-slate-500">{showArchived ? 'لا توجد محادثات مؤرشفة' : 'لا توجد محادثات بعد'}</p>
              <Link href="/messaging/new" className="btn-primary mt-1 !px-4 !py-2 text-sm">ابدأ محادثة</Link>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {visibleInbox.map((r) => (
                <li key={r.id}>
                  <Link href={`/messaging/chat/${r.id}`} className={`card flex items-center gap-3 !p-3 transition hover:shadow-md ${r.unread ? 'ring-2 ring-sky-200' : ''}`}>
                    <ConvAvatar kind={r.kind} mode={r.mode} title={r.title} url={r.image_url} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-sm ${r.unread ? 'font-extrabold' : 'font-bold'}`}>{r.title ?? '—'}</span>
                        <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{relTime(r.last_message_at)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                        {r.kind !== 'staff' && r.class_name && <span className="shrink-0 rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-500">{r.class_name}</span>}
                        {r.kind === 'group' && <span className={`shrink-0 rounded px-1.5 text-[10px] font-bold ${r.mode === 'one_way' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{r.mode === 'one_way' ? 'إعلان' : 'نقاش'}</span>}
                        <span className={`truncate ${r.unread ? 'font-bold text-slate-700' : ''}`}>
                          {r.last_sender_type === 'child' ? '↩ ' : ''}{r.last_message_preview ?? 'لا توجد رسائل'}
                        </span>
                      </span>
                    </span>
                    {r.unread > 0 && <span className="shrink-0 rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-extrabold text-white tabular-nums">{r.unread}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="mt-4 flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-[11px] font-bold text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        الإشعارات داخل التطبيق تصل فوراً للمخدومين في بوابتهم وللخدام في الجرس. واتساب و SMS تُجمع في قائمة الإرسال وتُرسل من هاتفك بضغطة واحدة.
      </p>

      <Toast msg={toast} />
    </AppShell>
  );
}
