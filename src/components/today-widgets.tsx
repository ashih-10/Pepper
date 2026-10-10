import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchGamePlan, type GamePlan } from '@/lib/ai';
import * as api from '@/lib/api';
import { formatDate, formatDue, formatTime, weekdayShort } from '@/lib/dates';
import { PEPPERS } from '@/lib/pepper';
import { C, R, S } from '@/lib/theme';
import type { RescueRow } from '@/lib/types';
import { usePlanner, type ScoredTask } from '@/state/planner';

import { typeLabel } from './pepper';
import { Banner, Button, Card, Chip, ChipRow, Muted, tell } from './ui';

/**
 * Stacked-urgency callout (PRD 5.7): when several hot tasks land on the same
 * day, show one calm ordered list instead of every alert screaming at once.
 */
export function StackedCallout({ hot }: { hot: ScoredTask[] }) {
  const ordered = [...hot].sort((a, b) => b.score.weight - a.score.weight || a.due_at.localeCompare(b.due_at));
  return (
    <Card style={{ borderColor: PEPPERS.ghost.color, borderWidth: 2 }}>
      <Text style={styles.calloutTitle}>
        You have {hot.length} urgent items today. Here&apos;s the order by weight.
      </Text>
      {ordered.map((t, i) => (
        <Pressable
          key={t.id}
          onPress={() => router.push({ pathname: '/task/[id]', params: { id: t.id } })}
          style={styles.calloutRow}>
          <Text style={styles.calloutNum}>{i + 1}</Text>
          <View style={[styles.dot, { backgroundColor: t.color }]} />
          <Text style={styles.calloutText} numberOfLines={1}>
            {t.title}
          </Text>
          <Text style={styles.calloutMeta}>{typeLabel(t)}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

/**
 * "Today's game plan": the formula's order, explained by Claude. The plan is
 * held by the Today screen so looking at another day doesn't throw it away.
 */
export function GamePlanCard({
  tasks,
  plan,
  setPlan,
}: {
  tasks: ScoredTask[];
  plan: GamePlan | null;
  setPlan: (p: GamePlan) => void;
}) {
  const { now } = usePlanner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const input = tasks.slice(0, 10).map((t) => ({
        id: t.id,
        title: t.title,
        kind: typeLabel(t),
        class_name: t.class_name,
        due: formatDue(new Date(t.due_at), now),
        pepper: t.score.level ? PEPPERS[t.score.level].label : 'n/a',
      }));
      setPlan(await fetchGamePlan(input, `${formatDate(now)} ${formatTime(now)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build a plan.');
    } finally {
      setBusy(false);
    }
  }

  if (!plan) {
    return (
      <View style={{ gap: S.sm }}>
        <Button title="Get my AI game plan" icon="sparkles" kind="secondary" onPress={load} busy={busy} />
        {error && <Muted>{error}</Muted>}
      </View>
    );
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // Steps for tasks finished since the plan was made drop out; renumber the rest.
  const steps = plan.steps.flatMap((s) => {
    const t = byId.get(s.task_id);
    return t ? [{ s, t }] : [];
  });
  return (
    <Card style={{ backgroundColor: '#FFFDF7' }}>
      <Text style={styles.planHead}>✨ {plan.headline}</Text>
      {steps.map(({ s, t }, i) => {
        return (
          <View key={s.task_id} style={styles.planStep}>
            <Text style={styles.calloutNum}>{i + 1}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.planTask}>
                {t.title} <Text style={styles.calloutMeta}>· {s.minutes} min</Text>
              </Text>
              <Text style={{ color: C.text }}>{s.tip}</Text>
            </View>
          </View>
        );
      })}
      <Muted>{plan.closing}</Muted>
      <Muted>AI suggestion. The order comes from the pepper formula.</Muted>
    </Card>
  );
}

/** Offers to keep a copy when a group task (or group) was deleted. */
export function RescueOffers({ rescues }: { rescues: RescueRow[] }) {
  const { refresh } = usePlanner();
  const [busy, setBusy] = useState<number | null>(null);
  // A ref, not state: a fast second tap arrives before the re-render.
  const inFlight = useRef(false);
  if (rescues.length === 0) return null;
  async function act(r: RescueRow, keep: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(r.id);
    try {
      if (keep) await api.copyRescue(r, null);
      else await api.dismissRescue(r.id);
      await refresh();
    } catch {
      tell('Could not update that. Try again.');
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }
  return (
    <>
      {rescues.slice(0, 3).map((r) => (
        <Banner
          key={r.id}
          tone="warn"
          icon="copy-outline"
          action={
            <ChipRow>
              <Chip label={busy === r.id ? 'Saving…' : 'Keep a copy'} selected onPress={() => act(r, true)} disabled={busy !== null} />
              <Chip label="Dismiss" onPress={() => act(r, false)} disabled={busy !== null} />
            </ChipRow>
          }>
          <Text style={{ color: C.text }}>
            <Text style={{ fontWeight: '700' }}>{r.snapshot.title}</Text>
            {r.reason === 'group_deleted' ? ` was in "${r.group_name}", which was deleted.` : ` was removed from "${r.group_name}".`}
            {' '}Keep it in your own list?
          </Text>
        </Banner>
      ))}
    </>
  );
}

/** Demo-only control: move "now" forward to show tasks heating up. */
export function TimeWarp() {
  const { demoMode, warpHours, setWarpHours, now } = usePlanner();
  if (!demoMode) return null;
  return (
    <Banner tone="info" icon="time-outline">
      <Text style={{ color: C.text, fontWeight: '700' }}>
        Demo clock: {weekdayShort(now)} {formatTime(now)}
        {warpHours ? ` (+${warpHours}h)` : ''}
      </Text>
      <ChipRow>
        <Chip label="+3h" onPress={() => setWarpHours(warpHours + 3)} />
        <Chip label="+12h" onPress={() => setWarpHours(warpHours + 12)} />
        <Chip label="+1 day" onPress={() => setWarpHours(warpHours + 24)} />
        <Chip label="Reset" onPress={() => setWarpHours(0)} />
      </ChipRow>
    </Banner>
  );
}

const styles = StyleSheet.create({
  calloutTitle: { fontSize: 16, fontWeight: '800', color: C.text },
  calloutRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 6 },
  calloutNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.primary,
    color: '#fff',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '800',
    overflow: 'hidden',
  },
  calloutText: { flex: 1, fontSize: 15, fontWeight: '600', color: C.text },
  calloutMeta: { fontSize: 13, color: C.muted },
  dot: { width: 10, height: 10, borderRadius: 5 },
  planHead: { fontSize: 16, fontWeight: '800', color: C.text },
  planStep: { flexDirection: 'row', gap: S.sm, paddingVertical: 4, borderRadius: R.sm },
  planTask: { fontWeight: '700', color: C.text },
});
