'use client';

// ---------- Child portal — الرسائل ----------
// Conversations the child belongs to: direct chat with his class servants and
// group announcements/discussions. Optional "ابدأ محادثة" when the church
// allows children to start (child_portal_open_direct).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageSquareText, Loader2, Megaphone, Users, Plus, ShieldCheck } from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { EmptyState, PageTitle } from '@/components/child/ChildBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { fetchChildConversations, openChildDirect, childMsgError, type ChildConversation } from '@/lib/child-messaging';
import { relTime } from '@/lib/messaging';

export default function ChildMessagesPage() {
  return <ChildShell><Content /></ChildShell>;
}

function Content() {
  const { token, profile } = useChild();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<ChildConversation[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try { setRows(await fetchChildConversations(supabase, token)); setError(''); }
    catch (e) { setError(childMsgError(e, 'تعذر تحميل المحادثات')); }
  }, [supabase, token]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'child-convs', [{ table: 'messages' }, { table: 'conversations' }, { table: 'conversation_members' }], load, { enabled: !!token, delayMs: 500 });

  const hasDirect = (rows ?? []).some((c) => c.kind === 'direct');
  const mainEnrollment = profile?.enrollments[0]?.id;

  const start = async () => {
    if (!token || !mainEnrollment) return;
    setBusy(true);
    try { const id = await openChildDirect(supabase, token, mainEnrollment); router.push(`/child/messages/${id}`); }
    catch (e) { setToast(childMsgError(e)); setTimeout(() => setToast(''), 3500); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageTitle icon={<MessageSquareText className="h-5 w-5 text-sky-600" />} title="الرسائل" sub="تواصل مع خدام فصلك وتابع إعلانات المجموعات" />
      {error && <div className="card mb-3 text-center text-sm font-bold text-red-600">{error}</div>}
      {rows === null && !error && <div className="card py-10 text-center text-sm font-bold text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>}
      {rows && rows.length === 0 && <EmptyState text="لا توجد محادثات بعد — ستظهر هنا رسائل خدامك" />}
      {rows && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/child/messages/${c.id}`} className={`card flex items-center gap-3 !p-3 transition hover:shadow-md ${c.unread ? 'ring-2 ring-sky-200' : ''}`}>
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white ${c.kind === 'direct' ? 'bg-gradient-to-br from-sky-400 to-indigo-500' : c.mode === 'one_way' ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-gradient-to-br from-emerald-400 to-teal-600'}`}>
                  {c.kind === 'direct' ? <ShieldCheck className="h-6 w-6" /> : c.mode === 'one_way' ? <Megaphone className="h-6 w-6" /> : <Users className="h-6 w-6" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${c.unread ? 'font-extrabold' : 'font-bold'}`}>{c.title}</span>
                    <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{relTime(c.last_message_at)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    {!c.can_reply && <span className="shrink-0 rounded bg-amber-50 px-1.5 text-[10px] font-bold text-amber-700">للقراءة</span>}
                    <span className={`truncate ${c.unread ? 'font-bold text-slate-700' : ''}`}>{c.last_sender_type === 'child' ? 'أنت: ' : ''}{c.last_message_preview ?? 'لا توجد رسائل'}</span>
                  </span>
                </span>
                {c.unread > 0 && <span className="shrink-0 rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-extrabold text-white tabular-nums">{c.unread}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows && !hasDirect && mainEnrollment && (
        <button type="button" onClick={start} disabled={busy} className="btn-primary mt-4 flex w-full items-center justify-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} ابدأ محادثة مع خدام فصلك
        </button>
      )}
      {toast && <div role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">{toast}</div>}
    </>
  );
}
