import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DEMO_PLACE } from '@/components/demo-banner';
import { Button, Card, Field, Muted, Screen, tell } from '@/components/ui';
import { errorMessage, isDemo, supabase } from '@/lib/supabase';
import { C, S } from '@/lib/theme';
import { useAuth } from '@/state/auth';

export default function SignIn() {
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.hero}>
        <Text style={styles.logo}>🌶️🥛</Text>
        <Text style={styles.name}>Pepper Planner</Text>
        <Muted style={{ textAlign: 'center' } as object}>
          Know what matters today. Your tasks heat up as deadlines get close. Finish one and cool it down with a glass of
          milk.
        </Muted>
      </View>

      {isDemo ? <DemoStart /> : <AccountSignIn />}

      <Muted style={{ textAlign: 'center' } as object}>You must be 13 or older to use Pepper Planner.</Muted>
    </Screen>
  );
}

/** No server configured: the whole app runs on this device, nothing is uploaded. */
function DemoStart() {
  const { startDemo } = useAuth();

  function start() {
    try {
      startDemo();
    } catch (err) {
      tell('Could not start the demo', errorMessage(err));
    }
  }

  return (
    <>
      <Card>
        <Text style={styles.cardTitle}>Demo mode</Text>
        <Muted>
          This copy isn&apos;t connected to a server, so everything you add stays in {DEMO_PLACE} and is never
          uploaded.
        </Muted>
        <Button title="Start the demo" icon="play" onPress={start} />
      </Card>
      <Muted style={{ textAlign: 'center' } as object}>
        A real account (sign-in, sync across devices, sharing with real classmates) needs the app&apos;s server set up.
        See the README.
      </Muted>
    </>
  );
}

function AccountSignIn() {
  const { signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);

  async function submitEmail() {
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) return tell('Enter a valid email address.');
    if (password.length < 8) return tell('Password must be at least 8 characters.');
    setBusy('email');
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: e, password });
        if (error) throw error;
        if (!data.session) tell('Check your email', 'Tap the confirmation link we sent, then sign in.');
      }
    } catch (err) {
      tell(mode === 'in' ? 'Could not sign in' : 'Could not create account', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setBusy('google');
    try {
      await signInWithGoogle();
    } catch (err) {
      tell('Google sign-in failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button title="Continue with Google" icon="logo-google" kind="secondary" onPress={google} busy={busy === 'google'} />

      <View style={styles.or}>
        <View style={styles.line} />
        <Muted>or use email</Muted>
        <View style={styles.line} />
      </View>

      <Card>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@school.org"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          placeholder="8+ characters"
          onSubmitEditing={submitEmail}
        />
        <Button title={mode === 'in' ? 'Sign in' : 'Create account'} onPress={submitEmail} busy={busy === 'email'} />
        <Button
          kind="ghost"
          title={mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          onPress={() => setMode(mode === 'in' ? 'up' : 'in')}
        />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: S.sm, paddingVertical: S.xl },
  logo: { fontSize: 56 },
  name: { fontSize: 32, fontWeight: '900', color: C.primary },
  cardTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  or: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  line: { flex: 1, height: 1, backgroundColor: C.border },
});
