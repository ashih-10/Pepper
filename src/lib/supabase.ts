import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { isWeb } from './storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/** False until the student fills in .env (see the setup guide). */
export const isConfigured = url.startsWith('http') && key.length > 10;

/**
 * Without a Supabase project the app runs as an on-device demo: every read
 * and write goes to this browser's storage and nothing is sent anywhere.
 */
export const isDemo = !isConfigured;

/** localStorage, or undefined where the browser blocks site storage (reading it throws there). */
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

// In demo mode the client is never used; it is created inert (no stored
// session, no refresh timer, no URL parsing) so it can't send anything.
export const supabase = createClient(isConfigured ? url : 'http://localhost', isConfigured ? key : 'missing', {
  auth: {
    storage: isDemo ? undefined : safeStorage(),
    autoRefreshToken: !isDemo,
    persistSession: !isDemo,
    // Web gets the Google sign-in result in the URL; phones get it from the
    // in-app browser instead.
    detectSessionInUrl: isWeb && !isDemo,
    flowType: 'pkce',
  },
});

if (!isWeb && !isDemo) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Pull a readable message out of any Supabase / network error. */
export function errorMessage(err: unknown): string {
  if (!err) return 'Something went wrong.';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message;
  return 'Something went wrong.';
}
