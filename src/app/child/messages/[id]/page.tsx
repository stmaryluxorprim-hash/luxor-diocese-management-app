'use client';

// ---------- Child portal — محادثة ----------
// One conversation thread. Fetching marks it read server-side. Reply box
// only when `can_reply` (two-way + church allows). Photo attachments.
// Realtime on messages of this conversation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Send, Loader2, ImagePlus, X, Bot, Megaphone, Lock } from 'lucide-react';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { uploadPhoto } from '@/lib/upload';
import { fetchChildThread, sendChildMessage, childMsgError, type ChildThread, type ChildMessage } from '@/lib/child-messaging';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

export default function ChildChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, loading: authLoading } = useChild();
  const supabase = useMemo(() => createClient(), []);
  const [thread, setThread] = useState<ChildThread | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!authLoading && !token) router.replace('/child/login'); }, [authLoading, token, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try { setThread(await fetchChildThread(supabase, token, id)); setError(''); }
    catch (e) { setError(childMsgError(e, 'تعذر تحميل المحادثة')); }
  }, [supabase, token, id]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, `child-chat-${id}`, [{ table: 'messages', filter: `conversation_id=eq.${id}` }], load, { enabled: !!token, delayMs: 300 });
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages.length]);

  const pick = (f: File | null) => { setFile(f); if (preview) URL.revokeObjectURL(preview); setPreview(f ? URL.createObjectURL(f) : null); };
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  const send = async () => {
    const body = text.trim();
    if (!token || (!body && !file)) return;
    setSending(true);
    try {
      let url: string | null = null;
      if (file) url = await uploadPhoto(supabase, 'messages', file);
      await sendChildMessage(supabase, token, id, body, url);
      setText(''); pick(null); await load();
    } catch (e) { flash(childMsgError(e, 'تعذر الإرسال')); }
    finally { setSending(false); }
  };

  const groups = useMemo(() => {
    const out: { day: string; label: string; items: ChildMessage[] }[] = [];
    for (const m of thread?.messages ?? []) {
      const k = dayKey(m.created_at); const g = out[out.length - 1];
      if (g && g.day === k) g.items.push(m); else out.push({ day: k, label: fmtDay(m.created_at), items: [m] });
    }
    return out;
  }, [thread?.messages]);

  const conv = thread?.conversation;
  const canReply = !!conv?.can_reply;

  return (
    <div className="flex h-dvh flex-col bg-slate-50" dir="rtl">
      <header className="sticky top-0 z-40 bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 text-white shadow-lg">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2.5">
          <button type="button" onClick={() => router.push('/child/messages')} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-white/15"><ArrowRight className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">{conv?.title ?? '…'}</p>
            <p className="truncate text-[11px] text-indigo-100">
              {conv ? (conv.kind === 'direct' ? 'خدام فصلك' : conv.mode === 'one_way' ? 'إعلانات — للقراءة فقط' : 'مجموعة نقاش') : ''}
            </p>
          </div>
          {conv?.kind === 'group' && conv.mode === 'one_way' && <Megaphone className="h-5 w-5 text-amber-200" />}
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-3 py-3">
        {error && <div className="card text-center text-sm font-bold text-red-600">{error}</div>}
        {!thread && !error && <p className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></p>}
        {thread && thread.messages.length === 0 && (
          <div className="mx-auto mt-10 max-w-xs rounded-2xl bg-white p-4 text-center text-xs font-bold text-slate-500 shadow-sm">
            {canReply ? 'لا توجد رسائل بعد — اكتب أول رسالة لخدامك 👋' : 'لا توجد رسائل بعد.'}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.day}>
            <p className="my-3 text-center"><span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-slate-500 shadow-sm">{g.label}</span></p>
            {g.items.map((m) => {
              if (m.sender_type === 'system' || m.kind === 'system') {
                return <p key={m.id} className="my-2 text-center"><span className="inline-flex items-center gap-1 rounded-full bg-slate-200/70 px-3 py-1 text-[11px] font-bold text-slate-600"><Bot className="h-3 w-3" /> {m.body}</span></p>;
              }
              return (
                <div key={m.id} className={`mb-1.5 flex ${m.mine ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2 shadow-sm ${m.mine ? 'rounded-bl-md bg-sky-600 text-white' : 'rounded-br-md bg-white text-slate-800'}`}>
                    {!m.mine && <p className="mb-0.5 text-[10px] font-extrabold text-sky-700">{m.sender_name}</p>}
                    {m.attachment_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a href={m.attachment_url} target="_blank" rel="noreferrer"><img src={m.attachment_url} alt="" className="mb-1 max-h-64 rounded-xl object-cover" /></a>
                    )}
                    {m.body && <p className="whitespace-pre-line break-words text-sm leading-relaxed">{m.body}</p>}
                    <p className={`mt-0.5 flex items-center gap-1 text-[10px] tabular-nums ${m.mine ? 'text-sky-100' : 'text-slate-400'}`}>
                      {m.via && <span className="inline-flex items-center gap-0.5"><Bot className="h-3 w-3" /> تلقائي ·</span>}{fmtTime(m.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <footer className="border-t border-slate-100 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          {!canReply ? (
            <p className="flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-slate-400"><Lock className="h-3.5 w-3.5" /> هذه المحادثة للقراءة فقط</p>
          ) : (
            <>
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
                <textarea id="child-chat-input" rows={1} value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                  placeholder="اكتب رسالة…" disabled={sending} className="input-field max-h-32 min-h-[2.75rem] flex-1 resize-none !rounded-2xl !py-2.5" />
                <button id="child-chat-send" type="button" onClick={send} disabled={sending || (!text.trim() && !file)} aria-label="إرسال"
                  className="rounded-full bg-gradient-to-br from-sky-600 to-indigo-500 p-2.5 text-white shadow-sm disabled:opacity-40">
                  {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
                </button>
              </div>
            </>
          )}
        </div>
      </footer>
      {toast && <div role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">{toast}</div>}
    </div>
  );
}
