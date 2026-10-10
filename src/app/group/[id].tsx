/** One group: invite code, class link, shared tasks, members, activity feed. */
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { TaskCard } from '@/components/task-card';
import { Button, Card, Chip, ChipRow, confirm, Empty, H2, Muted, Screen, tell } from '@/components/ui';
import { goBack } from '@/lib/nav';
import * as api from '@/lib/api';
import { formatDue, formatRelative } from '@/lib/dates';
import { errorMessage } from '@/lib/supabase';
import { C, S } from '@/lib/theme';
import type { ActivityRow } from '@/lib/types';
import { useAuth } from '@/state/auth';
import { usePlanner } from '@/state/planner';

export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const { groups, members, names, tasks, classes, myMembership, refresh, now } = usePlanner();
  const [feed, setFeed] = useState<ActivityRow[]>([]);
  const group = groups.find((g) => g.id === id);
  const mine = myMembership(id);
  const isOwner = group?.owner_id === userId;
  const roster = members.filter((m) => m.group_id === id);
  const shared = tasks.filter((t) => t.group_id === id);
  const latestTaskChange = shared.map((t) => t.updated_at).sort().at(-1) ?? '';

  const loadFeed = useCallback(() => {
    api.loadActivity(id).then(setFeed).catch(() => {});
  }, [id]);
  useEffect(loadFeed, [loadFeed, latestTaskChange, roster.length]);

  if (!group) {
    return (
      <Screen edges={['bottom']}>
        <Empty emoji="👋" title="Not in this group" body="You left it, or it was deleted." />
        <Button title="Back" kind="secondary" onPress={() => goBack()} />
      </Screen>
    );
  }

  const open = shared.filter((t) => t.score.state === 'active' || t.score.state === 'overdue');
  const closed = shared.filter((t) => !open.includes(t));
  const invite = `Join my group "${group.name}" on Pepper Planner. Code: ${group.join_code}`;

  async function act(fn: () => Promise<unknown>, after?: () => void) {
    try {
      await fn();
      await refresh();
      after?.();
    } catch (e) {
      tell('Something went wrong', errorMessage(e));
    }
  }

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: group.name }} />

      <Card style={styles.invite}>
        <Muted>Invite code</Muted>
        <Text style={styles.code} selectable>
          {group.join_code}
        </Text>
        <ChipRow>
          <Chip
            label="Copy"
            icon="copy-outline"
            onPress={() => Clipboard.setStringAsync(group.join_code).then(() => tell('Copied', group.join_code))}
          />
          <Chip label="Share" icon="share-outline" onPress={() => Share.share({ message: invite }).catch(() => {})} />
        </ChipRow>
      </Card>

      {classes.length > 0 && (
        <Card>
          <Text style={styles.label}>Show this group&apos;s tasks in my class color</Text>
          <ChipRow>
            {classes.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                color={c.color}
                selected={mine?.class_id === c.id}
                onPress={() => act(() => api.setGroupClass(id, userId!, mine?.class_id === c.id ? null : c.id))}
              />
            ))}
          </ChipRow>
        </Card>
      )}

      <H2
        right={
          <Button
            title="Add shared task"
            icon="add"
            kind="ghost"
            onPress={() => router.push({ pathname: '/task/new', params: { group: id } })}
          />
        }>
        Shared tasks
      </H2>
      {open.length === 0 && <Muted>No open shared tasks. Add the next test or due date for everyone.</Muted>}
      {open.map((t) => (
        <TaskCard key={t.id} task={t} showDate />
      ))}
      {closed.slice(0, 10).map((t) => (
        <TaskCard key={t.id} task={t} showDate />
      ))}

      <H2>Members ({roster.length})</H2>
      <Card>
        {roster.map((m) => (
          <View key={m.user_id} style={styles.member}>
            <Ionicons name={m.role === 'owner' ? 'star' : 'person'} size={16} color={m.role === 'owner' ? C.warn : C.muted} />
            <Text style={styles.memberName}>
              {names.get(m.user_id) || 'Student'}
              {m.user_id === userId ? ' (you)' : ''}
            </Text>
            {isOwner && m.user_id !== userId && (
              <Pressable
                hitSlop={8}
                onPress={async () => {
                  if (await confirm('Remove member?', `${names.get(m.user_id) ?? 'They'} will stop seeing this group.`, 'Remove', true)) {
                    act(() => api.removeMember(id, m.user_id));
                  }
                }}>
                <Text style={{ color: C.danger, fontWeight: '700' }}>Remove</Text>
              </Pressable>
            )}
          </View>
        ))}
      </Card>

      <H2>Activity</H2>
      <Card>
        {feed.length === 0 ? <Muted>No activity yet.</Muted> : feed.map((a) => <FeedLine key={a.id} a={a} name={names.get(a.actor_id ?? '') ?? 'Someone'} now={now} />)}
      </Card>

      <Button
        title="Leave group"
        kind="secondary"
        icon="exit-outline"
        onPress={async () => {
          const msg = isOwner && roster.length > 1 ? 'Ownership passes to the next member.' : 'Shared tasks will disappear from your list.';
          if (await confirm('Leave this group?', msg, 'Leave', true)) act(() => api.leaveGroup(id), () => goBack());
        }}
      />
      {isOwner && (
        <Button
          title="Delete group"
          kind="ghost"
          icon="trash-outline"
          onPress={async () => {
            if (await confirm('Delete group for everyone?', 'Members will be offered copies of unfinished tasks.', 'Delete', true)) {
              act(() => api.deleteGroup(id), () => goBack());
            }
          }}
        />
      )}
    </Screen>
  );
}

function FeedLine({ a, name, now }: { a: ActivityRow; name: string; now: Date }) {
  const p = a.payload as Record<string, string | null>;
  const t = a.task_title ?? 'a task';
  const text: Record<ActivityRow['kind'], string> = {
    task_added: `added ${t}`,
    task_edited: `edited ${t}`,
    due_changed: p.to ? `moved ${t} to ${formatDue(new Date(p.to), now)}` : `changed the date of ${t}`,
    type_changed: `changed ${t} to ${p.to === 'custom' ? (p.label ?? 'custom') : p.to}`,
    task_deleted: `removed ${t}`,
    member_joined: 'joined the group',
    member_left: 'left the group',
    member_removed: 'removed a member',
  };
  const alert = a.kind === 'due_changed' || a.kind === 'type_changed' || a.kind === 'task_deleted';
  return (
    <View style={styles.feed}>
      <Ionicons name={alert ? 'notifications' : 'ellipse'} size={alert ? 14 : 8} color={alert ? C.warn : C.faint} />
      <Text style={styles.feedText}>
        <Text style={{ fontWeight: '700' }}>{name}</Text> {text[a.kind]}
      </Text>
      <Text style={styles.feedTime}>{formatRelative(new Date(a.created_at), now).replace(' late', ' ago')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  invite: { alignItems: 'center' },
  code: { fontSize: 36, fontWeight: '900', letterSpacing: 6, color: C.primary },
  label: { fontWeight: '700', color: C.text, fontSize: 14 },
  member: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 4 },
  memberName: { flex: 1, color: C.text, fontSize: 15, fontWeight: '600' },
  feed: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 4 },
  feedText: { flex: 1, color: C.text, fontSize: 14 },
  feedTime: { color: C.faint, fontSize: 12 },
});
