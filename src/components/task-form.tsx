/**
 * The task form, used for new tasks, AI-filled tasks (screenshot), and edits.
 * Fields the AI wasn't sure about are highlighted; the confirm button sits at
 * the bottom so the student scrolls past every field before saving (PRD 5.4).
 */
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { addDays, combine, dayKey, formatDate, formatDue, formatTime, fromDayKey } from '@/lib/dates';
import { PEPPERS, scorePlate } from '@/lib/pepper';
import { C, R, S } from '@/lib/theme';
import type { RecurrenceFreq, TaskType, WeightTier } from '@/lib/types';
import { usePlanner } from '@/state/planner';

import { MonthGrid } from './calendar';
import { Banner, Button, Card, Chip, ChipRow, Field, Label, Muted } from './ui';

export type FormField = 'title' | 'class' | 'due_date' | 'due_time' | 'task_type' | 'weight_pct';

export interface TaskDraft {
  title: string;
  task_type: TaskType;
  custom_label: string;
  custom_tier: WeightTier;
  weight: string;
  day: string | null;
  time: string;
  class_id: string | null;
  group_id: string | null;
  repeat: 'none' | RecurrenceFreq;
  until: string | null;
  notes: string;
}

export const DEFAULT_TIME: Record<TaskType, string> = {
  test: '08:00',
  quiz: '08:00',
  project: '23:59',
  homework: '23:59',
  custom: '23:59',
};

export function emptyDraft(): TaskDraft {
  return {
    title: '',
    task_type: 'homework',
    custom_label: '',
    custom_tier: 'medium',
    weight: '',
    day: null,
    time: DEFAULT_TIME.homework,
    class_id: null,
    group_id: null,
    repeat: 'none',
    until: null,
    notes: '',
  };
}

const TYPES: { value: TaskType; label: string }[] = [
  { value: 'test', label: 'Test' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'project', label: 'Project' },
  { value: 'homework', label: 'Homework' },
  { value: 'custom', label: 'Custom…' },
];

const TIERS: { value: WeightTier; label: string }[] = [
  { value: 'high', label: 'a Test' },
  { value: 'medium', label: 'a Quiz / Project' },
  { value: 'low', label: 'Homework' },
];

const TIMES = ['08:00', '12:00', '15:00', '23:59'];

export function validate(d: TaskDraft): string | null {
  if (!d.title.trim()) return 'Give the task a title.';
  if (!d.day) return 'Pick a due date.';
  if (d.task_type === 'custom' && !d.custom_label.trim()) return 'Name the custom type (e.g. Essay, Lab).';
  if (d.weight.trim()) {
    const n = Number(d.weight);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return 'Grade weight must be between 1 and 100.';
  }
  return null;
}

