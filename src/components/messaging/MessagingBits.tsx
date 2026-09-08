'use client';

// ---------- Messaging module — shared UI bits ----------
// MsgHeader        : back arrow + title (+ badge / actions)
// KindIcon         : colored circle icon per notification kind
// NotificationCard : one notification row (unread dot, relative time, link)
// ConvAvatar       : conversation avatar (photo / initials / group glyph)
// ChannelChips     : channel multi-select
// VarChips         : [variable] inserter chips
// Toast, Segmented : small helpers

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, MessageSquareText, Users, Megaphone, ShieldCheck, ChevronLeft, Check } from 'lucide-react';
import type { AppNotification, Channel, ConversationKind, NotificationKind } from '@/lib/messaging-types';
import { KIND_META, CHANNEL_META } from '@/lib/messaging-meta';
import { relTime } from '@/lib/messaging';

export function MsgHeader({
  title, badge, back = '/messaging', actions, icon,
}: { title?: string; badge?: React.ReactNode; back?: string; actions?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <section className="mb-3 flex items-center gap-2">
      <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-extrabold">
        {icon ?? <MessageSquareText className="h-5 w-5 shrink-0 text-sky-600" />}
        <span className="truncate">{title ?? 'الرسائل والإشعارات'}</span>
        {badge}
      </h2>
      {actions}
    </section>
  );
}

export function KindIcon({ kind, size = 40, className = '' }: { kind: NotificationKind; size?: number; className?: string }) {
  const m = KIND_META[kind] ?? KIND_META.info;
  const Icon = m.icon;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${m.bg} ${m.fg} ${className}`} style={{ width: size, height: size }}>
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

export function NotificationCard({ n, onOpen, compact = false }: { n: AppNotification; onOpen?: (n: AppNotification) => void; compact?: boolean }) {
  const router = useRouter();
  const unread = !n.read_at;
  const m = KIND_META[n.kind] ?? KIND_META.info;
  const click = () => { onOpen?.(n); if (n.link) router.push(n.link); };
  return (
    <button
      type="button" onClick={click}
      className={`relative flex w-full items-start gap-3 rounded-2xl border p-3 text-right transition ${unread ? `${m.ring} bg-white shadow-sm` : 'border-slate-100 bg-slate-50/60'} ${compact ? 'py-2.5' : ''}`}
    >
      {unread && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-sky-500 ring-2 ring-white" aria-label="غير مقروء" />}
      <KindIcon kind={n.kind} size={compact ? 36 : 44} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm ${unread ? 'font-extrabold' : 'font-bold text-slate-700'}`}>{n.title}</span>
          <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{relTime(n.created_at)}</span>
        </span>
        {n.body && <span className={`mt-0.5 block whitespace-pre-line text-xs leading-relaxed text-slate-600 ${compact ? 'line-clamp-2' : ''}`}>{n.body}</span>}
      </span>
      {n.link && <ChevronLeft className="mt-3 h-4 w-4 shrink-0 text-slate-300" />}
    </button>
  );
}

const KIND_GLYPH: Record<ConversationKind, React.ElementType> = { direct: MessageSquareText, staff: ShieldCheck, group: Megaphone };

export function ConvAvatar({ kind, mode, title, url, size = 48 }: { kind: ConversationKind; mode?: string; title: string | null; url: string | null; size?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="shrink-0 rounded-full object-cover ring-2 ring-white" style={{ width: size, height: size }} />;
  }
  if (kind === 'direct') {
    const initials = (title ?? '؟').split(/\s+/).slice(0, 2).map((s) => s[0]).join('');
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 font-extrabold text-white" style={{ width: size, height: size, fontSize: size * 0.36 }}>
        {initials}
      </span>
    );
  }
  const Glyph = kind === 'group' && mode === 'two_way' ? Users : KIND_GLYPH[kind];
  const tone = kind === 'staff' ? 'from-emerald-400 to-teal-600' : 'from-amber-400 to-orange-500';
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${tone} text-white`} style={{ width: size, height: size }}>
      <Glyph style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

export function ChannelChips({ value, onChange, allowed }: { value: Channel[]; onChange: (v: Channel[]) => void; allowed?: Channel[] }) {
  const list = (Object.keys(CHANNEL_META) as Channel[]).filter((c) => !allowed || allowed.includes(c));
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((c) => {
        const m = CHANNEL_META[c]; const Icon = m.icon; const on = value.includes(c);
        return (
          <button
            key={c} type="button" aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${on ? `${m.bg} ${m.fg} border-transparent shadow-sm` : 'border-slate-200 bg-white text-slate-500'}`}
          >
            {on ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export function VarChips({ vars, onInsert }: { vars: readonly string[]; onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {vars.map((v) => (
        <button key={v} type="button" onClick={() => onInsert(`[${v}]`)}
          className="rounded-lg border border-dashed border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 hover:bg-sky-100">
          [{v}]
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className = '' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: React.ElementType; count?: number }[]; className?: string;
}) {
  return (
    <div className={`flex gap-1 rounded-2xl bg-slate-100 p-1 ${className}`} role="tablist">
      {options.map((o) => {
        const on = o.value === value; const Icon = o.icon;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.value)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-bold transition ${on ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500'}`}>
            {Icon && <Icon className="h-4 w-4" />}
            <span className="truncate">{o.label}</span>
            {!!o.count && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${on ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-600'}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="msg-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}

export function MigrationBanner() {
  return (
    <div className="card border-amber-200 bg-amber-50 text-sm font-bold text-amber-800">
      تحتاج تشغيل تحديث قاعدة البيانات <code className="rounded bg-white px-1">0029_messaging.sql</code> في Supabase أولاً.
    </div>
  );
}

export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
