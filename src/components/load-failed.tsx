import { useState } from 'react';
import { Text } from 'react-native';

import { isDemo } from '@/lib/supabase';
import { useAuth } from '@/state/auth';

import { Button, confirm, H1, Muted, Screen } from './ui';

/** Shown when the profile couldn't load (offline or server error). Never onboarding. */
export function LoadFailed() {
  const { refreshProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Screen edges={['top', 'bottom']}>
      <Text style={{ fontSize: 48 }}>📡</Text>
      <H1>{isDemo ? 'The demo could not load' : 'Can\u2019t reach Pepper Planner'}</H1>
      <Muted>
        {isDemo
          ? 'This browser may be blocking site storage. Try again, or reset the demo to start over.'
          : 'Check your internet connection, then try again. Your tasks are safe.'}
      </Muted>
      <Button
        title="Try again"
        icon="refresh"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          await refreshProfile();
          setBusy(false);
        }}
      />
      {isDemo ? (
        <Button
          title="Reset demo"
          kind="ghost"
          onPress={async () => {
            if (await confirm('Reset the demo?', 'This erases everything the demo stored in this browser.', 'Reset', true)) {
              await signOut();
            }
          }}
        />
      ) : (
        <Button title="Sign out" kind="ghost" onPress={signOut} />
      )}
    </Screen>
  );
}
