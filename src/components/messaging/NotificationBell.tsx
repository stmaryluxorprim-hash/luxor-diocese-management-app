'use client';

// ---------- Header bell (الجرس) ----------
// Shows unread notifications + messages count for the signed-in servant
// (msg_badge RPC, refreshed via realtime on notifications/messages). Tapping
// opens /messaging. New notifications while the tab is hidden fire a browser
// Notification (permission requested once on first interaction).
// Rendered only when the messaging module is visible for the caller.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useModuleVisible } from '@/lib/modules-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { fetchBadge, fetchNotifications, ensureNotificationPermission, showBrowserNotification } from '@/lib/messaging';

export default function NotificationBell() {
  const { profile } = useAuth();
  const visible = useModuleVisible('messaging');
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const enabled = !!(approved && visible);
  const [count, setCount] = useState(0);
  const [pulse, setPulse] = useState(false);
  const lastSeen = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await fetchBadge(supabase);
      const total = b.unread_notifications + b.unread_messages;
      setCount((prev) => { if (total > prev) { setPulse(true); setTimeout(() => setPulse(false), 1500); } return total; });
      // browser notification for the newest unread item (once)
      if (b.unread_notifications > 0) {
        const [n] = await fetchNotifications(supabase, 1, true);
        if (n && n.id !== lastSeen.current) {
          if (lastSeen.current !== null) showBrowserNotification(n.title, n.body, n.link ?? '/messaging');
          lastSeen.current = n.id;
        }
      } else if (lastSeen.current === null) lastSeen.current = '';
    } catch { /* module missing / offline */ }
  }, [supabase]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  useDebouncedRealtime(supabase, 'msg-bell', [{ table: 'notifications' }, { table: 'messages' }], load, { enabled, delayMs: 400 });
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, load]);

  if (!enabled) return null;
  return (
    <Link id="notif-bell" href="/messaging" aria-label={`الإشعارات${count ? ` (${count} جديد)` : ''}`}
      onClick={() => { ensureNotificationPermission(); }}
      className="relative rounded-full p-2 transition hover:bg-white/15">
      <Bell className={`h-6 w-6 ${pulse ? 'animate-bounce' : ''}`} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-primary-600 tabular-nums">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
