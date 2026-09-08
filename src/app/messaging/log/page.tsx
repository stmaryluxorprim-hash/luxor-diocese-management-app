'use client';

// ---------- SEND LOG (سجل الإرسال) ----------
// الحملات: every bulk send with counts. التسليمات: per-recipient delivery rows
// (automation / campaign) with status, channels, deferred time, error.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ClipboardList, Megaphone, Zap, Moon, Filter, Inbox } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { MsgHeader, Segmented, MigrationBanner, fmtDateTime, KindIcon } from '@/components/messaging/MessagingBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { fetchCampaigns, fetchDeliveries, fetchAutomations, isMigrationMissing } from '@/lib/messaging';
import { AUDIENCE_LABELS, CHANNEL_META } from '@/lib/messaging-meta';
import type { Campaign, Delivery, DeliveryStatus, Automation } from '@/lib/messaging-types';

type Tab = 'campaigns' | 'deliveries';
const STATUS_META: Record<DeliveryStatus, { label: string; cls: string }> = {
  sent: { label: 'أُرسلت', cls: 'bg-emerald-50 text-emerald-700' },
  queued: { label: 'بالقائمة', cls: 'bg-green-50 text-green-700' },
  deferred: { label: 'مؤجلة', cls: 'bg-amber-50 text-amber-700' },
  pending: { label: 'معلّقة', cls: 'bg-slate-100 text-slate-600' },
  skipped: { label: 'متخطاة', cls: 'bg-slate-100 text-slate-500' },
  failed: { label: 'فشلت', cls: 'bg-red-50 text-red-700' },
};

export default function LogPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';

  const [tab, setTab] = useState<Tab>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [status, setStatus] = useState<'all' | DeliveryStatus>('all');
  const [source, setSource] = useState<'all' | 'automation' | 'campaign'>('all');
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, d, a] = await Promise.all([fetchCampaigns(supabase, 100), fetchDeliveries(supabase, 300), fetchAutomations(supabase)]);
      setCampaigns(c); setDeliveries(d); setAutomations(a); setMigrationMissing(false);
    } catch (e) { if (isMigrationMissing(e)) setMigrationMissing(true); }
    finally { setLoading(false); }
  }, [supabase]);
  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, 'msg-log', [{ table: 'message_deliveries' }, { table: 'message_campaigns' }], load, { enabled: approved, delayMs: 800 });

  const autoName = (id: string | null) => automations.find((a) => a.id === id)?.name ?? 'رسالة تلقائية';
  const campName = (id: string | null) => campaigns.find((c) => c.id === id)?.name ?? 'حملة';

  const visibleDeliveries = useMemo(() => deliveries.filter((d) =>
    (status === 'all' || d.status === status) &&
    (source === 'all' || (source === 'automation' ? !!d.automation_id : !!d.campaign_id))), [deliveries, status, source]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of deliveries) c[d.status] = (c[d.status] ?? 0) + 1;
    return c;
  }, [deliveries]);

  return (
    <AppShell>
      <MsgHeader title="سجل الإرسال" icon={<ClipboardList className="h-5 w-5 text-slate-600" />} />
      {migrationMissing && <div className="mb-3"><MigrationBanner /></div>}
      <Segmented<Tab> value={tab} onChange={setTab} className="mb-3"
        options={[{ value: 'campaigns', label: 'الحملات', icon: Megaphone, count: campaigns.length }, { value: 'deliveries', label: 'التسليمات', icon: Zap, count: deliveries.length }]} />

      {loading ? <p className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></p>
      : tab === 'campaigns' ? (
        campaigns.length === 0 ? (
          <div className="card flex flex-col items-center gap-2 py-10 text-center"><Inbox className="h-10 w-10 text-slate-300" /><p className="text-sm font-bold text-slate-500">لا توجد حملات بعد</p></div>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li key={c.id} className="card !p-3">
                <div className="flex items-start gap-3">
                  <KindIcon kind={c.kind} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-extrabold">{c.name}</span><span className="shrink-0 text-[10px] text-slate-400">{fmtDateTime(c.created_at)}</span></p>
                    <p className="text-[11px] font-bold text-slate-400">إلى {AUDIENCE_LABELS[c.audience]} · {c.channels.map((ch) => CHANNEL_META[ch].short).join(' + ')}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">{c.title ? <b>{c.title} — </b> : null}{c.body}</p>
                    <div className="mt-2 flex gap-1.5 text-[10px] font-bold">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 tabular-nums">{c.recipients_count} مستلم</span>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 tabular-nums">{c.sent_count} أُرسلت</span>
                      {c.queued_count > 0 && <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700 tabular-nums">{c.queued_count} بالقائمة</span>}
                      {c.skipped_count > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500 tabular-nums">{c.skipped_count} متخطاة</span>}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <div className="mb-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <Filter className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {(['all', 'automation', 'campaign'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSource(s)} className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${source === s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {s === 'all' ? 'الكل' : s === 'automation' ? 'تلقائية' : 'حملات'}
              </button>
            ))}
            <span className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
            {(['all', ...Object.keys(STATUS_META)] as ('all' | DeliveryStatus)[]).map((s) => (
              <button key={s} type="button" onClick={() => setStatus(s)} className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${status === s ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {s === 'all' ? 'كل الحالات' : STATUS_META[s].label} {s !== 'all' && counts[s] ? <span className="opacity-70 tabular-nums">{counts[s]}</span> : null}
              </button>
            ))}
          </div>
          {visibleDeliveries.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 py-10 text-center"><Inbox className="h-10 w-10 text-slate-300" /><p className="text-sm font-bold text-slate-500">لا توجد تسليمات</p></div>
          ) : (
            <ul className="space-y-1.5">
              {visibleDeliveries.map((d) => (
                <li key={d.id} className="card !p-3">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-xs font-extrabold">
                      {d.automation_id ? <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Megaphone className="h-3.5 w-3.5 shrink-0 text-sky-500" />}
                      <span className="truncate">{d.automation_id ? autoName(d.automation_id) : campName(d.campaign_id)}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_META[d.status].cls}`}>{STATUS_META[d.status].label}</span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{d.title ? <b>{d.title} — </b> : null}{d.body}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] font-bold text-slate-400 tabular-nums">
                    <span>{fmtDateTime(d.created_at)}</span>
                    <span>{d.channels.map((ch) => CHANNEL_META[ch].short).join(' + ')}</span>
                    {d.status === 'deferred' && d.deliver_at && <span className="flex items-center gap-0.5 text-amber-600"><Moon className="h-3 w-3" /> تُرسل {fmtDateTime(d.deliver_at)}</span>}
                    {d.error && <span className="text-red-500">{d.error}</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AppShell>
  );
}
