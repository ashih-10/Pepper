import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { loadProfile } from '@/lib/api';
import {
  endLocalSession,
  getLocalSession,
  onLocalSessionChange,
  startLocalSession,
  type LocalSession,
} from '@/lib/local/session';
import { setPref } from '@/lib/prefs';
import { isWeb } from '@/lib/storage';
import { isDemo, supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

if (!isDemo) {
  try {
    WebBrowser.maybeCompleteAuthSession();
  } catch {
    // site storage blocked: there is no pending sign-in to finish
  }
}

interface AuthCtx {
  ready: boolean;
  /** True once someone is signed in (or the on-device demo has started). */
  signedIn: boolean;
  /** The account's email; null in the on-device demo. */
  email: string | null;
  userId: string | null;
  profile: Profile | null;
  /** True when the profile could not be loaded (offline, server error). */
  profileFailed: boolean;
  refreshProfile: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  /** Demo mode only: create the on-device student and sign in as them. */
  startDemo: () => void;
  /** Signs out; in demo mode this erases everything the demo stored on this device. */
  signOut: () => Promise<void>;
}

/** Who is signed in, whichever backend is in use. */
interface Who {
  userId: string;
  email: string | null;
}

const fromCloud = (s: Session | null): Who | null => (s ? { userId: s.user.id, email: s.user.email ?? null } : null);
const fromLocal = (s: LocalSession | null): Who | null => (s ? { userId: s.userId, email: null } : null);

/** Where Google sends the browser back to; includes the sub-path on GitHub Pages (e.g. /Pepper/). */
function webRedirect(): string {
  const base = (process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  return window.location.origin + (base ? `${base}/` : '');
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // The demo session is read straight from this device's storage, so there is
  // nothing to wait for; the cloud session is checked once on start.
  const [sessionChecked, setSessionChecked] = useState(isDemo);
  const [who, setWho] = useState<Who | null>(() => (isDemo ? fromLocal(getLocalSession()) : null));
  // The profile is stored with the user id it belongs to, so a stale profile
  // is never shown after switching accounts. `failed` keeps "couldn't load"
  // apart from "no profile yet", so a network blip never sends an onboarded
  // student back through onboarding.
  const [loaded, setLoaded] = useState<{ uid: string | null; profile: Profile | null; failed: boolean }>({
    uid: null,
    profile: null,
    failed: false,
  });
  const userId = who?.userId ?? null;
  const email = who?.email ?? null;
  const profile = loaded.uid === userId ? loaded.profile : null;
  const profileFailed = loaded.uid === userId && loaded.failed;
  const ready = sessionChecked && (!userId || loaded.uid === userId);

  useEffect(() => {
    if (isDemo) return onLocalSessionChange((s) => setWho(fromLocal(s)));
    supabase.auth.getSession().then(({ data }) => {
      setWho(fromCloud(data.session));
      setSessionChecked(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setWho(fromCloud(s)));
    return () => data.subscription.unsubscribe();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    try {
      const p = await loadProfile();
      setLoaded({ uid: userId, profile: p, failed: false });
    } catch {
      setLoaded((cur) => (cur.uid === userId && cur.profile ? cur : { uid: userId, profile: null, failed: true }));
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    loadProfile()
      .then((p) => live && setLoaded({ uid: userId, profile: p, failed: false }))
      .catch(() => live && setLoaded({ uid: userId, profile: null, failed: true }));
    return () => {
      live = false;
    };
  }, [userId]);

  // Coming back to the app retries a failed profile load.
  useEffect(() => {
    if (!profileFailed) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshProfile();
    });
    return () => sub.remove();
  }, [profileFailed, refreshProfile]);

  const signInWithGoogle = useCallback(async () => {
    if (isDemo) throw new Error('Google sign-in needs a server. This copy runs as an on-device demo.');
    if (isWeb) {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: webRedirect() },
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

  const startDemo = useCallback(() => {
    if (!isDemo) return;
    setWho(fromLocal(startLocalSession()));
  }, []);

  const signOut = useCallback(async () => {
    if (isDemo) {
      endLocalSession();
      // Also forget this device's small app settings for the demo student.
      if (userId) setPref(`pp:lastActivity:${userId}`, null);
      setPref('pp:demo', null);
      setWho(null);
    } else {
      await supabase.auth.signOut();
    }
    setLoaded({ uid: null, profile: null, failed: false });
  }, [userId]);

  const value = useMemo(
    () => ({
      ready,
      signedIn: userId !== null,
      email,
      userId,
      profile,
      profileFailed,
      refreshProfile,
      signInWithGoogle,
      startDemo,
      signOut,
    }),
    [ready, email, userId, profile, profileFailed, refreshProfile, signInWithGoogle, startDemo, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
