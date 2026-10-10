/**
 * Database reads and writes. Row-level security on the server decides what
 * each student may see or change; these helpers just shape the requests.
 */
import { dayKey } from './dates';
import { seriesTopUp } from './recurrence';
import { supabase } from './supabase';
import type {
  ActivityRow,
  ClassRow,
  GroupMemberRow,
  GroupRow,
  Profile,
  Recurrence,
  RescueRow,
  TaskRow,
  TaskSeriesRow,
  TaskSnapshot,
  TaskType,
  WeightTier,
} from './types';

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

export interface PlannerData {
  classes: ClassRow[];
  tasks: TaskRow[];
  completions: Map<string, string>;
  groups: GroupRow[];
  members: GroupMemberRow[];
  names: Map<string, string>;
  rescues: RescueRow[];
}

type TaskWithCompletion = TaskRow & { task_completions: { completed_at: string }[] | null };

/** Everything the planner needs, in one round of parallel queries. */
export async function loadPlanner(): Promise<PlannerData> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [classes, tasks, groups, members, rescues] = await Promise.all([
    supabase.from('classes').select('*').order('position').order('created_at'),
    // Completions ride along with their tasks (RLS returns only your own),
    // so there is no separate, ever-growing completions query to cap.
    supabase.from('tasks').select('*, task_completions(completed_at)').gte('due_at', since).order('due_at').limit(1000),
    supabase.from('groups').select('*').order('created_at'),
    supabase.from('group_members').select('*'),
    supabase.from('task_rescues').select('*').order('created_at', { ascending: false }),
  ]);
  const memberRows = check(members) as GroupMemberRow[];
  const ids = [...new Set(memberRows.map((m) => m.user_id))];
  const profiles = ids.length
    ? check(await supabase.from('profiles').select('id, display_name').in('id', ids))
    : [];
  const taskRows = check(tasks) as TaskWithCompletion[];
  const completions = new Map<string, string>();
  for (const t of taskRows) {
    const done = t.task_completions?.[0]?.completed_at;
    if (done) completions.set(t.id, done);
  }
  return {
    classes: check(classes) as ClassRow[],
    tasks: taskRows.map(({ task_completions: _c, ...t }) => t),
    completions,
    groups: check(groups) as GroupRow[],
    members: memberRows,
    names: new Map((profiles as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name])),
    rescues: check(rescues) as RescueRow[],
  };
}

// --- profile -----------------------------------------------------------------

/**
 * Your own full profile (groupmates can only read names). Throws on a network
 * or server error, so callers can tell "couldn't load" apart from "no row".
 */
export async function loadProfile(): Promise<Profile | null> {
  const { data, error } = await supabase.rpc('get_my_profile').maybeSingle<Profile>();
  if (error) throw error;
  return data ?? null;
}

export async function updateProfile(userId: string, patch: Partial<Omit<Profile, 'id'>>) {
  check(await supabase.from('profiles').update(patch).eq('id', userId));
}

// --- classes -----------------------------------------------------------------

export async function addClass(name: string, color: string, position: number): Promise<ClassRow> {
  return check(await supabase.from('classes').insert({ name: name.trim(), color, position }).select().single()) as ClassRow;
}

export async function updateClass(id: string, patch: Partial<Pick<ClassRow, 'name' | 'color' | 'position'>>) {
  check(await supabase.from('classes').update(patch).eq('id', id));
}

export async function deleteClass(id: string) {
  check(await supabase.from('classes').delete().eq('id', id));
}

// --- tasks -------------------------------------------------------------------

export interface TaskInput {
  title: string;
  task_type: TaskType;
  custom_label: string | null;
  custom_tier: WeightTier | null;
  weight_pct: number | null;
  due_at: string;
  notes: string | null;
  class_id: string | null;
  group_id: string | null;
  recurrence: Recurrence | null;
}

function clean(input: TaskInput) {
  const custom = input.task_type === 'custom';
  return {
    ...input,
    title: input.title.trim(),
    custom_label: custom ? input.custom_label?.trim() || 'Other' : null,
    custom_tier: custom ? (input.custom_tier ?? 'medium') : null,
    notes: input.notes?.trim() || null,
    // shared tasks take their class from each member's group mapping
    class_id: input.group_id ? null : input.class_id,
  };
}

/**
 * Create a task. A recurring task also gets a series record (the template and
 * rule), its first few weeks of instances, and a watermark of how far it has
 * been generated.
 */
export async function createTask(input: TaskInput): Promise<TaskRow> {
  const { recurrence, ...row } = clean(input);
  if (!recurrence) {
    return check(await supabase.from('tasks').insert({ ...row, recurrence: null }).select().single()) as TaskRow;
  }
  const series = check(
    await supabase
      .from('task_series')
      .insert({
        title: row.title,
        task_type: row.task_type,
        custom_label: row.custom_label,
        custom_tier: row.custom_tier,
        weight_pct: row.weight_pct,
        notes: row.notes,
        class_id: row.class_id,
        group_id: row.group_id,
        rule: recurrence,
        first_due: row.due_at,
        generated_until: row.due_at,
      })
      .select()
      .single(),
  ) as TaskSeriesRow;
  const first = check(
    await supabase.from('tasks').insert({ ...row, recurrence, series_id: series.id }).select().single(),
  ) as TaskRow;
  await topUpSeries(series);
  return first;
}

