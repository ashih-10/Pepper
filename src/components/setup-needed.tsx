import { Text } from 'react-native';

import { C } from '@/lib/theme';

import { Card, H1, Muted, Screen } from './ui';

/** Shown until the .env file has the Supabase URL and key (see setup guide). */
export function SetupNeeded() {
  return (
    <Screen>
      <Text style={{ fontSize: 48 }}>🌶️</Text>
      <H1>Almost there</H1>
      <Muted>The app isn&apos;t connected to its database yet.</Muted>
      <Card>
        <Text style={{ fontWeight: '700', color: C.text }}>1. Copy .env.example to .env</Text>
        <Text style={{ fontWeight: '700', color: C.text }}>
          2. Paste your Supabase project URL and publishable key into it
        </Text>
        <Text style={{ fontWeight: '700', color: C.text }}>3. Restart: npx expo start -c</Text>
        <Muted>Step-by-step instructions are in the Setup Guide PDF.</Muted>
      </Card>
    </Screen>
  );
}