export function TaskForm({
  initial,
  flagged = [],
  question,
  allowRepeat = true,
  allowGroupChange = true,
  submitLabel,
  onSubmit,
  secondary,
}: {
  initial: TaskDraft;
  flagged?: FormField[];
  question?: string | null;
  allowRepeat?: boolean;
  allowGroupChange?: boolean;
  submitLabel: string;
  onSubmit: (d: TaskDraft) => Promise<void>;
  secondary?: React.ReactNode;
}) {
  const { classes, groups, myMembership, tasks, now, classById } = usePlanner();
  const [d, setD] = useState<TaskDraft>(initial);
  const [flags, setFlags] = useState(new Set(flagged));
  const [pickDate, setPickDate] = useState(!initial.day || flagged.includes('due_date'));
  const [month, setMonth] = useState(() => (initial.day ? fromDayKey(initial.day) : new Date(now)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing a field counts as checking it.
  function set<K extends keyof TaskDraft>(key: K, value: TaskDraft[K], field?: FormField) {
    setD((cur) => ({ ...cur, [key]: value }));
    if (field && flags.has(field)) {
      const next = new Set(flags);
      next.delete(field);
      setFlags(next);
    }
  }

  function setType(t: TaskType) {
    setD((cur) => ({
      ...cur,
      task_type: t,
      // keep the time if the student chose one; otherwise use the type's default
      time: cur.time === DEFAULT_TIME[cur.task_type] ? DEFAULT_TIME[t] : cur.time,
    }));
    if (flags.has('task_type')) {
      const next = new Set(flags);
      next.delete('task_type');
      setFlags(next);
    }
  }

  // Live preview of where this task will land on the pepper scale.
  const preview = useMemo(() => {
    if (!d.day) return null;
    const due = combine(d.day, d.time);
    const weight = Number(d.weight);
    const draft = {
      id: '__draft__',
      task_type: d.task_type,
      custom_tier: d.task_type === 'custom' ? d.custom_tier : null,
      weight_pct: Number.isFinite(weight) && weight > 0 ? weight : null,
      due_at: due.toISOString(),
      created_at: now.toISOString(),
      completed: false,
    };
    const plate = tasks.map((t) => ({ ...t, completed: t.completed_at !== null }));
    return scorePlate([...plate, draft], now).get('__draft__')!;
  }, [d, tasks, now]);

  const groupClass = d.group_id ? classById(myMembership(d.group_id)?.class_id ?? null) : undefined;

  async function submit() {
    const problem = validate(d);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      await onSubmit(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const quickDays: { label: string; day: string }[] = [
    { label: 'Today', day: dayKey(now) },
    { label: 'Tomorrow', day: dayKey(addDays(now, 1)) },
    { label: 'In 1 week', day: dayKey(addDays(now, 7)) },
  ];

  return (
    <View style={{ gap: S.lg }}>
      {question && (
        <Banner tone="warn" icon="help-circle">
          <Text style={{ color: C.text, fontWeight: '700' }}>{question}</Text>
          <Muted>Fields marked ⚠️ were hard to read. Check them before saving.</Muted>
        </Banner>
      )}

      <Field
        label="Title"
        flagged={flags.has('title')}
        value={d.title}
        onChangeText={(v) => set('title', v, 'title')}
        placeholder="e.g. Unit 3 Test"
        maxLength={120}
      />

      <View style={styles.block}>
        <Label flagged={flags.has('task_type')}>Type</Label>
        <ChipRow>
          {TYPES.map((t) => (
            <Chip key={t.value} label={t.label} selected={d.task_type === t.value} onPress={() => setType(t.value)} />
          ))}
        </ChipRow>
        {d.task_type === 'custom' && (
          <Card style={{ gap: S.md }}>
            <Field
              label="Custom type name"
              value={d.custom_label}
              onChangeText={(v) => set('custom_label', v)}
              placeholder="Essay, Lab, Research Paper…"
              maxLength={40}
            />
            <Label>It counts about as much as…</Label>
            <ChipRow>
              {TIERS.map((t) => (
                <Chip key={t.value} label={t.label} selected={d.custom_tier === t.value} onPress={() => set('custom_tier', t.value)} />
              ))}
            </ChipRow>
          </Card>
        )}
      </View>

      <View style={styles.block}>
        <Label flagged={flags.has('due_date') || flags.has('due_time')}>Due</Label>
        <Text style={styles.dueText}>
          {d.day ? `${formatDate(fromDayKey(d.day))} at ${formatTime(combine(d.day, d.time))}` : 'No date yet'}
        </Text>
        <ChipRow>
          {quickDays.map((q) => (
            <Chip
              key={q.label}
              label={q.label}
              selected={d.day === q.day}
              onPress={() => {
                set('day', q.day, 'due_date');
                setPickDate(false);
              }}
            />
          ))}
          <Chip label={pickDate ? 'Hide calendar' : 'Pick a date'} icon="calendar-outline" onPress={() => setPickDate(!pickDate)} />
        </ChipRow>
        {pickDate && (
          <MonthGrid
            month={month}
            onMonth={setMonth}
            selected={d.day ? fromDayKey(d.day) : null}
            onSelect={(day) => {
              set('day', dayKey(day), 'due_date');
              setPickDate(false);
            }}
            today={now}
          />
        )}
        <ChipRow>
          {TIMES.map((t) => (
            <Chip key={t} label={formatTime(combine(dayKey(now), t))} selected={d.time === t} onPress={() => set('time', t, 'due_time')} />
          ))}
          <Chip label="−15 min" onPress={() => set('time', shiftTime(d.time, -15), 'due_time')} />
          <Chip label="+15 min" onPress={() => set('time', shiftTime(d.time, 15), 'due_time')} />
        </ChipRow>
      </View>

      {allowGroupChange && groups.length > 0 && (
        <View style={styles.block}>
          <Label>Share with</Label>
          <ChipRow>
            <Chip label="Just me" icon="person" selected={!d.group_id} onPress={() => set('group_id', null)} />
            {groups.map((g) => (
              <Chip key={g.id} label={g.name} icon="people" selected={d.group_id === g.id} onPress={() => set('group_id', g.id)} />
            ))}
          </ChipRow>
          {d.group_id && <Muted>Everyone in the group gets this task, ranked against their own workload.</Muted>}
        </View>
      )}

      {d.group_id ? (
        <Muted>
          Class color comes from your group link{groupClass ? `: ${groupClass.name}` : ' (set it on the group page)'}.
        </Muted>
      ) : (
        <View style={styles.block}>
          <Label flagged={flags.has('class')}>Class</Label>
          <ChipRow>
            {classes.map((c) => (
              <Chip key={c.id} label={c.name} color={c.color} selected={d.class_id === c.id} onPress={() => set('class_id', c.id, 'class')} />
            ))}
            <Chip label="No class" selected={!d.class_id} onPress={() => set('class_id', null, 'class')} />
          </ChipRow>
        </View>
      )}

      <Field
        label="Grade weight % (optional)"
        flagged={flags.has('weight_pct')}
        value={d.weight}
        onChangeText={(v) => set('weight', v.replace(/[^0-9.]/g, ''), 'weight_pct')}
        keyboardType="decimal-pad"
        placeholder="e.g. 15"
        hint="Leave blank to use the default for this type."
        maxLength={5}
      />

      {allowRepeat && (
        <View style={styles.block}>
          <Label>Repeat</Label>
          <ChipRow>
            {(['none', 'daily', 'weekdays', 'weekly'] as const).map((r) => (
              <Chip
                key={r}
                label={r === 'none' ? 'Never' : r === 'daily' ? 'Every day' : r === 'weekdays' ? 'Weekdays' : 'Weekly'}
                selected={d.repeat === r}
                onPress={() => set('repeat', r)}
              />
            ))}
          </ChipRow>
          {d.repeat !== 'none' && (
            <ChipRow>
              <Chip label="Until I stop it" selected={!d.until} onPress={() => set('until', null)} />
              {[14, 30, 90].map((n) => {
                const day = dayKey(addDays(d.day ? fromDayKey(d.day) : now, n));
                return (
                  <Chip key={n} label={n === 14 ? '2 weeks' : n === 30 ? '1 month' : '3 months'} selected={d.until === day} onPress={() => set('until', day)} />
                );
              })}
            </ChipRow>
          )}
        </View>
      )}

      <Field label="Notes (optional)" value={d.notes} onChangeText={(v) => set('notes', v)} multiline maxLength={1000} />

      {preview && preview.level && (
        <View style={[styles.preview, { borderColor: PEPPERS[preview.level].color }]}>
          <Text style={{ fontSize: 26 }}>{PEPPERS[preview.level].emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.previewTitle}>Starts at {PEPPERS[preview.level].label}</Text>
            <Muted>
              Due {formatDue(combine(d.day!, d.time), now)}. It heats up as the date gets closer.
            </Muted>
          </View>
        </View>
      )}

      {error && <Banner tone="warn" icon="alert-circle">{error}</Banner>}
      <Button title={submitLabel} icon="checkmark-circle" onPress={submit} busy={busy} />
      {secondary}
    </View>
  );
}

function shiftTime(t: string, minutes: number): string {
  const [h, m] = t.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  block: { gap: S.sm },
  dueText: { fontSize: 16, fontWeight: '700', color: C.text },
  preview: {
    flexDirection: 'row',
    gap: S.md,
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: R.lg,
    padding: S.md,
    backgroundColor: C.card,
  },
  previewTitle: { fontSize: 16, fontWeight: '800', color: C.text },
});
