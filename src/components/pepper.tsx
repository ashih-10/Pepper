import { StyleSheet, Text, View } from 'react-native';

import { PEPPERS, THRESHOLDS } from '@/lib/pepper';
import { C, R } from '@/lib/theme';
import type { TaskType } from '@/lib/types';
import type { ScoredTask } from '@/state/planner';

export function typeLabel(t: { task_type: TaskType; custom_label: string | null }): string {
  switch (t.task_type) {
    case 'test':
      return 'Test';
    case 'quiz':
      return 'Quiz';
    case 'project':
      return 'Project';
    case 'homework':
      return 'Homework';
    case 'custom':
      return t.custom_label || 'Other';
  }
}

export function PepperBadge({ task, size = 'sm' }: { task: ScoredTask; size?: 'sm' | 'lg' }) {
  const { state, level } = task.score;
  let bg = '#BDBDBD';
  let text: string;
  if (state === 'done') text = '🥛 Cooled';
  else if (state === 'passed') text = '⏱ Passed';
  else {
    const info = PEPPERS[level!];
    bg = info.color;
    text = `${info.emoji} ${info.label}`;
  }
  return (
    <View style={[styles.badge, { backgroundColor: bg }, size === 'lg' && styles.badgeLg]}>
      <Text style={[styles.badgeText, size === 'lg' && { fontSize: 16 }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const BOUNDS = [0, THRESHOLDS.jalapeno, THRESHOLDS.serrano, THRESHOLDS.habanero, THRESHOLDS.ghost, 1];
const SPANS = BOUNDS.slice(1).map((b, i) => b - BOUNDS[i]);

/** Thermometer-style heat bar (0-100) used on the task screen. */
export function HeatBar({ heat }: { heat: number }) {
  const pct = Math.round(heat * 100);
  const levels = ['bell', 'jalapeno', 'serrano', 'habanero', 'ghost'] as const;
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.bar}>
        {levels.map((l, i) => (
          // segment widths match the real level thresholds, so the marker
          // always sits in the zone the badge names
          <View key={l} style={{ flex: SPANS[i], backgroundColor: PEPPERS[l].color, opacity: 0.85 }} />
        ))}
        <View style={[styles.marker, { left: `${Math.min(98, pct)}%` }]} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.scale}>🫑 mild</Text>
        <Text style={styles.scale}>heat {pct}/100</Text>
        <Text style={styles.scale}>👻 max</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4, maxWidth: 150 },
  badgeLg: { paddingHorizontal: 14, paddingVertical: 8, maxWidth: 220 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  bar: { height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: 'row', position: 'relative' },
  marker: {
    position: 'absolute',
    top: -3,
    width: 6,
    height: 20,
    marginLeft: -3,
    borderRadius: 3,
    backgroundColor: C.text,
    borderWidth: 2,
    borderColor: '#fff',
  },
  scale: { fontSize: 12, color: C.muted },
});
