'use client';

// ---------- Header bell 🔔 — unread notifications (وحدة الإشعارات) ----------
// Rendered in the app header when the `notifications` module is granted.
// Count from notif_unread_count(); realtime on notification_recipients +
// service-worker push messages. Also re-syncs this device's push
// subscription silently on start. Tap → /notifications/inbox.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { useModuleVisible } from '@/lib/modules-context';
import { fetchUnreadCount } from '@/lib/notifications';
import { syncPushRegistration } from '@/lib/push';

export default function NotificationsBell() {
  const { profile } = useAuth();
  const router = useRouter();
  const visible = useModuleVisible('notifications');
  const [supabase] = useState(() => createClient());
  const [n, setN] = useState(0);
  const enabled = !!visible && profile?.status === 'approved';

  const load = useCallback(async () => {
    if (!enabled) return;
    try { setN(await fetchUnreadCount(supabase)); } catch { /* migration missing → silent */ }
  }, [supabase, enabled]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (enabled) syncPushRegistration(supabase, { kind: 'servant' }); }, [enabled, supabase]);
  useDebouncedRealtime(supabase, 'notif-bell', [{ table: 'notification_recipients' }], load, { enabled, delayMs: 800 });

  // service worker → page messages (push arrived / notification tapped)
  useEffect(() => {
    if (!enabled || !('serviceWorker' in navigator)) return;
    const h = (e: MessageEvent) => {
      if (e.data?.type === 'push') load();
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string') {
        try { const u = new URL(e.data.url); if (u.origin === location.origin) router.push(u.pathname + u.search); } catch { /* ignore */ }
      }
    };
    navigator.serviceWorker.addEventListener('message', h);
    return () => navigator.serviceWorker.removeEventListener('message', h);
  }, [enabled, load, router]);

  if (!visible) return null;
  return (
    <Link
      id="notifications-bell"
      href="/notifications/inbox"
      aria-label={n > 0 ? `${n} إشعارات غير مقروءة` : 'الإشعارات'}
      className="relative rounded-full p-2 transition hover:bg-white/15"
    >
      <Bell className="h-6 w-6" />
      {n > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-primary-700 tabular-nums">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}
