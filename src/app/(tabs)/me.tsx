/** Profile, classes, alert settings, demo tools, sign out. */
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { ClassEditor } from '@/components/class-editor';
import { DEMO_PLACE, DemoBanner } from '@/components/demo-banner';
import { Button, Card, Chip, ChipRow, confirm, Field, H1, H2, Muted, Screen, tell } from '@/components/ui';
import * as api from '@/lib/api';
import { loadDemoData, removeDemoData } from '@/lib/demo';
import { notificationsSupported, notifyNow } from '@/lib/notifications';
import { errorMessage, isDemo } from '@/lib/supabase';
import { C, S } from '@/lib/theme';
import { useAuth } from '@/state/auth';
import { usePlanner } from '@/state/planner';

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

export default function Me() {
  const { userId, profile, refreshProfile, signOut, email } = useAuth();
  const { classes, refresh, demoMode, setDemoMode } = usePlanner();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [goals, setGoals] = useState(profile?.goals ?? '');
  const [struggles, setStruggles] = useState(profile?.struggles ?? '');
  const [busy, setBusy] = useState<string | null>(null);

  async function save(patch: Parameters<typeof api.updateProfile>[1], label = 'profile') {
    if (!userId) return;
    setBusy(label);
    try {
      await api.updateProfile(userId, patch);
      await refreshProfile();
    } catch (e) {
      tell('Could not save', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function demo(load: boolean) {
    if (!userId) return;
    setBusy(load ? 'demo' : 'undemo');
    try {
      if (load) {
        const n = await loadDemoData(classes);
        tell('Demo week loaded', `${n} sample tasks added. Remove them here anytime.`);
      } else {
        await removeDemoData(userId);
      }
      await refresh();
    } catch (e) {
      tell('Demo data error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!profile) return null;

  return (
    <Screen>
      <H1>Me</H1>
      {isDemo ? <DemoBanner /> : <Muted>{email}</Muted>}

      <Card>
        <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
        <Field label="What I want from the app" value={goals} onChangeText={setGoals} multiline maxLength={500} />
        <Field label="What I struggle with" value={struggles} onChangeText={setStruggles} multiline maxLength={500} />
        <Muted>Your AI game plan uses these answers to tailor its tips.</Muted>
        <Button
          title="Save profile"
          kind="secondary"
          busy={busy === 'profile'}
          onPress={() =>
            save({ display_name: name.trim().slice(0, 60), goals: goals.trim() || null, struggles: struggles.trim() || null })
          }
        />
      </Card>

      <H2>Classes</H2>
      <ClassEditor />

      <H2>Alerts</H2>
      <Card>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.strong}>Quiet hours</Text>
            <Muted>No pepper alerts while you sleep. Anything urgent pings you when quiet hours end.</Muted>
          </View>
          <Switch
            value={profile.quiet_hours_enabled}
            onValueChange={(v) => save({ quiet_hours_enabled: v }, 'quiet')}
            trackColor={{ true: C.primary }}
          />
        </View>
        {profile.quiet_hours_enabled && (
          <>
            <Text style={styles.strong}>Starts</Text>
            <ChipRow>
              {[21, 22, 23].map((h) => (
                <Chip key={h} label={hourLabel(h)} selected={profile.quiet_start === h} onPress={() => save({ quiet_start: h }, 'quiet')} />
              ))}
            </ChipRow>
            <Text style={styles.strong}>Ends</Text>
            <ChipRow>
              {[6, 7, 8].map((h) => (
                <Chip key={h} label={hourLabel(h)} selected={profile.quiet_end === h} onPress={() => save({ quiet_end: h }, 'quiet')} />
              ))}
            </ChipRow>
          </>
        )}
        {notificationsSupported ? (
          <Button
            title="Send a test alert"
            kind="secondary"
            icon="notifications-outline"
            onPress={() => notifyNow('👻 Ghost Pepper test', 'This is what a max-heat alert looks like.')}
          />
        ) : (
          <Muted>Pepper alerts run on the phone app (Expo Go). The web version shows levels only.</Muted>
        )}
      </Card>

      <H2>Demo tools</H2>
      <Card>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.strong}>Demo clock</Text>
            <Muted>Adds a time-warp bar on Today so you can show tasks heating up.</Muted>
          </View>
          <Switch value={demoMode} onValueChange={setDemoMode} trackColor={{ true: C.primary }} />
        </View>
        <Button title="Load a demo week" kind="secondary" icon="flask-outline" busy={busy === 'demo'} onPress={() => demo(true)} />
        <Button
          title="Remove demo tasks"
          kind="ghost"
          busy={busy === 'undemo'}
          onPress={async () => {
            if (await confirm('Remove demo tasks?', 'Only tasks added by "Load a demo week" are removed.', 'Remove', true)) demo(false);
          }}
        />
      </Card>

      <H2>About</H2>
      <Card>
        <Muted>
          Pepper levels come from a formula on your phone (weight × time left, adjusted for your workload). AI is used
          for reading assignment photos (Claude Haiku) and writing your game plan (Claude Sonnet).
        </Muted>
        {isDemo && (
          <Muted>
            In this demo both are simulated on {DEMO_PLACE}: no photo or task is sent anywhere, and the classmate in the
            sample group is pretend.
          </Muted>
        )}
        <Muted>For students 13 and older.</Muted>
      </Card>

      {isDemo ? (
        <Button
          title="Reset demo"
          kind="secondary"
          icon="trash-outline"
          onPress={async () => {
            const ok = await confirm(
              'Reset demo?',
              `Erase everything this demo stored in ${DEMO_PLACE}? You can start a fresh demo afterwards.`,
              'Erase',
              true,
            );
            if (ok) signOut();
          }}
        />
      ) : (
        <Button
          title="Sign out"
          kind="secondary"
          icon="log-out-outline"
          onPress={async () => {
            if (await confirm('Sign out?', 'Scheduled alerts on this phone stay until you sign back in.', 'Sign out')) signOut();
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  strong: { fontWeight: '700', color: C.text, fontSize: 15 },
});
