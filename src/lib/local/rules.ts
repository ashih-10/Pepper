/**
 * What the server's schema enforces, applied to the demo's tables: column
 * checks, row-level-security tests, foreign-key cascades and the activity /
 * rescue triggers from supabase/migrations/*_init.sql.
 */
import type { TaskInput } from '../api-cloud';
import type { Recurrence, RescueRow, TaskRow, TaskSnapshot } from '../types';
import { CLASSMATE_ID } from './constants';
import { isMember, nowIso, randomId, type LocalDb } from './db';
import { logActivity } from './feed';

const DAY_MS = 86_400_000;
const TASK_TYPES: readonly string[] = ['test', 'quiz', 'project', 'homework', 'custom'];
const TIERS: readonly string[] = ['high', 'medium', 'low'];
const FREQS: readonly string[] = ['daily', 'weekdays', 'weekly'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** The demo student. Every call needs a started demo, like a login on the server. */
export function me(d: LocalDb): string {
  if (!d.userId) throw new Error('Not signed in');
  return d.userId;
}

/** RLS "tasks: read": your own personal tasks and every shared task of your groups. */
export function canSee(d: LocalDb, userId: string, t: TaskRow): boolean {
  return t.group_id ? isMember(d, t.group_id, userId) : t.created_by === userId;
}

/** Two timestamps for the same instant, whatever their string format. */
export function sameTime(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b);
}

