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
  childErrorMessage, type ChildProfile,
} from '@/lib/child-portal';

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
}

const ChildContext = createContext<ChildState>({
  token: null,
  profile: null,
  loading: true,
  error: null,
  refresh: async () => {},
  login: async () => null,
  logout: () => {},
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
    const channel = supabase.channel(`child-${profile.person.id}`);
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

  const value = useMemo(
    () => ({ token, profile, loading, error, refresh, login, logout }),
    [token, profile, loading, error, refresh, login, logout]
  );

  return <ChildContext.Provider value={value}>{children}</ChildContext.Provider>;
}

export const useChild = () => useContext(ChildContext);
