'use client';

// ---------- Child portal shell ----------
// Same look as the main app: gradient header (church logo + church name +
// service name, side menu button) and a 5-tab bottom bar:
// الرئيسية · الحضور · النقاط · البيانات · الخيارات

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home, CalendarCheck, Star, Database, SlidersHorizontal, Menu, X, LogOut,
  CalendarDays, Clock, User, GraduationCap, Bell, MessageSquareText, type LucideIcon,
} from 'lucide-react';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { fetchChildExams, type ChildExam } from '@/lib/child-portal';
import { fetchChildBadge, type ChildMsgBadge } from '@/lib/child-messaging';
import { useDebouncedRealtime } from '@/lib/realtime';
import { formatCairoDate, formatCairoTime } from '@/lib/time';
import { Loader2 } from 'lucide-react';

export const CHILD_NAV: { href: string; label: string; icon: LucideIcon; id: string }[] = [
  { href: '/child', label: 'الرئيسية', icon: Home, id: 'child-nav-home' },
  { href: '/child/attendance', label: 'الحضور', icon: CalendarCheck, id: 'child-nav-attendance' },
  { href: '/child/points', label: 'النقاط', icon: Star, id: 'child-nav-points' },
  { href: '/child/data', label: 'البيانات', icon: Database, id: 'child-nav-data' },
  { href: '/child/options', label: 'الخيارات', icon: SlidersHorizontal, id: 'child-nav-options' },
];

const isActive = (pathname: string, href: string) =>
  href === '/child' ? pathname === '/child' : pathname.startsWith(href);

/**
 * The child's exams (module الامتحانات, migration 0027). `null` while loading;
 * `[]` when the module isn't granted / nothing is published (the menu entry
 * and the home card then stay hidden). Re-fetched when the tab regains focus.
 */
