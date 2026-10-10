import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LoadFailed } from '@/components/load-failed';
import { Loading } from '@/components/ui';
import { C } from '@/lib/theme';
import { AuthProvider, useAuth } from '@/state/auth';
import { PlannerProvider } from '@/state/planner';

SplashScreen.preventAutoHideAsync().catch(() => {});

// A screen opened directly (deep link, page refresh) gets the tabs underneath
// it, so its back button always has somewhere to go.
export const unstable_settings = { anchor: '(tabs)' };

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
  const { ready, signedIn, profile, profileFailed } = useAuth();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Without a server configured the app runs as an on-device demo; the same
  // screens work either way.
  if (!ready) return <Loading />;
  if (signedIn && profileFailed) return <LoadFailed />;

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
