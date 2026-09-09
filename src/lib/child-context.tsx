'use client';

// ---------- Child portal session ----------
// Holds the scanned token + the loaded profile. Pages under /child/* use
// `useChild()`; `ChildShell` redirects to /child/login when no token.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  clearChildToken, fetchChildProfile, getChildToken, setChildToken,
  childErrorMessage, fetchChildExams, fetchChildOnlineClasses, type ChildProfile, type ChildExam, type ChildOnlineClass,
} from '@/lib/child-portal';
import { fetchChildChatOverview, type ChildChatOverview } from '@/lib/chat';
import { fetchChildAchievements, type ChildAchievements } from '@/lib/achievements';
import { uniqueTopic } from '@/lib/realtime';

interface ChildState {
  token: string | null;
  profile: ChildProfile | null;
  loading: boolean;
  error: string | null;
  /** (re)load profile for the current token */
  refresh: () => Promise<void>;
  /** validate a scanned code, store it and load the profile; returns error text or null */
  login: (code: string) => Promise<string | null>;
  logout: () => void;
  /**
   * Modules data shared by every child page (fetched ONCE here, not by each
   * header / menu / page — see useChildExams / useChildMessages).
   * `null` while loading; `[]` when the module isn't granted.
   */
  exams: ChildExam[] | null;
  conversations: ChildChatOverview[] | null;
  reloadMessages: () => void;
  /** online classes (0030): scheduled / live / recent — realtime on online_classes */
  onlineClasses: ChildOnlineClass[] | null;
  reloadOnline: () => void;
  /** achievements (0031): earned cards + attendance progress — realtime on user_achievements */
  achievements: ChildAchievements | null;
  reloadAchievements: () => void;
}

const ChildContext = createContext<ChildState>({
  token: null,
  profile: null,
  loading: true,
  error: null,
  refresh: async () => {},
  login: async () => null,
  logout: () => {},
  exams: null,
  conversations: null,
  reloadMessages: () => {},
  onlineClasses: null,
  reloadOnline: () => {},
  achievements: null,
  reloadAchievements: () => {},
});

export function ChildProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (t: string) => {
      try {
        const p = await fetchChildProfile(supabase, t);
        setProfile(p);
        setError(null);
      } catch (e) {
        const msg = childErrorMessage(e);
        // an unknown / deleted code should log the child out
        if (msg.includes('غير مسجل') || msg.includes('غير صالح')) {
          clearChildToken();
          setToken(null);
          setProfile(null);
        }
        setError(msg);
      }
    },
    [supabase]
  );

  // boot: read token from storage
  useEffect(() => {
    const t = getChildToken();
    setToken(t);
    if (t) load(t).finally(() => setLoading(false));
    else setLoading(false);
  }, [load]);

  const refresh = useCallback(async () => {
    if (token) await load(token);
  }, [token, load]);

  const login = useCallback(
    async (code: string): Promise<string | null> => {
      const clean = code.trim();
      try {
        const p = await fetchChildProfile(supabase, clean);
        setChildToken(clean);
        setToken(clean);
        setProfile(p);
        setError(null);
        return null;
      } catch (e) {
        return childErrorMessage(e);
      }
    },
    [supabase]
  );

  const logout = useCallback(() => {
    clearChildToken();
    setToken(null);
    setProfile(null);
    setError(null);
  }, []);

  // Realtime: counters / photo / data change for this person's enrollments
  // (anon can subscribe; RLS on realtime may hide payloads — we only use it
  // as a trigger to refetch via the RPC, so an empty payload is fine).
  useEffect(() => {
    if (!token || !profile) return;
    const ids = profile.enrollments.map((e) => e.id);
    if (ids.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(token), 1200);
    };
    const channel = supabase.channel(uniqueTopic(`child-${profile.person.id}`));
    ids.forEach((id) => {
      channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'enrollments', filter: `id=eq.${id}` },
        schedule
      );
    });
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'persons', filter: `id=eq.${profile.person.id}` },
      schedule
    );
    channel.subscribe();
    // also refresh when the tab becomes visible again
    const onVis = () => { if (document.visibilityState === 'visible') schedule(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, profile?.person.id, supabase, load]);

  // ---- modules: exams (0027) — one fetch for the whole portal, refetch on focus
  const [exams, setExams] = useState<ChildExam[] | null>(null);
  useEffect(() => {
    if (!token) { setExams(null); return; }
    let cancelled = false;
    const run = () => fetchChildExams(supabase, token)
      .then((r) => { if (!cancelled) setExams(r); })
      .catch(() => { if (!cancelled) setExams([]); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [token, supabase]);

  // ---- modules: messages (0029) — one fetch + ONE realtime subscription.
  // Before, header + side menu + home page each opened `child-msgs-<token>`;
  // the shared browser client returned the same (already subscribed) channel
  // and `.on()` threw → the portal crashed on open.
  const [conversations, setConversations] = useState<ChildChatOverview[] | null>(null);
  const [msgTick, setMsgTick] = useState(0);
  const reloadMessages = useCallback(() => setMsgTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setConversations(null); return; }
    let cancelled = false;
    const run = () => fetchChildChatOverview(supabase, token)
      .then((r) => { if (!cancelled) setConversations(r); })
      .catch(() => { if (!cancelled) setConversations([]); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase.channel(uniqueTopic('child-msgs'));
    try {
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(run, 700);
        })
        .subscribe();
    } catch { /* realtime unavailable → polling on focus only */ }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
  }, [token, supabase, msgTick]);

  // ---- modules: online classes (0030) — one fetch + one realtime subscription
  // on online_classes (status flips scheduled → live → ended), refetch on focus.
  const [onlineClasses, setOnlineClasses] = useState<ChildOnlineClass[] | null>(null);
  const [onlineTick, setOnlineTick] = useState(0);
  const reloadOnline = useCallback(() => setOnlineTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setOnlineClasses(null); return; }
    let cancelled = false;
    const run = () => fetchChildOnlineClasses(supabase, token)
      .then((r) => { if (!cancelled) setOnlineClasses(r); })
      .catch(() => { if (!cancelled) setOnlineClasses([]); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase.channel(uniqueTopic('child-online'));
    try {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'online_classes' }, () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(run, 600);
        })
        .subscribe();
    } catch { /* realtime unavailable → polling on focus only */ }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
  }, [token, supabase, onlineTick]);

  // ---- modules: achievements (0031) — one fetch + realtime on user_achievements
  const [achievements, setAchievements] = useState<ChildAchievements | null>(null);
  const [achTick, setAchTick] = useState(0);
  const reloadAchievements = useCallback(() => setAchTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setAchievements(null); return; }
    let cancelled = false;
    const run = () => fetchChildAchievements(supabase, token)
      .then((r) => { if (!cancelled) setAchievements(r); })
      .catch(() => { if (!cancelled) setAchievements({ earned: [], progress: [] }); });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase.channel(uniqueTopic('child-achievements'));
    try {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_achievements' }, () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(run, 800);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_log' }, () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(run, 1500);
        })
        .subscribe();
    } catch { /* realtime unavailable → polling on focus only */ }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
  }, [token, supabase, achTick]);

  const value = useMemo(
    () => ({ token, profile, loading, error, refresh, login, logout, exams, conversations, reloadMessages, onlineClasses, reloadOnline, achievements, reloadAchievements }),
    [token, profile, loading, error, refresh, login, logout, exams, conversations, reloadMessages, onlineClasses, reloadOnline, achievements, reloadAchievements]
  );

  return <ChildContext.Provider value={value}>{children}</ChildContext.Provider>;
}

export const useChild = () => useContext(ChildContext);