export function useChildExams(): { exams: ChildExam[] | null; openCount: number; pendingCount: number } {
  const { token } = useChild();
  const supabase = useMemo(() => createClient(), []);
  const [exams, setExams] = useState<ChildExam[] | null>(null);
  useEffect(() => {
    if (!token) { setExams(null); return; }
    let cancelled = false;
    const load = () => fetchChildExams(supabase, token).then((r) => { if (!cancelled) setExams(r); }).catch(() => { if (!cancelled) setExams([]); });
    load();
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [token, supabase]);
  const open = (exams ?? []).filter((x) => x.is_open);
  return {
    exams,
    openCount: open.length,
    // open exams the child can still sit (never finished or has attempts left)
    pendingCount: open.filter((x) => x.open_attempt_id || (x.attempts_used === 0 && x.total_questions > 0)).length,
  };
}

/**
 * Messaging badge for the child (module الرسائل, migration 0029): unread
 * notifications + unread chat messages. `module_granted` is false when the
 * module isn't enabled for the child's scope (bell / menu entries stay hidden).
 * Refreshed on realtime changes of notifications/messages and on focus.
 */
export function useChildMsgBadge(): ChildMsgBadge & { total: number; loaded: boolean } {
  const { token } = useChild();
  const supabase = useMemo(() => createClient(), []);
  const [b, setB] = useState<ChildMsgBadge | null>(null);
  const load = useCallback(() => {
    if (!token) return;
    fetchChildBadge(supabase, token).then(setB).catch(() => setB({ unread_notifications: 0, unread_messages: 0, module_granted: false }));
  }, [token, supabase]);
  useEffect(() => {
    if (!token) { setB(null); return; }
    load();
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [token, load]);
  useDebouncedRealtime(supabase, 'child-msg-badge', [{ table: 'notifications' }, { table: 'messages' }], load, { enabled: !!token, delayMs: 500 });
  const v = b ?? { unread_notifications: 0, unread_messages: 0, module_granted: false };
  return { ...v, total: v.unread_notifications + v.unread_messages, loaded: b !== null };
}

// ---------- Header ----------
function ChildHeader({ onMenu }: { onMenu: () => void }) {
  const { profile } = useChild();
  const main = profile?.enrollments[0];
  const badge = useChildMsgBadge();
  return (
    <header
      id="child-header"
      className="sticky top-0 z-40 bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 text-white shadow-lg"
    >
      <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-gold-300/70">
          <Image
            src={main?.church_logo ?? '/icons/icon-96.png'}
            alt={main?.church_name ?? 'شعار الإيبارشية'}
            fill
            sizes="48px"
            className="object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-extrabold truncate leading-tight">
            {main?.church_name ?? 'إيبارشية الأقصر وتوابعها'}
          </h1>
          <p className="text-xs text-indigo-100 truncate">
            {main ? `${main.service_name} · ${main.class_name}` : 'بوابة المخدوم'}
          </p>
        </div>
        {badge.module_granted && (
          <Link id="child-bell" href="/child/notifications" aria-label={`الإشعارات${badge.total ? ` (${badge.total} جديد)` : ''}`} className="relative rounded-full p-2 hover:bg-white/15 transition">
            <Bell className="h-6 w-6" />
            {badge.total > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-primary-600 tabular-nums">{badge.total > 99 ? '99+' : badge.total}</span>
            )}
          </Link>
        )}
        <button
          id="child-menu-btn"
          aria-label="فتح القائمة"
          onClick={onMenu}
          className="rounded-full p-2 hover:bg-white/15 transition -ml-2"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>
    </header>
  );
}

// ---------- Side menu ----------
function ChildSideMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, logout } = useChild();
  const { exams, pendingCount } = useChildExams();
  const msg = useChildMsgBadge();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { clearInterval(t); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  const person = profile?.person;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        id="child-side-menu"
        role="dialog"
        aria-modal="true"
        className={`fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 p-4 text-white">
          <div className="flex items-start justify-between">
            <div className="relative h-14 w-14 overflow-hidden rounded-2xl bg-white/20 ring-2 ring-gold-300/70">
              {person?.image_url ? (
                <Image src={person.image_url} alt={person.name} fill sizes="56px" className="object-cover" />
              ) : (
                <User className="absolute inset-0 m-auto h-7 w-7" />
              )}
            </div>
            <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-white/15">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-3 font-extrabold truncate">{person?.name ?? '—'}</p>
          <p className="text-xs text-indigo-100">مخدوم</p>
        </div>

        <div className="border-b border-indigo-100 bg-indigo-50/60 px-4 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
            <CalendarDays className="h-4 w-4 shrink-0 text-primary-600" />
            {now ? formatCairoDate(now) : '—'}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-extrabold text-primary-700 tabular-nums">
            <Clock className="h-4 w-4 shrink-0 text-primary-600" />
            {now ? formatCairoTime(now) : '—'}
            <span className="mr-auto text-[10px] font-bold text-slate-400">بتوقيت القاهرة</span>
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <p className="mb-1 px-2 text-[11px] font-extrabold text-slate-400">الصفحات</p>
          {CHILD_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                  active ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}

          {((exams && exams.length > 0) || msg.module_granted) && (
            <p className="mb-1 mt-3 px-2 text-[11px] font-extrabold text-slate-400">الوحدات</p>
          )}
          {msg.module_granted && (
            <>
              <Link id="child-nav-messages" href="/child/messages" onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${isActive(pathname, '/child/messages') ? 'bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                <MessageSquareText className="h-5 w-5 text-sky-600" />
                الرسائل
                {msg.unread_messages > 0 && <span className="mr-auto rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{msg.unread_messages}</span>}
              </Link>
              <Link id="child-nav-notifications" href="/child/notifications" onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${isActive(pathname, '/child/notifications') ? 'bg-rose-100 text-rose-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                <Bell className="h-5 w-5 text-rose-500" />
                الإشعارات
                {msg.unread_notifications > 0 && <span className="mr-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{msg.unread_notifications}</span>}
              </Link>
            </>
          )}
          {exams && exams.length > 0 && (
            <>
              <Link
                id="child-nav-exams"
                href="/child/exams"
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                  isActive(pathname, '/child/exams') ? 'bg-violet-100 text-violet-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <GraduationCap className="h-5 w-5 text-violet-600" />
                الامتحانات
                {pendingCount > 0 && (
                  <span className="mr-auto rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-extrabold text-white tabular-nums">{pendingCount}</span>
                )}
              </Link>
            </>
          )}
        </nav>

        <div className="border-t border-indigo-100 p-3">
          <button
            id="child-logout-btn"
            onClick={() => { logout(); onClose(); router.replace('/child/login'); }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-extrabold text-red-600 hover:bg-red-50 transition"
          >
            <LogOut className="h-5 w-5" />
            خروج من البوابة
          </button>
        </div>
      </aside>
    </>
  );
}

// ---------- Bottom nav ----------
function ChildBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      id="child-bottom-nav"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-indigo-100 shadow-nav pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 max-w-3xl mx-auto">
        {CHILD_NAV.map(({ href, label, icon: Icon, id }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              id={id}
              href={href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition ${
                active ? 'text-primary-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span className={`rounded-xl px-3 py-1 transition ${active ? 'bg-primary-100' : ''}`}>
                <Icon className="h-5 w-5" />
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ---------- Shell ----------
export default function ChildShell({ children }: { children: ReactNode }) {
  const { token, profile, loading, error } = useChild();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !token) router.replace('/child/login');
  }, [loading, token, router]);

  if (loading || (!profile && !error && token)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }
  if (!token) return null;

  return (
    <div className="flex min-h-screen flex-col">
      <ChildHeader onMenu={() => setMenuOpen(true)} />
      <main id="child-main" className="flex-1 max-w-3xl w-full mx-auto px-4 py-4 pb-24">
        {error && !profile ? (
          <div className="card text-center text-sm font-bold text-red-600">{error}</div>
        ) : (
          children
        )}
      </main>
      <ChildBottomNav />
      <ChildSideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
