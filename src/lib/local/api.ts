/**
 * The on-device demo backend: every function of ../api-cloud.ts with the same
 * signature, reading and writing this browser's storage instead of Supabase.
 * It mirrors the server's rules (row-level security, triggers, RPCs) for one
 * real student plus the scripted classmate, and never touches the network.
 */
import type { PlannerData, TaskInput, TaskSeed } from '../api-cloud';
import { dayKey } from '../dates';
import { seriesTopUp } from '../recurrence';
import type { ClassRow, EducationLevel, Profile, RescueRow, TaskRow, TaskSeriesRow } from '../types';
import { copy, groupIdsOf, isMember, isOwner, nowIso, randomId, read, write, type LocalDb } from './db';
import { logActivity } from './feed';
import { canSee, checkRule, insertTask, me, removeTasks, sameTime, toIso, updateTaskRow } from './rules';

export {
  activitySince,
  createGroup,
  deleteGroup,
  joinGroup,
  latestActivityId,
  leaveGroup,
  loadActivity,
  regenerateJoinCode,
  removeMember,
  setGroupClass,
  subscribeActivity,
} from './groups';
export { randomId };

const DAY_MS = 86_400_000;

/** Everything the planner needs: what row-level security would return to you. */
export async function loadPlanner(): Promise<PlannerData> {
  const d = read();
  const uid = me(d);
  const since = Date.now() - 60 * DAY_MS;
  const mine = groupIdsOf(d, uid);
  const tasks = d.tasks
    .filter((t) => canSee(d, uid, t) && Date.parse(t.due_at) >= since)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
    .slice(0, 1000);
  const shown = new Set(tasks.map((t) => t.id));
  const members = d.group_members.filter((m) => mine.has(m.group_id));
  const people = new Set([uid, ...members.map((m) => m.user_id)]);
  return {
    classes: copy(d.classes.filter((c) => c.user_id === uid).sort((a, b) => a.position - b.position)),
    tasks: copy(tasks),
    completions: new Map(
      d.task_completions.filter((c) => c.user_id === uid && shown.has(c.task_id)).map((c) => [c.task_id, c.completed_at]),
    ),
    groups: copy(d.groups.filter((g) => mine.has(g.id)).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))),
    members: copy(members),
    names: new Map(d.profiles.filter((p) => people.has(p.id)).map((p) => [p.id, p.display_name])),
    rescues: copy(
      d.task_rescues
        .filter((r) => r.user_id === uid)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id),
    ),
  };
}

// --- profile -----------------------------------------------------------------

/** Your own full profile. */
export async function loadProfile(): Promise<Profile | null> {
  const d = read();
  const uid = me(d);
  const p = d.profiles.find((x) => x.id === uid);
  return p ? copy(p) : null;
}

const LEVELS: readonly (EducationLevel | null)[] = ['middle', 'high', 'college', null];
const hour = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 23;
const maxLen = (s: string | null, n: number) => s === null || (typeof s === 'string' && s.length <= n);

function checkProfile(p: Profile) {
  if (typeof p.display_name !== 'string' || p.display_name.length > 60) throw new Error('Name must be 60 characters or fewer.');
  if (!LEVELS.includes(p.education_level)) throw new Error('Unknown school level.');
  if (!maxLen(p.grade, 20) || !maxLen(p.goals, 500) || !maxLen(p.struggles, 500)) throw new Error('That answer is too long.');
  if (!hour(p.quiet_start) || !hour(p.quiet_end)) throw new Error('Quiet hours must be between 0 and 23.');
}

const PROFILE_FIELDS = [
  'display_name',
  'education_level',
  'grade',
  'goals',
  'struggles',
  'quiet_hours_enabled',
  'quiet_start',
  'quiet_end',
  'onboarded',
] as const;

