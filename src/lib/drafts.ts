/** Convert between form drafts, database rows and AI extraction results. */
import { DEFAULT_TIME, emptyDraft, type FormField, type TaskDraft } from '@/components/task-form';

import type { ExtractedTask } from './ai';
import type { TaskInput } from './api';
import { combine, dayKey, timeKey } from './dates';
import { topUp } from './recurrence';
import type { ClassRow, Recurrence, TaskRow } from './types';

export function draftToInput(d: TaskDraft): TaskInput {
  const weight = Number(d.weight);
  const recurrence: Recurrence | null = d.repeat === 'none' ? null : { freq: d.repeat, until: d.until };
  return {
    title: d.title,
    task_type: d.task_type,
    custom_label: d.custom_label,
    custom_tier: d.custom_tier,
    weight_pct: d.weight.trim() && Number.isFinite(weight) ? weight : null,
    due_at: combine(d.day!, d.time).toISOString(),
    notes: d.notes,
    class_id: d.class_id,
    group_id: d.group_id,
    recurrence,
  };
}

/** Extra instances to create right away for a new recurring task. */
export function initialInstances(input: TaskInput): Date[] {
  if (!input.recurrence) return [];
  return topUp(input.recurrence, new Date(input.due_at));
}

export function rowToDraft(t: TaskRow): TaskDraft {
  const due = new Date(t.due_at);
  return {
    title: t.title,
    task_type: t.task_type,
    custom_label: t.custom_label ?? '',
    custom_tier: t.custom_tier ?? 'medium',
    weight: t.weight_pct == null ? '' : String(Number(t.weight_pct)),
    day: dayKey(due),
    time: timeKey(due),
    class_id: t.class_id,
    group_id: t.group_id,
    repeat: t.recurrence?.freq ?? 'none',
    until: t.recurrence?.until ?? null,
    notes: t.notes ?? '',
  };
}

export function extractedToDraft(x: ExtractedTask, classes: ClassRow[]): { draft: TaskDraft; flagged: FormField[] } {
  const type = x.task_type ?? 'homework';
  const cls = x.class_name ? classes.find((c) => c.name.toLowerCase() === x.class_name!.toLowerCase()) : undefined;
  const draft: TaskDraft = {
    ...emptyDraft(),
    title: x.title,
    task_type: type,
    custom_label: x.custom_label ?? '',
    custom_tier: x.custom_tier ?? 'medium',
    weight: x.weight_pct == null ? '' : String(x.weight_pct),
    day: x.due_date,
    time: x.due_time ?? DEFAULT_TIME[type],
    class_id: cls?.id ?? null,
    notes: x.notes ?? '',
  };
  const flagged = new Set<FormField>(x.unclear);
  if (!cls && classes.length > 0) flagged.add('class');
  return { draft, flagged: [...flagged] };
}
