import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SetupNeeded } from '@/components/setup-needed';
import { Loading } from '@/components/ui';
import { isConfigured } from '@/lib/supabase';
import { C } from '@/lib/theme';
import { AuthProvider, useAuth } from '@/state/auth';
import { PlannerProvider } from '@/state/planner';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Gate() {
  const { ready, session, profile } = useAuth();
  useEffect(() => {
    if (ready || !isConfigured) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!isConfigured) return <SetupNeeded />;
  if (!ready) return <Loading />;

  const signedIn = !!session;
  const onboarded = !!profile?.onboarded;
  const header = {
    headerShown: true,
    headerTintColor: C.primary,
    headerStyle: { backgroundColor: C.bg },
    headerTitleStyle: { color: C.text, fontWeight: '800' as const },
    headerShadowVisible: false,
  };

  return (
    <PlannerProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="task/new" options={{ ...header, title: 'New task', presentation: 'modal' }} />
          <Stack.Screen name="task/[id]" options={{ ...header, title: 'Task' }} />
          <Stack.Screen name="group/[id]" options={{ ...header, title: 'Group' }} />
        </Stack.Protected>
        <Stack.Screen name="auth-callback" />
      </Stack>
    </PlannerProvider>
  );
}
