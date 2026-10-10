/**
 * Database reads and writes. Row-level security on the server decides what
 * each student may see or change; these helpers just shape the requests.
 */
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

/** Everything the planner needs, in one round of parallel queries. */
export async function loadPlanner(userId: string): Promise<PlannerData> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [classes, tasks, completions, groups, members, rescues] = await Promise.all([
    supabase.from('classes').select('*').order('position').order('created_at'),
    supabase.from('tasks').select('*').gte('due_at', since).order('due_at').limit(1000),
    supabase.from('task_completions').select('task_id, completed_at').eq('user_id', userId),
    supabase.from('groups').select('*').order('created_at'),
    supabase.from('group_members').select('*'),
    supabase.from('task_rescues').select('*').order('created_at', { ascending: false }),
  ]);
  const memberRows = check(members) as GroupMemberRow[];
  const ids = [...new Set(memberRows.map((m) => m.user_id))];
  const profiles = ids.length
    ? check(await supabase.from('profiles').select('id, display_name').in('id', ids))
    : [];
  return {
    classes: check(classes) as ClassRow[],
    tasks: check(tasks) as TaskRow[],
    completions: new Map((check(completions) as { task_id: string; completed_at: string }[]).map((c) => [c.task_id, c.completed_at])),
    groups: check(groups) as GroupRow[],
    members: memberRows,
    names: new Map((profiles as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name])),
    rescues: check(rescues) as RescueRow[],
  };
}

// --- profile -----------------------------------------------------------------

export async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
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

export async function createTask(input: TaskInput, extraDueDates: Date[] = []): Promise<TaskRow> {
  const row = clean(input);
  const seriesId = row.recurrence ? randomId() : null;
  const first = check(
    await supabase.from('tasks').insert({ ...row, series_id: seriesId }).select().single(),
  ) as TaskRow;
  if (seriesId && extraDueDates.length) {
    await addSeriesInstances(first, extraDueDates);
  }
  return first;
}

/** Insert more instances of a recurring series (duplicates are ignored). */
export async function addSeriesInstances(template: TaskRow, dueDates: Date[]) {
  if (!template.series_id || dueDates.length === 0) return;
  const rows = dueDates.map((d) => ({
    title: template.title,
    task_type: template.task_type,
    custom_label: template.custom_label,
    custom_tier: template.custom_tier,
    weight_pct: template.weight_pct,
    notes: template.notes,
    class_id: template.class_id,
    group_id: template.group_id,
    recurrence: template.recurrence,
    series_id: template.series_id,
    due_at: d.toISOString(),
  }));
  check(await supabase.from('tasks').upsert(rows, { onConflict: 'series_id,due_at', ignoreDuplicates: true }));
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
  return check(await supabase.rpc('join_group', { p_code: code, p_class_id: classId })) as GroupRow;
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

export function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC 4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
