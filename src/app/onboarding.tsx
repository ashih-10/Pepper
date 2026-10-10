/**
 * First launch: name → school level → classes + colors → goals & struggles →
 * (optional) join a friend's group → blank calendar.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ClassEditor } from '@/components/class-editor';
import { Button, Chip, ChipRow, Field, H1, Muted, Screen, tell } from '@/components/ui';
import * as api from '@/lib/api';
import { setupNotifications } from '@/lib/notifications';
import { errorMessage } from '@/lib/supabase';
import { C, S } from '@/lib/theme';
import type { EducationLevel } from '@/lib/types';
import { useAuth } from '@/state/auth';
import { usePlanner } from '@/state/planner';

const GRADES: Record<EducationLevel, string[]> = {
  middle: ['6', '7', '8'],
  high: ['9', '10', '11', '12'],
  college: ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Grad'],
};

const GOAL_IDEAS = ['Stop missing deadlines', 'Raise my GPA', 'Balance school and sports', 'Less last-minute stress'];
const STRUGGLE_IDEAS = ['Procrastinating', 'Long projects', 'Too many tests at once', 'Remembering homework'];

const STEPS = ['About you', 'Your classes', 'Your goals', 'Join a group'];

export default function Onboarding() {
  const { userId, profile, refreshProfile } = useAuth();
  const { classes, refresh } = usePlanner();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [level, setLevel] = useState<EducationLevel | null>(profile?.education_level ?? 'high');
  const [grade, setGrade] = useState<string | null>(profile?.grade ?? null);
  const [goals, setGoals] = useState(profile?.goals ?? '');
  const [struggles, setStruggles] = useState(profile?.struggles ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const append = (cur: string, idea: string) => (cur.includes(idea) ? cur : cur ? `${cur}, ${idea}` : idea);

  async function next() {
    if (step === 0 && !name.trim()) return tell('What should we call you?');
    if (step < STEPS.length - 1) return setStep(step + 1);
    await finish();
  }

  async function joinNow() {
    if (code.trim().length < 6) return tell('Codes are 6 characters.');
    setBusy(true);
    try {
      const g = await api.joinGroup(code, null);
      await refresh();
      setCode('');
      tell(`Joined ${g.name}`, 'You can link it to one of your classes on the Groups tab.');
    } catch (e) {
      tell('Could not join', errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!userId) return;
    setBusy(true);
    try {
      await api.updateProfile(userId, {
        display_name: name.trim().slice(0, 60),
        education_level: level,
        grade,
        goals: goals.trim().slice(0, 500) || null,
        struggles: struggles.trim().slice(0, 500) || null,
        onboarded: true,
      });
      setupNotifications().catch(() => {});
      await refreshProfile();
    } catch (e) {
      tell('Could not save', errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.progress}>
        {STEPS.map((s, i) => (
          <View key={s} style={[styles.pip, i <= step && { backgroundColor: C.primary }]} />
        ))}
      </View>
      <Muted>
        Step {step + 1} of {STEPS.length}
      </Muted>
      <H1>{STEPS[step]}</H1>

      {step === 0 && (
        <>
          <Field label="Your name" value={name} onChangeText={setName} placeholder="First name is fine" autoFocus />
          <Text style={styles.label}>School level</Text>
          <ChipRow>
            {(['middle', 'high', 'college'] as const).map((l) => (
              <Chip
                key={l}
                label={l === 'middle' ? 'Middle school' : l === 'high' ? 'High school' : 'College'}
                selected={level === l}
                onPress={() => {
                  setLevel(l);
                  setGrade(null);
                }}
              />
            ))}
          </ChipRow>
          {level && (
            <>
              <Text style={styles.label}>Grade</Text>
              <ChipRow>
                {GRADES[level].map((g) => (
                  <Chip key={g} label={g} selected={grade === g} onPress={() => setGrade(g)} />
                ))}
              </ChipRow>
            </>
          )}
        </>
      )}

      {step === 1 && (
        <>
          <Muted>Add each class and pick a color. Your calendar uses these colors to show where work piles up.</Muted>
          <ClassEditor />
        </>
      )}

      {step === 2 && (
        <>
          <Muted>Optional. Your AI game plan uses these to give you tips that fit you.</Muted>
          <Field label="What do you want this app to help with?" value={goals} onChangeText={setGoals} multiline />
          <ChipRow>
            {GOAL_IDEAS.map((g) => (
              <Chip key={g} label={`+ ${g}`} onPress={() => setGoals(append(goals, g))} />
            ))}
          </ChipRow>
          <Field label="What do you struggle with?" value={struggles} onChangeText={setStruggles} multiline />
          <ChipRow>
            {STRUGGLE_IDEAS.map((g) => (
              <Chip key={g} label={`+ ${g}`} onPress={() => setStruggles(append(struggles, g))} />
            ))}
          </ChipRow>
        </>
      )}

      {step === 3 && (
        <>
          <Muted>
            Got a code from a friend? Join their group and shared deadlines show up in your list automatically. You can
            also do this later.
          </Muted>
          <Field
            label="Group code"
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            autoCapitalize="characters"
            maxLength={6}
            placeholder="ABC234"
          />
          <Button title="Join group" kind="secondary" icon="people" onPress={joinNow} busy={busy && code.length > 0} />
        </>
      )}

      <View style={styles.nav}>
        {step > 0 && <Button title="Back" kind="secondary" onPress={() => setStep(step - 1)} style={{ flex: 1 }} />}
        <Button
          title={step === STEPS.length - 1 ? "Let's go" : step === 1 && classes.length === 0 ? 'Skip for now' : 'Next'}
          onPress={next}
          busy={busy && step === STEPS.length - 1}
          style={{ flex: 2 }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: S.sm },
  pip: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.border },
  label: { fontWeight: '700', color: C.text, fontSize: 14 },
  nav: { flexDirection: 'row', gap: S.md, marginTop: S.lg },
});
