/** Task details: pepper level and why, check-off, edit, delete, stop repeating. */
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HeatBar, PepperBadge, typeLabel } from '@/components/pepper';
import { TaskForm } from '@/components/task-form';
import { Banner, Button, Card, confirm, Empty, Loading, Muted, Screen, tell } from '@/components/ui';
import { goBack } from '@/lib/nav';
import * as api from '@/lib/api';
import { formatDue, formatRelative } from '@/lib/dates';
import { errorMessage } from '@/lib/supabase';
import { draftToInput, rowToDraft } from '@/lib/drafts';
import { explain } from '@/lib/pepper';
import { describeRecurrence } from '@/lib/recurrence';
import { C, S } from '@/lib/theme';
import { useAuth } from '@/state/auth';
import { usePlanner } from '@/state/planner';

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const { taskById, toggleComplete, refresh, now, groups, names, loading } = usePlanner();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'delete' | 'stop' | null>(null);
  const task = taskById(id);

  if (loading) return <Loading />;
  if (!task) {
    return (
      <Screen edges={['bottom']}>
        <Empty emoji="🫥" title="Task not found" body="It may have been deleted or removed from a group." />
        <Button title="Back" kind="secondary" onPress={() => goBack()} />
      </Screen>
    );
  }

  const due = new Date(task.due_at);
  const done = task.completed_at !== null;
  const group = groups.find((g) => g.id === task.group_id);
  const canDelete = task.created_by === userId || group?.owner_id === userId;
  const repeat = describeRecurrence(task.recurrence);
  // Only the series' creator generates its instances, so only they can end it.
  const canStop = !!task.series_id && task.created_by === userId && !!task.recurrence && !task.recurrence.until;

  async function remove() {
    const msg = task!.group_id
      ? 'It will be removed for everyone in the group. They can keep a copy.'
      : repeat
        ? 'This deletes only this one; other repeats stay.'
        : 'This cannot be undone.';
    if (!(await confirm('Delete this task?', msg, 'Delete', true))) return;
    setBusy('delete');
    try {
      const ok = await api.deleteTask(task!.id);
      if (!ok) throw new Error('Only the person who added it or the group owner can delete it.');
      await refresh();
      goBack();
    } catch (e) {
      tell('Could not delete', e instanceof Error ? e.message : undefined);
      setBusy(null);
    }
  }

  async function stopRepeating() {
    const msg = task!.group_id
      ? 'Later repeats are removed for everyone in the group. This one and earlier ones stay.'
      : 'Later repeats are removed. This one and earlier ones stay.';
    if (!(await confirm('Stop repeating?', msg, 'Stop repeating', true))) return;
    setBusy('stop');
    try {
      await api.stopSeries(task!.series_id!, new Date(task!.due_at));
      await refresh();
    } catch (e) {
      tell('Could not stop it', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    try {
      await toggleComplete(task!.id);
    } catch {
      tell('Could not update that task.');
    }
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: typeLabel(task) }} />
      <Card>
        <View style={styles.headRow}>
          <View style={[styles.stripe, { backgroundColor: task.color }]} />
          <Text style={[styles.title, done && styles.struck]}>{task.title}</Text>
        </View>
        <Text style={styles.due}>
          Due {formatDue(due, now)} · {formatRelative(due, now)}
        </Text>
        <Muted>
          {[typeLabel(task), task.class_name, task.weight_pct ? `${task.weight_pct}% of grade` : null, repeat]
            .filter(Boolean)
            .join(' · ')}
        </Muted>
        <View style={{ alignItems: 'flex-start', marginTop: S.sm }}>
          <PepperBadge task={task} size="lg" />
        </View>
        {task.score.state === 'active' && <HeatBar heat={task.score.heat} />}
        <Text style={styles.why}>{explain(task.score)}</Text>
      </Card>

      {group && (
        <Banner tone="info" icon="people">
          <Text style={{ color: C.text }}>
            Shared in <Text style={{ fontWeight: '700' }}>{group.name}</Text>
            {task.created_by !== userId && names.get(task.created_by) ? ` · added by ${names.get(task.created_by)}` : ''}.
            Checking it off only checks it off for you.
          </Text>
        </Banner>
      )}

      <Button
        title={done ? 'Mark as not done' : 'Done! Drink the milk 🥛'}
        kind={done ? 'secondary' : 'primary'}
        icon={done ? 'arrow-undo' : undefined}
        onPress={check}
      />

      {editing ? (
        <Card>
          {group && <Muted>Edits are shared. Changing the date or type sends everyone in {group.name} an alert.</Muted>}
          <TaskForm
            initial={rowToDraft(task)}
            allowRepeat={false}
            allowGroupChange={task.created_by === userId}
            timeChosen
            editingTaskId={task.id}
            submitLabel="Save changes"
            onSubmit={async (d) => {
              await api.updateTask(task.id, draftToInput(d));
              await refresh();
              setEditing(false);
            }}
            secondary={<Button title="Cancel" kind="ghost" onPress={() => setEditing(false)} />}
          />
        </Card>
      ) : (
        <Button title="Edit task" icon="create-outline" kind="secondary" onPress={() => setEditing(true)} />
      )}

      {task.notes && !editing && (
        <Card>
          <Text style={{ fontWeight: '700', color: C.text }}>Notes</Text>
          <Text style={{ color: C.text }}>{task.notes}</Text>
        </Card>
      )}

      {canStop && !editing && (
        <Button title="Stop repeating" icon="repeat-outline" kind="ghost" onPress={stopRepeating} busy={busy === 'stop'} />
      )}
      {canDelete && !editing && (
        <Button title="Delete task" icon="trash-outline" kind="ghost" onPress={remove} busy={busy === 'delete'} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', gap: S.md, alignItems: 'center' },
  stripe: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  title: { flex: 1, fontSize: 22, fontWeight: '900', color: C.text },
  struck: { textDecorationLine: 'line-through', color: C.faint },
  due: { fontSize: 16, fontWeight: '700', color: C.text },
  why: { color: C.muted, fontSize: 14, lineHeight: 20 },
});