/** Update your own profile (someone else's id changes nothing, like RLS). */
export async function updateProfile(userId: string, patch: Partial<Omit<Profile, 'id'>>) {
  write((d) => {
    const p = d.profiles.find((x) => x.id === userId && userId === me(d));
    if (!p) return;
    const next: Profile = { ...p };
    for (const k of PROFILE_FIELDS) {
      if (patch[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = patch[k];
    }
    checkProfile(next);
    Object.assign(p, next);
  });
}

// --- classes -----------------------------------------------------------------

function checkClass(c: ClassRow) {
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  if (name.length < 1 || name.length > 60) throw new Error('Class name must be 1-60 characters.');
  if (!/^#[0-9A-Fa-f]{6}$/.test(c.color)) throw new Error('Pick a color.');
  if (!Number.isInteger(c.position)) throw new Error('Invalid class position.');
}

export async function addClass(name: string, color: string, position: number): Promise<ClassRow> {
  return write((d) => {
    const row: ClassRow = { id: randomId(), user_id: me(d), name: name.trim(), color, position };
    checkClass(row);
    d.classes.push(row);
    return copy(row);
  });
}

export async function updateClass(id: string, patch: Partial<Pick<ClassRow, 'name' | 'color' | 'position'>>) {
  write((d) => {
    const c = d.classes.find((x) => x.id === id && x.user_id === me(d));
    if (!c) return;
    const next: ClassRow = { ...c };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.color !== undefined) next.color = patch.color;
    if (patch.position !== undefined) next.position = patch.position;
    checkClass(next);
    Object.assign(c, next);
  });
}

/** Delete one of your classes; tasks, series and group mappings using it lose their class. */
export async function deleteClass(id: string) {
  write((d) => {
    if (!d.classes.some((c) => c.id === id && c.user_id === me(d))) return;
    d.classes = d.classes.filter((c) => c.id !== id);
    for (const t of d.tasks) if (t.class_id === id) t.class_id = null;
    for (const s of d.task_series) if (s.class_id === id) s.class_id = null;
    for (const m of d.group_members) if (m.class_id === id) m.class_id = null;
  });
}

// --- tasks -------------------------------------------------------------------

/** Same clean-up as the cloud version, keeping only the task columns. */
function clean(input: TaskInput): TaskInput {
  const custom = input.task_type === 'custom';
  return {
    title: input.title.trim(),
    task_type: input.task_type,
    custom_label: custom ? input.custom_label?.trim() || 'Other' : null,
    custom_tier: custom ? (input.custom_tier ?? 'medium') : null,
    weight_pct: input.weight_pct ?? null,
    due_at: input.due_at,
    notes: input.notes?.trim() || null,
    // shared tasks take their class from each member's group mapping
    class_id: input.group_id ? null : (input.class_id ?? null),
    group_id: input.group_id ?? null,
    recurrence: input.recurrence ?? null,
  };
}

/** Create a task; a recurring one also gets its series record and first few weeks of instances. */
export async function createTask(input: TaskInput): Promise<TaskRow> {
  return write((d) => {
    const uid = me(d);
    const { recurrence, ...row } = clean(input);
    if (!recurrence) return copy(insertTask(d, uid, { ...row, series_id: null, recurrence: null }));
    checkRule(recurrence);
    if (row.group_id && !isMember(d, row.group_id, uid)) throw new Error('Join the group before adding tasks to it.');
    const due = toIso(row.due_at, 'due date');
    const series: TaskSeriesRow = {
      id: randomId(),
      created_by: uid,
      group_id: row.group_id,
      class_id: row.class_id,
      title: row.title,
      task_type: row.task_type,
      custom_label: row.custom_label,
      custom_tier: row.custom_tier,
      weight_pct: row.weight_pct,
      notes: row.notes,
      rule: recurrence,
      first_due: due,
      generated_until: due,
      created_at: nowIso(),
    };
    d.task_series.push(series);
    const first = insertTask(d, uid, { ...row, recurrence, series_id: series.id });
    series.weight_pct = first.weight_pct;
    topUpSeries(d, uid, series);
    return copy(first);
  });
}

/** Generate a series' next instances and move its watermark forward. Returns how many were added. */
function topUpSeries(d: LocalDb, uid: string, series: TaskSeriesRow, now = new Date()): number {
  const { dates, generatedUntil } = seriesTopUp(
    series.rule,
    new Date(series.first_due),
    new Date(series.generated_until),
    now,
  );
  let added = 0;
  for (const date of dates) {
    const due = date.toISOString();
    // like the cloud's upsert with ignoreDuplicates on (series_id, due_at)
    if (d.tasks.some((t) => t.series_id === series.id && sameTime(t.due_at, due))) continue;
    insertTask(d, uid, {
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
      due_at: due,
    });
    added++;
  }
  if (generatedUntil.getTime() > Date.parse(series.generated_until)) series.generated_until = generatedUntil.toISOString();
  return added;
}

/** Keep every series you created generated ~3 weeks ahead. Returns how many tasks were added. */
export async function topUpMySeries(userId: string): Promise<number> {
  return write((d) => {
    const uid = me(d);
    if (userId !== uid) return 0;
    const today = dayKey(new Date());
    let added = 0;
    for (const series of d.task_series) {
      if (series.created_by !== uid) continue;
      if (series.rule.until && series.rule.until < today) continue;
      // left the group: there is nowhere to add its instances any more
      if (series.group_id && !isMember(d, series.group_id, uid)) continue;
      added += topUpSeries(d, uid, series);
    }
    return added;
  });
}

/**
 * End a recurring series after `after`: later instances are removed (one
 * 'series_stopped' feed entry, no rescue offers), earlier ones stay.
 * Returns how many were removed.
 */
export async function stopSeries(seriesId: string, after: Date): Promise<number> {
  return write((d) => {
    const uid = me(d);
    const now = new Date();
    const until = dayKey(after > now ? after : now);
    const series = d.task_series.find((s) => s.id === seriesId);
    if (!series || series.created_by !== uid) {
      throw new Error('only the person who made this repeating task can stop it');
    }
    const cutoff = Math.max(now.getTime(), after.getTime());
    series.rule = { ...series.rule, until };
    series.generated_until = new Date(cutoff).toISOString();
    const doomed = d.tasks.filter(
      (t) => t.series_id === seriesId && t.created_by === series.created_by && Date.parse(t.due_at) > cutoff,
    );
    removeTasks(d, uid, doomed, seriesId);
    for (const t of d.tasks) {
      if (t.series_id !== seriesId) continue;
      t.recurrence = { ...(t.recurrence ?? series.rule), until };
      t.updated_at = nowIso();
    }
    if (series.group_id && doomed.length > 0) {
      logActivity(d, {
        group_id: series.group_id,
        actor_id: series.created_by,
        kind: 'series_stopped',
        task_title: series.title,
        payload: { removed: doomed.length },
      });
    }
    return doomed.length;
  });
}

/** Edit a task you can see (any member can edit a shared task). */
export async function updateTask(id: string, input: TaskInput) {
  write((d) => {
    const uid = me(d);
    const { recurrence: _ignored, ...row } = clean(input);
    const task = d.tasks.find((t) => t.id === id);
    if (!task || !canSee(d, uid, task)) return;
    updateTaskRow(d, uid, task, row);
  });
}

/** Returns false unless you created the task or own its group (like the delete policy). */
export async function deleteTask(id: string): Promise<boolean> {
  return write((d) => {
    const uid = me(d);
    const task = d.tasks.find((t) => t.id === id);
    if (!task || !canSee(d, uid, task)) return false;
    const ownsGroup = task.group_id !== null && isOwner(d, task.group_id, uid);
    if (task.created_by !== uid && !ownsGroup) return false;
    removeTasks(d, uid, [task]);
    return true;
  });
}

/** Insert several personal tasks at once. */
export async function bulkInsertTasks(rows: TaskSeed[]) {
  write((d) => {
    const uid = me(d);
    for (const r of rows) {
      insertTask(d, uid, {
        title: r.title,
        task_type: r.task_type,
        custom_label: r.custom_label,
        custom_tier: r.custom_tier,
        class_id: r.class_id,
        due_at: r.due_at,
        notes: r.notes,
        created_at: r.created_at,
        weight_pct: null,
        group_id: null,
        series_id: null,
        recurrence: null,
      });
    }
  });
}

/** Delete every task you created whose notes equal `tag` (removes the demo week). */
export async function deleteTaggedTasks(userId: string, tag: string) {
  write((d) => {
    const uid = me(d);
    if (userId !== uid) return;
    removeTasks(
      d,
      uid,
      d.tasks.filter((t) => t.created_by === uid && t.notes === tag && canSee(d, uid, t)),
    );
  });
}

/** Check a task off (or un-check it) for you only. */
export async function setCompleted(taskId: string, done: boolean) {
  write((d) => {
    const uid = me(d);
    const existing = d.task_completions.find((c) => c.task_id === taskId && c.user_id === uid);
    if (!done) {
      if (existing) d.task_completions = d.task_completions.filter((c) => c !== existing);
      return;
    }
    if (existing) return;
    const task = d.tasks.find((t) => t.id === taskId);
    if (!task || !canSee(d, uid, task)) throw new Error('That task no longer exists.');
    d.task_completions.push({ task_id: taskId, user_id: uid, completed_at: nowIso() });
  });
}

/** Keep a personal copy of a deleted shared task, then drop the offer. */
export async function copyRescue(rescue: RescueRow, classId: string | null) {
  write((d) => {
    const uid = me(d);
    const s = rescue.snapshot;
    insertTask(d, uid, {
      title: s.title,
      task_type: s.task_type,
      custom_label: s.custom_label,
      custom_tier: s.custom_tier,
      weight_pct: s.weight_pct,
      due_at: s.due_at,
      notes: s.notes,
      class_id: classId,
      group_id: null,
      series_id: null,
      recurrence: null,
    });
    d.task_rescues = d.task_rescues.filter((r) => !(r.id === rescue.id && r.user_id === uid));
  });
}

export async function dismissRescue(id: number) {
  write((d) => {
    const uid = me(d);
    d.task_rescues = d.task_rescues.filter((r) => !(r.id === id && r.user_id === uid));
  });
}
