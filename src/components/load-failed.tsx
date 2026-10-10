import { useState } from 'react';
import { Text } from 'react-native';

import { useAuth } from '@/state/auth';

import { Button, H1, Muted, Screen } from './ui';

/** Shown when the profile couldn't load (offline or server error). Never onboarding. */
export function LoadFailed() {
  const { refreshProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Screen edges={['top', 'bottom']}>
      <Text style={{ fontSize: 48 }}>📡</Text>
      <H1>Can&apos;t reach Pepper Planner</H1>
      <Muted>Check your internet connection, then try again. Your tasks are safe.</Muted>
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
      <Button title="Sign out" kind="ghost" onPress={signOut} />
    </Screen>
  );
}
