'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, ScanLine, BarChart3, Settings } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'الرئيسية', icon: Home, id: 'nav-home' },
  { href: '/children', label: 'المخدومين', icon: Users, id: 'nav-children' },
  { href: '/scanner', label: 'الماسح', icon: ScanLine, id: 'nav-scanner' },
  { href: '/stats', label: 'الإحصائيات', icon: BarChart3, id: 'nav-stats' },
  { href: '/settings', label: 'الإعدادات', icon: Settings, id: 'nav-settings' },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      id="bottom-nav"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-indigo-100 shadow-nav pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 max-w-3xl mx-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon, id }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              id={id}
              href={href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition ${
                active ? 'text-primary-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span
                className={`rounded-xl px-3 py-1 transition ${
                  active ? 'bg-primary-100' : ''
                }`}
              >
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
