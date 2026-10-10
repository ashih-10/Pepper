/** Home: day-by-day view. Today's items first (hottest first), then what's coming. */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DayStrip } from '@/components/calendar';
import { TaskCard } from '@/components/task-card';
import { GamePlanCard, RescueOffers, StackedCallout, TimeWarp } from '@/components/today-widgets';
import { Banner, Button, Empty, H2, Loading, Muted } from '@/components/ui';
import { formatDate, sameDay } from '@/lib/dates';
import { PEPPERS } from '@/lib/pepper';
import { dayView, dotsByDay, planCandidates } from '@/lib/selectors';
import { C, S } from '@/lib/theme';
import { useAuth } from '@/state/auth';
import { usePlanner } from '@/state/planner';

export default function Today() {
  const { profile } = useAuth();
  const { tasks, now, loading, error, refresh, rescues } = usePlanner();
  const [picked, setPicked] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const day = picked ?? now;
  const isToday = sameDay(day, now);

  const view = useMemo(() => dayView(tasks, day, now), [tasks, day, now]);
  const dots = useMemo(() => dotsByDay(tasks), [tasks]);
  const ghosts = view.due.filter((t) => t.score.level === 'ghost').length;

  if (loading) return <Loading />;

  const first = profile?.display_name?.split(' ')[0];
  const summary = view.due.length
    ? `${view.due.length} due${isToday ? ' today' : ''}${ghosts ? ` · ${ghosts} ${PEPPERS.ghost.emoji}` : ''}`
    : isToday
      ? 'Nothing due today'
      : 'Nothing due this day';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }>
        <View style={styles.inner}>
          <View>
            <Muted>{isToday ? formatDate(now) : 'Planning ahead'}</Muted>
            <Text style={styles.h1}>{isToday ? `Hi${first ? `, ${first}` : ''} 👋` : formatDate(day)}</Text>
            <Muted>{summary}</Muted>
          </View>

          <TimeWarp />
          {error && <Banner tone="warn" icon="cloud-offline-outline">{error}</Banner>}
          <RescueOffers rescues={rescues} />

          <DayStrip today={now} selected={day} onSelect={(d) => setPicked(sameDay(d, now) ? null : d)} dots={dots} />

          {tasks.length === 0 ? (
            <>
              <Empty
                emoji="🫑"
                title="Your calendar is ready"
                body="Add your first task, or snap a photo of an assignment sheet and let AI fill it in."
              />
              <Button title="Add a task" icon="add" onPress={() => router.push('/task/new')} />
              <Button
                title="Scan an assignment"
                icon="camera"
                kind="secondary"
                onPress={() => router.push({ pathname: '/task/new', params: { scan: '1' } })}
              />
            </>
          ) : (
            <>
              {isToday && view.hot.length >= 2 && <StackedCallout hot={view.hot} />}
              {isToday && planCandidates(tasks).length > 0 && <GamePlanCard tasks={planCandidates(tasks)} />}

              <H2>{isToday ? 'Due today' : `Due ${formatDate(day)}`}</H2>
              {view.due.length === 0 ? (
                <Muted>{isToday ? 'Nothing due today. Get ahead on what is heating up below.' : 'Nothing due.'}</Muted>
              ) : (
                view.due.map((t) => <TaskCard key={t.id} task={t} />)
              )}

              {isToday && view.upcoming.length > 0 && (
                <>
                  <H2>Coming up</H2>
                  {view.upcoming.slice(0, 25).map((t) => (
                    <TaskCard key={t.id} task={t} showDate />
                  ))}
                </>
              )}

              {view.done.length > 0 && (
                <>
                  <H2>Done {isToday ? 'today' : 'this day'} 🥛</H2>
                  {view.done.map((t) => (
                    <TaskCard key={t.id} task={t} showDate />
                  ))}
                </>
              )}
            </>
          )}
          <View style={{ height: 96 }} />
        </View>
      </ScrollView>

      <View style={styles.fabRow} pointerEvents="box-none">
        <Pressable
          style={[styles.fab, styles.fabSecondary]}
          onPress={() => router.push({ pathname: '/task/new', params: { scan: '1' } })}
          accessibilityLabel="Scan an assignment">
          <Ionicons name="camera" size={24} color={C.primary} />
        </Pressable>
        <Pressable style={styles.fab} onPress={() => router.push('/task/new')} accessibilityLabel="Add a task">
          <Ionicons name="add" size={30} color="#fff" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { flexGrow: 1 },
  inner: { padding: S.lg, gap: S.md, width: '100%', maxWidth: 720, alignSelf: 'center' },
  h1: { fontSize: 28, fontWeight: '900', color: C.text },
  fabRow: { position: 'absolute', right: S.lg, bottom: S.lg, flexDirection: 'row', gap: S.md, alignItems: 'center' },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabSecondary: { backgroundColor: C.card, width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.border },
});
