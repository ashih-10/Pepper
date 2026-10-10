/**
 * One task in a list. Checking it off pours a glass of milk over the card:
 * the milk rises, the pepper cools, then the task resolves with a strikethrough.
 */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDue, formatRelative } from '@/lib/dates';
import { C, R, S } from '@/lib/theme';
import type { ScoredTask } from '@/state/planner';
import { usePlanner } from '@/state/planner';

import { PepperBadge, typeLabel } from './pepper';
import { tell } from './ui';

const native = Platform.OS !== 'web';

export function TaskCard({ task, showDate = false }: { task: ScoredTask; showDate?: boolean }) {
  const { toggleComplete, now } = usePlanner();
  const [height, setHeight] = useState(80);
  const [pouring, setPouring] = useState(false);
  const [milk] = useState(() => new Animated.Value(0));
  const [glass] = useState(() => new Animated.Value(0));
  const done = task.completed_at !== null;
  const due = new Date(task.due_at);

  async function onCheck() {
    if (pouring) return;
    if (done) {
      toggleComplete(task.id).catch(() => tell('Could not update that task.'));
      return;
    }
    setPouring(true);
    if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    milk.setValue(0);
    glass.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(glass, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(2)), useNativeDriver: native }),
        Animated.timing(milk, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      ]),
      Animated.delay(250),
    ]).start(() => {
      toggleComplete(task.id)
        .catch(() => tell('Could not check that off. Try again.'))
        .finally(() => {
          setPouring(false);
          milk.setValue(0);
          glass.setValue(0);
        });
    });
  }

  const milkY = milk.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });
  const glassScale = glass.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const glassTilt = milk.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-35deg'] });

  const meta = [
    typeLabel(task),
    task.class_name,
    showDate ? formatDue(due, now) : formatDue(due, now).replace(/^(Today|Tomorrow) /, ''),
  ]
    .filter(Boolean)
    .join(' · ');
  const late = task.score.state === 'overdue';

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
      accessibilityLabel={`${task.title}, ${meta}`}>
      <View style={[styles.stripe, { backgroundColor: task.color }]} />
      <Pressable
        onPress={onCheck}
        hitSlop={12}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? 'Mark not done' : 'Check off with a glass of milk'}
        style={[styles.check, done && styles.checkDone]}>
        {done && <Ionicons name="checkmark" size={18} color="#fff" />}
      </Pressable>
      <View style={styles.body}>
        <Text style={[styles.title, done && styles.struck]} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={[styles.meta, done && { color: C.faint }]} numberOfLines={2}>
          {meta}
        </Text>
        {(task.group_name || late) && (
          <View style={styles.tags}>
            {task.group_name && (
              <View style={styles.tag}>
                <Ionicons name="people" size={12} color={C.muted} />
                <Text style={styles.tagText}>{task.group_name}</Text>
              </View>
            )}
            {late && !done && <Text style={[styles.tagText, { color: C.danger }]}>{formatRelative(due, now)}</Text>}
          </View>
        )}
      </View>
      <PepperBadge task={task} />

      {pouring && (
        <>
          <Animated.View pointerEvents="none" style={[styles.milk, { transform: [{ translateY: milkY }] }]} />
          <Animated.Text
            pointerEvents="none"
            style={[styles.glass, { transform: [{ scale: glassScale }, { rotate: glassTilt }] }]}>
            🥛
          </Animated.Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    backgroundColor: C.card,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: S.md,
    paddingRight: S.md,
    paddingLeft: S.lg + 2,
    overflow: 'hidden',
    position: 'relative',
  },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6 },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: C.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: C.success, borderColor: C.success },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '700', color: C.text },
  struck: { textDecorationLine: 'line-through', color: C.faint },
  meta: { fontSize: 13, color: C.muted },
  tags: { flexDirection: 'row', gap: S.sm, marginTop: 2, alignItems: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagText: { fontSize: 12, color: C.muted, fontWeight: '600' },
  milk: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#FFFDF7',
    borderTopWidth: 3,
    borderTopColor: '#F3EDE2',
  },
  glass: { position: 'absolute', alignSelf: 'center', left: '45%', fontSize: 38 },
});
