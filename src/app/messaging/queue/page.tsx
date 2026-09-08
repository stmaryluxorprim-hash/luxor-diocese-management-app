'use client';

// ---------- OUTBOUND QUEUE (قائمة الإرسال) ----------
// WhatsApp / SMS messages waiting to be sent from the servant's phone.
// "وضع الإرسال السريع": one big button per recipient → opens wa.me / sms:
// and marks the item sent. Also list view with per-item actions and bulk cancel.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Smartphone, MessageSquare, Check, X, RotateCcw, Zap, ChevronLeft, Inbox, Filter } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { MsgHeader, Segmented, Toast, MigrationBanner, fmtDateTime } from '@/components/messaging/MessagingBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { fetchQueue, markQueue, waLink, smsLink, isMigrationMissing, messagingErrorMessage } from '@/lib/messaging';
import type { QueueItem, QueueStatus } from '@/lib/messaging-types';

type Tab = 'pending' | 'sent' | 'failed' | 'cancelled';
const TAB_LABELS: Record<Tab, string> = { pending: 'بانتظار الإرسال', sent: 'أُرسلت', failed: 'فشلت', cancelled: 'ملغاة' };

export default function QueuePage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';

  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<Record<Tab, number>>({ pending: 0, sent: 0, failed: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [channel, setChannel] = useState<'all' | 'whatsapp' | 'sms'>('all');
  const [rapid, setRapid] = useState(false);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    try {
      const all = await fetchQueue(supabase, null, 600);
      setCounts({
        pending: all.filter((q) => q.status === 'pending').length, sent: all.filter((q) => q.status === 'sent').length,
        failed: all.filter((q) => q.status === 'failed').length, cancelled: all.filter((q) => q.status === 'cancelled').length,
      });
      setItems(all);
      setMigrationMissing(false);
    } catch (e) { if (isMigrationMissing(e)) setMigrationMissing(true); }
    finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, 'msg-queue', [{ table: 'outbound_queue' }], load, { enabled: approved, delayMs: 500 });

  const visible = useMemo(() => items.filter((q) => q.status === tab && (channel === 'all' || q.channel === channel)), [items, tab, channel]);
  const pending = useMemo(() => items.filter((q) => q.status === 'pending' && (channel === 'all' || q.channel === channel)), [items, channel]);
  const current = pending[Math.min(idx, Math.max(pending.length - 1, 0))];

  const mark = async (ids: string[], status: QueueStatus) => {
    setBusy(ids[0]);
    try { await markQueue(supabase, ids, status); await load(); }
    catch (e) { flash(messagingErrorMessage(e)); }
    finally { setBusy(null); }
  };

  const openAndMark = (q: QueueItem) => {
    const href = q.channel === 'whatsapp' ? waLink(q.phone, q.body) : smsLink(q.phone, q.body);
    window.open(href, '_blank', 'noopener');
    mark([q.id], 'sent');
  };

  const cancelAll = async () => {
    if (!pending.length || !confirm(`إلغاء ${pending.length} رسالة بانتظار الإرسال؟`)) return;
    await mark(pending.map((q) => q.id), 'cancelled');
    flash('تم الإلغاء');
  };

  const ChannelIcon = ({ c }: { c: 'whatsapp' | 'sms' }) => c === 'whatsapp'
    ? <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700"><Smartphone className="h-4 w-4" /></span>
    : <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700"><MessageSquare className="h-4 w-4" /></span>;

  return (
    <AppShell>
      <MsgHeader
        title="قائمة الإرسال" icon={<Smartphone className="h-5 w-5 text-green-600" />}
        badge={counts.pending > 0 ? <span className="badge bg-green-100 text-green-700 tabular-nums">{counts.pending}</span> : undefined}
        actions={counts.pending > 0 && !rapid ? (
          <button id="queue-rapid" type="button" onClick={() => { setIdx(0); setRapid(true); }} className="btn-primary flex items-center gap-1.5 !from-green-600 !to-emerald-500 !px-3 !py-2 text-sm">
            <Zap className="h-4 w-4" /> إرسال سريع
          </button>
        ) : undefined}
      />
      {migrationMissing && <div className="mb-3"><MigrationBanner /></div>}

      {rapid ? (
        <section id="queue-rapid-mode" className="card text-center">
          {pending.length === 0 || !current ? (
            <>
              <Check className="mx-auto mb-2 h-14 w-14 text-emerald-500" />
              <p className="text-lg font-extrabold">أرسلت كل الرسائل 🎉</p>
              <button type="button" onClick={() => setRapid(false)} className="btn-secondary mt-4">رجوع للقائمة</button>
            </>
          ) : (
            <>
              <p className="text-xs font-bold text-slate-400">{idx + 1} من {pending.length}</p>
              <div className="mx-auto my-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${((idx) / pending.length) * 100}%` }} /></div>
              <div className="mb-2 flex items-center justify-center gap-2"><ChannelIcon c={current.channel} /><p className="text-xl font-extrabold">{current.recipient_name}</p></div>
              <p className="text-sm font-bold text-slate-500 tabular-nums" dir="ltr">{current.phone}</p>
              <p className="mx-auto mt-3 max-w-sm whitespace-pre-line rounded-2xl bg-slate-50 p-3 text-right text-sm leading-relaxed text-slate-700">{current.body}</p>
              <button id="queue-send-one" type="button" onClick={() => openAndMark(current)} disabled={busy === current.id}
                className={`btn-primary mt-4 flex w-full items-center justify-center gap-2 !py-3.5 text-base ${current.channel === 'whatsapp' ? '!from-green-600 !to-emerald-500' : '!from-sky-600 !to-indigo-500'}`}>
                {busy === current.id ? <Loader2 className="h-5 w-5 animate-spin" /> : current.channel === 'whatsapp' ? <Smartphone className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
                افتح {current.channel === 'whatsapp' ? 'واتساب' : 'الرسائل'} وأرسل
              </button>
              <div className="mt-2 flex justify-center gap-3 text-xs font-bold">
                <button type="button" onClick={() => setIdx((i) => Math.min(i + 1, pending.length - 1))} className="text-slate-500">تخطي</button>
                <button type="button" onClick={() => mark([current.id], 'cancelled')} className="text-red-500">إلغاء هذه</button>
                <button type="button" onClick={() => setRapid(false)} className="text-slate-400">خروج</button>
              </div>
            </>
          )}
        </section>
      ) : (
        <>
          <Segmented<Tab> value={tab} onChange={setTab} className="mb-2"
            options={(Object.keys(TAB_LABELS) as Tab[]).map((t) => ({ value: t, label: TAB_LABELS[t], count: counts[t] }))} />
          <div className="mb-3 flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            {(['all', 'whatsapp', 'sms'] as const).map((c) => (
              <button key={c} type="button" onClick={() => setChannel(c)} className={`rounded-full px-3 py-1 text-[11px] font-bold ${channel === c ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {c === 'all' ? 'الكل' : c === 'whatsapp' ? 'واتساب' : 'SMS'}
              </button>
            ))}
            {tab === 'pending' && pending.length > 0 && <button type="button" onClick={cancelAll} className="ms-auto text-[11px] font-bold text-red-500">إلغاء الكل</button>}
          </div>

          {loading ? <p className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></p>
          : visible.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 py-10 text-center">
              <Inbox className="h-10 w-10 text-slate-300" />
              <p className="text-sm font-bold text-slate-500">لا توجد رسائل {TAB_LABELS[tab]}</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {visible.map((q) => (
                <li key={q.id} className="card flex items-start gap-3 !p-3">
                  <ChannelIcon c={q.channel} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-extrabold">{q.recipient_name}</span>
                      <span className="shrink-0 text-[10px] text-slate-400">{fmtDateTime(q.sent_at ?? q.created_at)}</span>
                    </p>
                    <p className="text-[11px] font-bold text-slate-400 tabular-nums" dir="ltr">{q.phone}</p>
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-slate-600">{q.body}</p>
                    {q.status === 'pending' && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => openAndMark(q)} className={`flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold text-white ${q.channel === 'whatsapp' ? 'bg-green-600' : 'bg-sky-600'}`}>
                          <ChevronLeft className="h-3 w-3" /> أرسل
                        </button>
                        <button type="button" onClick={() => mark([q.id], 'sent')} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600"><Check className="h-3 w-3" /> أُرسلت</button>
                        <button type="button" onClick={() => mark([q.id], 'cancelled')} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-red-500"><X className="h-3 w-3" /> إلغاء</button>
                      </div>
                    )}
                    {q.status !== 'pending' && (
                      <button type="button" onClick={() => mark([q.id], 'pending')} className="mt-2 flex items-center gap-1 text-[11px] font-bold text-sky-700"><RotateCcw className="h-3 w-3" /> إعادة للقائمة</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