/** Generate a series' next instances and move its watermark forward. */
async function topUpSeries(series: TaskSeriesRow, now = new Date()) {
  const { dates, generatedUntil } = seriesTopUp(
    series.rule,
    new Date(series.first_due),
    new Date(series.generated_until),
    now,
  );
  if (dates.length) {
    const rows = dates.map((d) => ({
      title: series.title,
      task_type: series.task_type,
      custom_label: series.custom_label,
      custom_tier: series.custom_tier,
      weight_pct: series.weight_pct,
      notes: series.notes,
      class_id: series.class_id,
      group_id: series.group_id,
      recurrence: series.rule,
      series_id: series.id,
      due_at: d.toISOString(),
    }));
    check(await supabase.from('tasks').upsert(rows, { onConflict: 'series_id,due_at', ignoreDuplicates: true }));
  }
  if (generatedUntil.getTime() > new Date(series.generated_until).getTime()) {
    check(await supabase.from('task_series').update({ generated_until: generatedUntil.toISOString() }).eq('id', series.id));
  }
  return dates.length;
}

/**
 * Keep every series you created generated ~3 weeks ahead. Only the creator's
 * device does this, so instances always belong to the series' owner.
 * Returns how many tasks were added.
 */
export async function topUpMySeries(userId: string): Promise<number> {
  const rows = check(
    await supabase.from('task_series').select('*').eq('created_by', userId),
  ) as TaskSeriesRow[];
  const today = dayKey(new Date());
  let added = 0;
  for (const series of rows) {
    if (series.rule.until && series.rule.until < today) continue;
    added += await topUpSeries(series);
  }
  return added;
}

/** Stop a series: no more copies, and remove its future instances you created. */
/**
 * End a recurring series after `after` (usually the instance being viewed).
 * Later instances are removed; earlier ones stay. Returns how many were removed.
 */
export async function stopSeries(seriesId: string, after: Date): Promise<number> {
  const last = after > new Date() ? after : new Date();
  const removed = check(
    await supabase.rpc('stop_series', { p_series_id: seriesId, p_after: after.toISOString(), p_until: dayKey(last) }),
  );
  return (removed as number | null) ?? 0;
}

export async function updateTask(id: string, input: TaskInput) {
  const { recurrence: _ignored, ...row } = clean(input);
  check(await supabase.from('tasks').update(row).eq('id', id));
}

/** Returns false if the database refused (not the creator or group owner). */
export async function deleteTask(id: string): Promise<boolean> {
  const rows = check(await supabase.from('tasks').delete().eq('id', id).select('id'));
  return (rows as unknown[]).length > 0;
}

export async function setCompleted(taskId: string, done: boolean) {
  if (done) {
    check(await supabase.from('task_completions').upsert({ task_id: taskId }, { onConflict: 'task_id,user_id' }));
  } else {
    check(await supabase.from('task_completions').delete().eq('task_id', taskId));
  }
}

export async function copyRescue(rescue: RescueRow, classId: string | null) {
  const s: TaskSnapshot = rescue.snapshot;
  check(
    await supabase.from('tasks').insert({
      title: s.title,
      task_type: s.task_type,
      custom_label: s.custom_label,
      custom_tier: s.custom_tier,
      weight_pct: s.weight_pct,
      due_at: s.due_at,
      notes: s.notes,
      class_id: classId,
    }),
  );
  await dismissRescue(rescue.id);
}

export async function dismissRescue(id: number) {
  check(await supabase.from('task_rescues').delete().eq('id', id));
}

// --- groups ------------------------------------------------------------------

export async function createGroup(name: string, classId: string | null): Promise<GroupRow> {
  return check(await supabase.rpc('create_group', { p_name: name, p_class_id: classId })) as GroupRow;
}

export async function joinGroup(code: string, classId: string | null): Promise<GroupRow> {
  const group = check(await supabase.rpc('join_group', { p_code: code, p_class_id: classId })) as GroupRow | null;
  // An unknown code comes back empty (the database counts it toward a daily limit).
  if (!group?.id) throw new Error('No group found with that code');
  return group;
}

/** Owner only: replace the group's join code. Returns the new code. */
export async function regenerateJoinCode(groupId: string): Promise<string> {
  return check(await supabase.rpc('regenerate_join_code', { p_group_id: groupId })) as string;
}

export async function leaveGroup(groupId: string) {
  check(await supabase.rpc('leave_group', { p_group_id: groupId }));
}

export async function deleteGroup(groupId: string) {
  check(await supabase.from('groups').delete().eq('id', groupId));
}

export async function removeMember(groupId: string, userId: string) {
  check(await supabase.rpc('remove_member', { p_group_id: groupId, p_user_id: userId }));
}

export async function setGroupClass(groupId: string, userId: string, classId: string | null) {
  check(await supabase.from('group_members').update({ class_id: classId }).eq('group_id', groupId).eq('user_id', userId));
}

export async function loadActivity(groupId: string, limit = 50): Promise<ActivityRow[]> {
  return check(
    await supabase.from('activity').select('*').eq('group_id', groupId).order('created_at', { ascending: false }).limit(limit),
  ) as ActivityRow[];
}

export async function activitySince(afterId: number): Promise<ActivityRow[]> {
  return check(
    await supabase.from('activity').select('*').gt('id', afterId).order('id').limit(100),
  ) as ActivityRow[];
}

/** Newest activity id you can see (0 if none). Used to start catch-up fresh. */
export async function latestActivityId(): Promise<number> {
  const rows = check(
    await supabase.from('activity').select('id').order('id', { ascending: false }).limit(1),
  ) as { id: number }[];
  return rows[0]?.id ?? 0;
}

export function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC 4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
