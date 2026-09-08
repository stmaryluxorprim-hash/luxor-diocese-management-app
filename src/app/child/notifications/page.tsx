'use client';

// ---------- Child portal — الإشعارات ----------
// The child's in-app notifications (campaigns, automations, chat pings, system
// notices). Realtime refresh; tap → mark read + follow link; "تعليم الكل".

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2, ChevronLeft } from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { EmptyState, PageTitle } from '@/components/child/ChildBits';
import { KindIcon } from '@/components/messaging/MessagingBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { fetchChildNotifications, markChildNotificationsRead, childMsgError, type ChildNotification } from '@/lib/child-messaging';
import { relTime } from '@/lib/messaging';
import { KIND_META } from '@/lib/messaging-meta';

export default function ChildNotificationsPage() {
  return <ChildShell><Content /></ChildShell>;
}

function Content() {
  const { token } = useChild();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<ChildNotification[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try { setRows(await fetchChildNotifications(supabase, token, 150)); setError(''); }
    catch (e) { setError(childMsgError(e, 'تعذر تحميل الإشعارات')); }
  }, [supabase, token]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'child-notifs', [{ table: 'notifications' }], load, { enabled: !!token, delayMs: 500 });

  const unread = (rows ?? []).filter((n) => !n.read_at).length;

  const open = async (n: ChildNotification) => {
    if (!n.read_at && token) {
      setRows((xs) => (xs ?? []).map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      markChildNotificationsRead(supabase, token, [n.id]).catch(() => {});
    }
    if (n.link) router.push(n.link);
  };
  const readAll = async () => {
    if (!token) return;
    setBusy(true);
    try { await markChildNotificationsRead(supabase, token, null); await load(); } finally { setBusy(false); }
  };

  return (
    <>
      <PageTitle icon={<Bell className="h-5 w-5 text-rose-500" />} title="الإشعارات" sub="رسائل خدامك وتنبيهات النقاط والحضور والامتحانات" />
      {error && <div className="card mb-3 text-center text-sm font-bold text-red-600">{error}</div>}
      {rows === null && !error && <div className="card py-10 text-center text-sm font-bold text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>}
      {rows && rows.length === 0 && <EmptyState text="لا توجد إشعارات بعد" />}
      {rows && rows.length > 0 && (
        <>
          {unread > 0 && (
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={readAll} disabled={busy} className="flex items-center gap-1 text-xs font-bold text-sky-700">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} تعليم الكل كمقروء ({unread})
              </button>
            </div>
          )}
          <ul className="space-y-2">
            {rows.map((n) => {
              const m = KIND_META[n.kind] ?? KIND_META.info; const isUnread = !n.read_at;
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n)}
                    className={`relative flex w-full items-start gap-3 rounded-2xl border p-3 text-right transition ${isUnread ? `${m.ring} ring-2 bg-white shadow-sm border-transparent` : 'border-slate-100 bg-slate-50/60'}`}>
                    {isUnread && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />}
                    <KindIcon kind={n.kind} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-sm ${isUnread ? 'font-extrabold' : 'font-bold text-slate-700'}`}>{n.title}</span>
                        <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{relTime(n.created_at)}</span>
                      </span>
                      {n.body && <span className="mt-0.5 block whitespace-pre-line text-xs leading-relaxed text-slate-600">{n.body}</span>}
                      {n.sender_name && <span className="mt-1 block text-[10px] font-bold text-slate-400">من: {n.sender_name}</span>}
                    </span>
                    {n.link && <ChevronLeft className="mt-3 h-4 w-4 shrink-0 text-slate-300" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
