'use client';

// ---------- Child portal shell ----------
// Same look as the main app: gradient header (church logo + church name +
// service name, side menu button) and a 5-tab bottom bar:
// الرئيسية · الحضور · النقاط · البيانات · الخيارات

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home, CalendarCheck, Star, Database, SlidersHorizontal, Menu, X, LogOut,
  CalendarDays, Clock, User, type LucideIcon,
} from 'lucide-react';
import { useChild } from '@/lib/child-context';
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

// ---------- Header ----------
function ChildHeader({ onMenu }: { onMenu: () => void }) {
  const { profile } = useChild();
  const main = profile?.enrollments[0];
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
