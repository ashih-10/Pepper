/** Student-run groups: one person logs a shared deadline, it lands in everyone's list. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DemoBanner } from '@/components/demo-banner';
import { Button, Card, Chip, ChipRow, Empty, Field, H1, H2, Muted, Screen, tell } from '@/components/ui';
import * as api from '@/lib/api';
import { CLASSMATE_ID, CLASSMATE_NAME, DEMO_GROUP_CODE } from '@/lib/local/constants';
import { errorMessage } from '@/lib/supabase';
import { C, R, S } from '@/lib/theme';
import { usePlanner } from '@/state/planner';

export default function Groups() {
  const { groups, members, tasks, classes, classById, myMembership, refresh } = usePlanner();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [classId, setClassId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  async function create() {
    if (!name.trim()) return tell('Name your group, e.g. "AP Chem, Period 3".');
    setBusy('create');
    try {
      const g = await api.createGroup(name, classId);
      setName('');
      await refresh();
      router.push({ pathname: '/group/[id]', params: { id: g.id } });
    } catch (e) {
      tell('Could not create group', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function join() {
    if (code.trim().length !== 6) return tell('Group codes are 6 characters.');
    setBusy('join');
    try {
      const g = await api.joinGroup(code, classId);
      setCode('');
      await refresh();
      router.push({ pathname: '/group/[id]', params: { id: g.id } });
    } catch (e) {
      tell('Could not join', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <H1>Groups</H1>
      <Muted>
        Make a group for a class, project team or study group. Anyone in it can add a shared deadline, and it shows up
        in everyone&apos;s list, ranked against their own workload.
      </Muted>

      {!groups.some((g) => g.owner_id === CLASSMATE_ID) && (
        <DemoBanner>{`Try it: join ${CLASSMATE_NAME}'s group with code ${DEMO_GROUP_CODE}.`}</DemoBanner>
      )}

      {groups.length === 0 ? (
        <Empty emoji="👥" title="No groups yet" body="Create one and send the code to a classmate, or join theirs." />
      ) : (
        groups.map((g) => {
          const mine = myMembership(g.id);
          const cls = classById(mine?.class_id ?? null);
          const count = members.filter((m) => m.group_id === g.id).length;
          const open = tasks.filter((t) => t.group_id === g.id && (t.score.state === 'active' || t.score.state === 'overdue')).length;
          return (
            <Pressable
              key={g.id}
              onPress={() => router.push({ pathname: '/group/[id]', params: { id: g.id } })}
              style={({ pressed }) => [styles.group, pressed && { opacity: 0.85 }]}>
              <View style={[styles.groupIcon, { backgroundColor: cls?.color ?? C.primarySoft }]}>
                <Ionicons name="people" size={20} color={cls ? '#fff' : C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.groupName}>{g.name}</Text>
                <Muted>
                  {count} member{count === 1 ? '' : 's'} · {open} open task{open === 1 ? '' : 's'}
                  {mine?.role === 'owner' ? ' · owner' : ''}
                </Muted>
              </View>
              <Ionicons name="chevron-forward" size={20} color={C.faint} />
            </Pressable>
          );
        })
      )}

      <H2>Create or join</H2>
      <Card>
        {classes.length > 0 && (
          <>
            <Text style={styles.label}>Which of your classes is this for? (sets its color)</Text>
            <ChipRow>
              {classes.map((c) => (
                <Chip key={c.id} label={c.name} color={c.color} selected={classId === c.id} onPress={() => setClassId(classId === c.id ? null : c.id)} />
              ))}
            </ChipRow>
          </>
        )}
        <Field label="New group name" value={name} onChangeText={setName} placeholder="AP Chem, Period 3" maxLength={60} />
        <Button title="Create group" icon="add-circle" onPress={create} busy={busy === 'create'} />
        <View style={styles.divider} />
        <Field
          label="Have a code?"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          autoCapitalize="characters"
          maxLength={6}
          placeholder="ABC234"
        />
        <Button title="Join group" icon="enter-outline" kind="secondary" onPress={join} busy={busy === 'join'} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    backgroundColor: C.card,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
    padding: S.md,
  },
  groupIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  groupName: { fontSize: 16, fontWeight: '800', color: C.text },
  label: { fontWeight: '700', color: C.text, fontSize: 14 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: S.sm },
});
