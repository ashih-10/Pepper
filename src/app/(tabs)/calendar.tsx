/** Month view: class-colored dots show where tests, quizzes and projects pile up. */
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MonthGrid } from '@/components/calendar';
import { TaskCard } from '@/components/task-card';
import { H1, H2, Muted, Screen } from '@/components/ui';
import { formatDate, sameDay } from '@/lib/dates';
import { dayView, dotsByDay } from '@/lib/selectors';
import { C, S } from '@/lib/theme';
import { usePlanner } from '@/state/planner';

export default function Calendar() {
  const { tasks, now, classes } = usePlanner();
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = useState<Date>(now);
  const dots = useMemo(() => dotsByDay(tasks), [tasks]);
  const view = useMemo(() => dayView(tasks, selected, now), [tasks, selected, now]);
  const list = [...view.due.filter((t) => sameDay(new Date(t.due_at), selected)), ...view.done];

  return (
    <Screen>
      <H1>Calendar</H1>
      <MonthGrid month={month} onMonth={setMonth} selected={selected} onSelect={setSelected} today={now} dots={dots} />
      {classes.length > 0 && (
        <View style={styles.legend}>
          {classes.map((c) => (
            <View key={c.id} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: c.color }]} />
              <Text style={styles.legendText}>{c.name}</Text>
            </View>
          ))}
        </View>
      )}
      <H2>{formatDate(selected)}</H2>
      {list.length === 0 ? <Muted>Nothing due this day.</Muted> : list.map((t) => <TaskCard key={t.id} task={t} />)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: S.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { color: C.muted, fontSize: 13, fontWeight: '600' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
