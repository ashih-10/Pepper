import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { loadProfile } from '@/lib/api';
import { isWeb } from '@/lib/storage';
import { isConfigured, supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

WebBrowser.maybeCompleteAuthSession();

interface AuthCtx {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  // The profile is stored with the user id it belongs to, so a stale profile
  // is never shown after switching accounts.
  const [loaded, setLoaded] = useState<{ uid: string | null; profile: Profile | null }>({ uid: null, profile: null });
  const userId = session?.user.id ?? null;
  const profile = loaded.uid === userId ? loaded.profile : null;
  const ready = !isConfigured || (sessionChecked && (!userId || loaded.uid === userId));

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const p = await loadProfile(userId);
    setLoaded({ uid: userId, profile: p });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    loadProfile(userId)
      .then((p) => live && setLoaded({ uid: userId, profile: p }))
      .catch(() => live && setLoaded({ uid: userId, profile: null }));
    return () => {
      live = false;
    };
  }, [userId]);

  const signInWithGoogle = useCallback(async () => {
    if (isWeb) {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
      return;
    }
    // Phones: open Google in an in-app browser, then trade the returned code
    // for a session (PKCE flow).
    const redirectTo = Linking.createURL('auth-callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return;
    const code = new URL(result.url).searchParams.get('code');
    if (!code) throw new Error('Google sign-in did not finish. Try again.');
    const exchanged = await supabase.auth.exchangeCodeForSession(code);
    if (exchanged.error) throw exchanged.error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setLoaded({ uid: null, profile: null });
  }, []);

  const value = useMemo(
    () => ({ ready, session, userId, profile, refreshProfile, signInWithGoogle, signOut }),
    [ready, session, userId, profile, refreshProfile, signInWithGoogle, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
