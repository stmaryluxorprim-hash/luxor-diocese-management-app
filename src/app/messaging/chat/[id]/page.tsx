'use client';

// ---------- CHAT VIEW (محادثة) ----------
// Thread of one conversation (direct child ↔ servants · staff · group).
// Realtime on `messages`; composer with photo attachment; header actions:
// call / WhatsApp (direct), toggle one-way/two-way (group), archive.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowRight, Send, Loader2, Phone, Smartphone, Archive, ArchiveRestore, Megaphone, Users, ImagePlus, X, Info, Bot,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ConvAvatar, Toast } from '@/components/messaging/MessagingBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { uploadPhoto } from '@/lib/upload';
import {
  fetchInbox, fetchMessages, postMessage, markConversationRead, setConversationArchived, setConversationMode,
  messagingErrorMessage, waLink,
} from '@/lib/messaging';
import type { InboxRow, Message } from '@/lib/messaging-types';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';

  const [conv, setConv] = useState<InboxRow | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [inbox, rows] = await Promise.all([fetchInbox(supabase, null, 500), fetchMessages(supabase, id)]);
      const c = inbox.find((r) => r.id === id) ?? null;
      setConv(c); setMsgs(rows); setNotFound(!c);
      if (c && c.unread > 0) markConversationRead(supabase, id).catch(() => {});
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [supabase, id]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(
    supabase, `chat-${id}`,
    [{ table: 'messages', filter: `conversation_id=eq.${id}` }, { table: 'conversations', filter: `id=eq.${id}` }],
    load, { enabled: approved, delayMs: 300 },
  );
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  const pick = (f: File | null) => {
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const send = async () => {
    const body = text.trim();
    if (!body && !file) return;
    setSending(true);
    try {
      let url: string | null = null;
      if (file) url = await uploadPhoto(supabase, 'messages', file);
      await postMessage(supabase, id, body, url);
      setText(''); pick(null);
      await load();
    } catch (e) {
      flash(messagingErrorMessage(e, 'تعذر الإرسال'));
    } finally {
      setSending(false);
    }
  };

  const toggleArchive = async () => {
    if (!conv) return;
    setBusy(true);
    try { await setConversationArchived(supabase, id, !conv.is_archived); flash(conv.is_archived ? 'تمت إعادة المحادثة' : 'تمت الأرشفة'); await load(); }
    catch (e) { flash(messagingErrorMessage(e)); } finally { setBusy(false); }
  };
  const toggleMode = async () => {
    if (!conv) return;
    setBusy(true);
    const next = conv.mode === 'one_way' ? 'two_way' : 'one_way';
    try { await setConversationMode(supabase, id, next); flash(next === 'one_way' ? 'أصبحت للإعلانات فقط' : 'أصبحت تقبل الردود'); await load(); }
    catch (e) { flash(messagingErrorMessage(e)); } finally { setBusy(false); }
  };

  const groups = useMemo(() => {
    const out: { day: string; label: string; items: Message[] }[] = [];
    for (const m of msgs) {
      const k = dayKey(m.created_at);
      const g = out[out.length - 1];
      if (g && g.day === k) g.items.push(m); else out.push({ day: k, label: fmtDay(m.created_at), items: [m] });
    }
    return out;
  }, [msgs]);

  const isMine = (m: Message) => m.sender_type === 'servant' && m.sender_profile_id === profile?.id;

  if (!loading && notFound) {
    return (
      <AppShell>
        <div className="card mt-6 text-center">
          <p className="font-bold text-slate-600">المحادثة غير موجودة أو ليست في نطاقك</p>
          <Link href="/messaging" className="btn-secondary mt-3 inline-block !px-4 !py-2 text-sm">رجوع</Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="-mx-4 -mt-4 flex h-[calc(100dvh-8.5rem)] flex-col sm:mx-0 sm:mt-0 sm:h-[calc(100dvh-9.5rem)] sm:rounded-3xl sm:border sm:border-slate-100 sm:bg-white sm:shadow-sm">
        <header className="flex items-center gap-2 border-b border-slate-100 bg-white/95 px-3 py-2 backdrop-blur sm:rounded-t-3xl">
          <button type="button" onClick={() => router.push('/messaging')} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </button>
          {conv ? (
            <>
              <ConvAvatar kind={conv.kind} mode={conv.mode} title={conv.title} url={conv.image_url} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">{conv.title ?? '—'}</p>
                <p className="truncate text-[11px] font-bold text-slate-400">
                  {conv.kind === 'direct' && `مخدوم${conv.class_name ? ` · ${conv.class_name}` : ''} · ${conv.mode === 'two_way' ? 'يمكنه الرد' : 'بدون ردود'}`}
                  {conv.kind === 'staff' && 'محادثة بين خدام'}
                  {conv.kind === 'group' && `${conv.members_count} عضو · ${conv.mode === 'one_way' ? 'إعلانات فقط' : 'نقاش مفتوح'}`}
                </p>
              </div>
              {conv.kind === 'direct' && conv.phone && (
                <>
                  <a href={`tel:${conv.phone}`} aria-label="اتصال" className="rounded-full bg-slate-100 p-2 text-slate-600"><Phone className="h-4 w-4" /></a>
                  <a href={waLink(conv.phone, '')} target="_blank" rel="noreferrer" aria-label="واتساب" className="rounded-full bg-green-50 p-2 text-green-600"><Smartphone className="h-4 w-4" /></a>
                </>
              )}
              {conv.kind !== 'staff' && (
                <button type="button" onClick={toggleMode} disabled={busy} aria-label="تبديل النوع" title={conv.mode === 'one_way' ? 'السماح بالردود' : 'بدون ردود'}
                  className={`rounded-full p-2 ${conv.mode === 'one_way' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {conv.mode === 'one_way' ? <Megaphone className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                </button>
              )}
              <button type="button" onClick={toggleArchive} disabled={busy} aria-label="أرشفة" className="rounded-full bg-slate-100 p-2 text-slate-600">
                {conv.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </button>
            </>
          ) : <div className="h-10 flex-1 animate-pulse rounded-xl bg-slate-100" />}
        </header>

        <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_#f0f9ff,_#f8fafc_60%)] px-3 py-3">
          {loading ? (
            <p className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></p>
          ) : msgs.length === 0 ? (
            <div className="mx-auto mt-10 max-w-xs rounded-2xl bg-white/80 p-4 text-center text-xs font-bold text-slate-500 shadow-sm">
              <Info className="mx-auto mb-1 h-5 w-5 text-sky-400" />
              لا توجد رسائل بعد. اكتب أول رسالة — ستصل {conv?.kind === 'direct' ? 'للمخدوم في بوابته' : conv?.kind === 'staff' ? 'للخادم' : 'لكل الأعضاء'} فوراً كإشعار.
            </div>
          ) : groups.map((g) => (
            <div key={g.day}>
              <p className="my-3 text-center"><span className="rounded-full bg-white/90 px-3 py-1 text-[10px] font-bold text-slate-500 shadow-sm">{g.label}</span></p>
              {g.items.map((m) => {
                const mine = isMine(m);
                if (m.sender_type === 'system' || m.kind === 'system') {
                  return (
                    <p key={m.id} className="my-2 text-center">
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-500"><Bot className="h-3 w-3" /> {m.body}</span>
                    </p>
                  );
                }
                return (
                  <div key={m.id} className={`mb-1.5 flex ${mine ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[82%] rounded-2xl px-3 py-2 shadow-sm ${mine ? 'rounded-bl-md bg-sky-600 text-white' : m.sender_type === 'child' ? 'rounded-br-md bg-white text-slate-800 ring-1 ring-emerald-100' : 'rounded-br-md bg-white text-slate-800'}`}>
                      {!mine && (
                        <p className={`mb-0.5 text-[10px] font-extrabold ${m.sender_type === 'child' ? 'text-emerald-600' : 'text-sky-700'}`}>{m.sender_name ?? (m.sender_type === 'child' ? 'مخدوم' : 'خادم')}</p>
                      )}
                      {m.attachment_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a href={m.attachment_url} target="_blank" rel="noreferrer"><img src={m.attachment_url} alt="" className="mb-1 max-h-64 rounded-xl object-cover" /></a>
                      )}
                      {m.body && <p className="whitespace-pre-line break-words text-sm leading-relaxed">{m.body}</p>}
                      <p className={`mt-0.5 flex items-center gap-1 text-[10px] tabular-nums ${mine ? 'text-sky-100' : 'text-slate-400'}`}>
                        {m.via && <span className="inline-flex items-center gap-0.5"><Bot className="h-3 w-3" /> تلقائي ·</span>}
                        {fmtTime(m.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <footer className="border-t border-slate-100 bg-white px-3 py-2 sm:rounded-b-3xl">
          {preview && (
            <div className="mb-2 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="" className="h-14 w-14 rounded-xl object-cover" />
              <button type="button" onClick={() => pick(null)} className="rounded-full bg-slate-100 p-1.5"><X className="h-4 w-4" /></button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="صورة" className="rounded-full bg-slate-100 p-2.5 text-slate-600"><ImagePlus className="h-5 w-5" /></button>
            <textarea
              id="chat-input" rows={1} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
              placeholder="اكتب رسالة…" disabled={sending}
              className="input-field max-h-32 min-h-[2.75rem] flex-1 resize-none !rounded-2xl !py-2.5"
            />
            <button id="chat-send" type="button" onClick={send} disabled={sending || (!text.trim() && !file)} aria-label="إرسال"
              className="rounded-full bg-gradient-to-br from-sky-600 to-indigo-500 p-2.5 text-white shadow-sm disabled:opacity-40">
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
            </button>
          </div>
        </footer>
      </div>
      <Toast msg={toast} />
    </AppShell>
  );
}