/** Normalize a timestamp to ISO, or throw like the database on a bad value. */
export function toIso(value: string, what = 'date'): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Invalid ${what}.`);
  return new Date(ms).toISOString();
}

/** Columns a task edit sets (`TaskInput` without the repeat rule). */
export type TaskFields = Omit<TaskInput, 'recurrence'>;

/** A new task: its columns, series link and (for seeded rows) creation time. */
export type NewTask = TaskFields & Pick<TaskRow, 'series_id' | 'recurrence'> & { created_at?: string };

function checkTask(d: LocalDb, t: TaskRow) {
  const title = typeof t.title === 'string' ? t.title.trim() : '';
  if (title.length < 1 || title.length > 120) throw new Error('Title must be 1-120 characters.');
  if (!TASK_TYPES.includes(t.task_type)) throw new Error('Unknown task type.');
  if (t.custom_tier !== null && !TIERS.includes(t.custom_tier)) throw new Error('Unknown weight tier.');
  if (t.task_type === 'custom' && !t.custom_tier) throw new Error('A custom type needs a weight tier.');
  if (t.custom_label !== null && t.custom_label.length > 40) throw new Error('Type names are 40 characters at most.');
  if (t.weight_pct !== null && !(t.weight_pct > 0 && t.weight_pct <= 100)) {
    throw new Error('Weight must be more than 0% and at most 100%.');
  }
  if (!(Date.parse(t.due_at) > Date.parse('2000-01-01'))) throw new Error('Pick a valid due date.');
  if (t.notes !== null && t.notes.length > 1000) throw new Error('Notes are 1000 characters at most.');
  if (t.group_id && t.class_id) throw new Error('A shared task takes its class from each member.');
  if (t.class_id && !d.classes.some((c) => c.id === t.class_id && c.user_id === t.created_by)) {
    throw new Error('class does not belong to task owner');
  }
}

/** Column normalization the database does on the way in (numeric(5,2), timestamptz). */
function normalize(t: TaskRow) {
  t.due_at = toIso(t.due_at, 'due date');
  t.created_at = toIso(t.created_at, 'creation date');
  if (t.weight_pct !== null) {
    const n = Number(t.weight_pct);
    t.weight_pct = Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
}

/** A `task_series.rule` check: a known frequency. */
export function checkRule(rule: Recurrence) {
  if (!rule || !FREQS.includes(rule.freq)) throw new Error('Unknown repeat rule.');
}

/** `check_member_class`: a member's group mapping must be one of their own classes. */
export function checkMemberClass(d: LocalDb, userId: string, classId: string | null) {
  if (classId && !d.classes.some((c) => c.id === classId && c.user_id === userId)) {
    throw new Error('class does not belong to member');
  }
}

export function snapshot(t: TaskRow): TaskSnapshot {
  return {
    title: t.title,
    task_type: t.task_type,
    custom_label: t.custom_label,
    custom_tier: t.custom_tier,
    weight_pct: t.weight_pct,
    due_at: t.due_at,
    notes: t.notes,
  };
}

/**
 * `offer_rescues`: a copy of a deleted shared task for each other member who
 * hasn't finished it. The scripted classmate has no planner, so he is skipped.
 */
export function offerRescues(d: LocalDb, actor: string, t: TaskRow, groupName: string, reason: RescueRow['reason']) {
  if (!t.group_id || !(Date.parse(t.due_at) > Date.now() - 7 * DAY_MS)) return;
  for (const m of d.group_members) {
    if (m.group_id !== t.group_id || m.user_id === actor || m.user_id === CLASSMATE_ID) continue;
    if (d.task_completions.some((c) => c.task_id === t.id && c.user_id === m.user_id)) continue;
    d.counters.rescue += 1;
    d.task_rescues.push({
      id: d.counters.rescue,
      user_id: m.user_id,
      group_name: groupName,
      reason,
      snapshot: snapshot(t),
      created_at: nowIso(),
    });
  }
}

/** Insert a task as `actor` (policies, checks and the INSERT branch of `log_task_activity`). */
export function insertTask(d: LocalDb, actor: string, f: NewTask): TaskRow {
  const at = nowIso();
  const row: TaskRow = {
    id: randomId(),
    created_by: actor,
    group_id: f.group_id ?? null,
    class_id: f.class_id ?? null,
    title: f.title,
    task_type: f.task_type,
    custom_label: f.custom_label ?? null,
    custom_tier: f.custom_tier ?? null,
    weight_pct: f.weight_pct ?? null,
    due_at: f.due_at,
    notes: f.notes ?? null,
    series_id: f.series_id ?? null,
    recurrence: f.recurrence ?? null,
    created_at: f.created_at ?? at,
    updated_at: at,
  };
  normalize(row);
  checkTask(d, row);
  if (row.group_id && !isMember(d, row.group_id, actor)) throw new Error('Join the group before adding tasks to it.');
  if (row.series_id) {
    if (!d.task_series.some((s) => s.id === row.series_id && s.created_by === actor)) {
      throw new Error('series belongs to someone else');
    }
    if (d.tasks.some((t) => t.series_id === row.series_id && sameTime(t.due_at, row.due_at))) {
      throw new Error('This repeating task already has an instance at that time.');
    }
  }
  // recurring top-ups: only the first instance of a series is announced
  const first = !row.series_id || !d.tasks.some((t) => t.series_id === row.series_id);
  d.tasks.push(row);
  if (row.group_id && first) {
    logActivity(d, {
      group_id: row.group_id,
      actor_id: actor,
      kind: 'task_added',
      task_id: row.id,
      task_title: row.title,
      payload: { due_at: row.due_at, task_type: row.task_type, recurring: row.series_id !== null },
    });
  }
  return row;
}

/**
 * Update a task as `actor` (move rule, RLS check on the new row, checks and the
 * UPDATE branch of `log_task_activity`). The caller has checked it can see it.
 */
export function updateTaskRow(d: LocalDb, actor: string, task: TaskRow, patch: Partial<TaskFields>) {
  const old: TaskRow = { ...task };
  const next: TaskRow = { ...task, updated_at: nowIso() };
  for (const [k, v] of Object.entries(patch) as [keyof TaskFields, unknown][]) {
    if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = v;
  }
  normalize(next);
  if (next.group_id !== old.group_id && old.created_by !== actor) throw new Error('only the creator can move a task');
  if (next.group_id ? !isMember(d, next.group_id, actor) : next.created_by !== actor) {
    throw new Error('You can only share a task with a group you are in.');
  }
  checkTask(d, next);
  Object.assign(task, next);

  if (old.group_id !== task.group_id) {
    if (old.group_id) {
      // unshared from the old group: looks like a delete to everyone else
      logActivity(d, {
        group_id: old.group_id,
        actor_id: actor,
        kind: 'task_deleted',
        task_id: old.id,
        task_title: old.title,
        payload: { ...snapshot(old) },
      });
      const g = d.groups.find((x) => x.id === old.group_id);
      if (g) offerRescues(d, actor, old, g.name, 'task_deleted');
    }
    if (task.group_id) {
      logActivity(d, {
        group_id: task.group_id,
        actor_id: actor,
        kind: 'task_added',
        task_id: task.id,
        task_title: task.title,
        payload: { due_at: task.due_at, task_type: task.task_type },
      });
    }
    return;
  }
  if (!task.group_id) return;
  const base = { group_id: task.group_id, actor_id: actor, task_id: task.id, task_title: task.title };
  if (!sameTime(old.due_at, task.due_at)) {
    logActivity(d, { ...base, kind: 'due_changed', payload: { from: old.due_at, to: task.due_at } });
  }
  if (
    old.task_type !== task.task_type ||
    old.custom_tier !== task.custom_tier ||
    old.custom_label !== task.custom_label
  ) {
    logActivity(d, {
      ...base,
      kind: 'type_changed',
      payload: { from: old.task_type, to: task.task_type, label: task.custom_label },
    });
  }
  if (old.title !== task.title || old.notes !== task.notes || old.weight_pct !== task.weight_pct) {
    logActivity(d, { ...base, kind: 'task_edited', payload: { old_title: old.title } });
  }
}

/**
 * Delete tasks as `actor` (cascading their completions) with the DELETE branch
 * of `log_task_activity`. `quietSeries` is the series `stop_series` is ending:
 * its instances leave no per-task rows and no rescue offers.
 */
export function removeTasks(d: LocalDb, actor: string, doomed: TaskRow[], quietSeries?: string) {
  if (!doomed.length) return;
  for (const t of doomed) {
    if (!t.group_id || (quietSeries && t.series_id === quietSeries)) continue;
    const g = d.groups.find((x) => x.id === t.group_id);
    if (!g) continue;
    logActivity(d, {
      group_id: t.group_id,
      actor_id: actor,
      kind: 'task_deleted',
      task_id: t.id,
      task_title: t.title,
      payload: { ...snapshot(t) },
    });
    offerRescues(d, actor, t, g.name, 'task_deleted');
  }
  const ids = new Set(doomed.map((t) => t.id));
  d.tasks = d.tasks.filter((t) => !ids.has(t.id));
  d.task_completions = d.task_completions.filter((c) => !ids.has(c.task_id));
}

/**
 * Delete a group and everything hanging off it (`rescue_group_tasks`, then the
 * cascades). Its tasks leave no activity rows: the whole feed goes with it.
 */
export function deleteGroupRow(d: LocalDb, actor: string, groupId: string) {
  const g = d.groups.find((x) => x.id === groupId);
  if (!g) return;
  const tasks = d.tasks.filter((t) => t.group_id === groupId);
  for (const t of tasks) offerRescues(d, actor, t, g.name, 'group_deleted');
  const taskIds = new Set(tasks.map((t) => t.id));
  const seriesIds = new Set(d.task_series.filter((s) => s.group_id === groupId).map((s) => s.id));
  d.tasks = d.tasks.filter((t) => !taskIds.has(t.id));
  for (const t of d.tasks) if (t.series_id && seriesIds.has(t.series_id)) t.series_id = null;
  d.task_completions = d.task_completions.filter((c) => !taskIds.has(c.task_id));
  d.task_series = d.task_series.filter((s) => !seriesIds.has(s.id));
  d.group_members = d.group_members.filter((m) => m.group_id !== groupId);
  d.activity = d.activity.filter((a) => a.group_id !== groupId);
  d.groups = d.groups.filter((x) => x.id !== groupId);
}

/** `new_join_code`: 6 characters without look-alikes (no 0/O, 1/I), unused by any group. */
export function newJoinCode(d: LocalDb): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!d.groups.some((g) => g.join_code === code)) return code;
  }
}
