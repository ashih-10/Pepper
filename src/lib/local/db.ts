/**
 * The on-device demo database: one JSON document in this browser's
 * localStorage holding the same tables the server has. Reads come from an
 * in-memory copy; every write edits a fresh copy that replaces it and is saved
 * at once, so a write that throws halfway leaves nothing behind. Storage that
 * is missing, full or corrupt never breaks the app: the demo runs in memory.
 */
import type {
  ActivityRow,
  ClassRow,
  GroupMemberRow,
  GroupRow,
  Profile,
  RescueRow,
  TaskRow,
  TaskSeriesRow,
} from '../types';
import { LOCAL_DB_KEY } from './constants';

/** A row from `task_completions`. */
export interface CompletionRow {
  task_id: string;
  user_id: string;
  completed_at: string;
}

/** How far the scripted classmate has got (each action happens once). */
export interface ClassmateScript {
  sampleGroupId: string | null;
  sampleTestId: string | null;
  movedTest: boolean;
  joinedYourGroup: boolean;
}

/** Everything the demo stores. */
export interface LocalDb {
  version: 1;
  /** The demo student on this device; null before the demo starts. */
  userId: string | null;
  profiles: Profile[];
  classes: ClassRow[];
  tasks: TaskRow[];
  task_series: TaskSeriesRow[];
  task_completions: CompletionRow[];
  groups: GroupRow[];
  group_members: GroupMemberRow[];
  activity: ActivityRow[];
  task_rescues: RescueRow[];
  /** Last ids handed out for the numeric-id tables. */
  counters: { activity: number; rescue: number };
  classmate: ClassmateScript;
}

const TABLES = [
  'profiles',
  'classes',
  'tasks',
  'task_series',
  'task_completions',
  'groups',
  'group_members',
  'activity',
  'task_rescues',
] as const;

function emptyDb(): LocalDb {
  return {
    version: 1,
    userId: null,
    profiles: [],
    classes: [],
    tasks: [],
    task_series: [],
    task_completions: [],
    groups: [],
    group_members: [],
    activity: [],
    task_rescues: [],
    counters: { activity: 0, rescue: 0 },
    classmate: { sampleGroupId: null, sampleTestId: null, movedTest: false, joinedYourGroup: false },
  };
}

/** A deep copy (every stored value is plain JSON). */
export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Parse a stored document; anything unexpected counts as no demo at all. */
function parse(raw: string | null): LocalDb {
  if (!raw) return emptyDb();
  try {
    const data = JSON.parse(raw) as Partial<LocalDb> | null;
    if (!data || typeof data !== 'object' || data.version !== 1) return emptyDb();
    if (TABLES.some((t) => !Array.isArray(data[t]))) return emptyDb();
    // One malformed row would break every later read, so treat it as no demo.
    const isRow = (r: unknown) => !!r && typeof r === 'object' && !Array.isArray(r);
    if (TABLES.some((t) => !(data[t] as unknown[]).every(isRow))) return emptyDb();
    const base = emptyDb();
    const userId =
      typeof data.userId === 'string' && data.profiles!.some((p) => p.id === data.userId) ? data.userId : null;
    const maxId = (rows: { id: number }[]) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    return {
      ...base,
      ...data,
      userId,
      counters: {
        activity: Math.max(Number(data.counters?.activity) || 0, maxId(data.activity ?? [])),
        rescue: Math.max(Number(data.counters?.rescue) || 0, maxId(data.task_rescues ?? [])),
      },
      classmate: { ...base.classmate, ...(data.classmate ?? {}) },
    };
  } catch {
    return emptyDb();
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let cache: LocalDb | null = null;
let draft: LocalDb | null = null;
let pending: (() => void)[] | null = null;

function load(): LocalDb {
  if (!cache) {
    let raw: string | null = null;
    try {
      raw = storage()?.getItem(LOCAL_DB_KEY) ?? null;
    } catch {
      raw = null;
    }
    cache = parse(raw);
  }
  return cache;
}

function save(d: LocalDb) {
  try {
    storage()?.setItem(LOCAL_DB_KEY, JSON.stringify(d));
  } catch {
    // full or blocked: the demo keeps working in memory for this visit
  }
}

/** The current database. Never throws. Treat it as read-only: change it through `write`. */
export function read(): LocalDb {
  return draft ?? load();
}

/**
 * Apply a change atomically: `fn` edits a copy, which replaces the database
 * and is saved only if `fn` returns without throwing. A write inside a write
 * joins the outer one. Callbacks queued with `afterCommit` run once it is saved.
 */
export function write<T>(fn: (d: LocalDb) => T): T {
  if (draft) return fn(draft);
  const next = copy(load());
  const queued: (() => void)[] = [];
  draft = next;
  pending = queued;
  let result: T;
  try {
    result = fn(next);
  } finally {
    draft = null;
    pending = null;
  }
  cache = next;
  save(next);
  for (const cb of queued) cb();
  return result;
}

/** Run `cb` after the current write is saved (right away outside a write). */
export function afterCommit(cb: () => void) {
  if (pending) pending.push(cb);
  else cb();
}

/** Erase the demo from this device. */
export function resetDb() {
  cache = emptyDb();
  try {
    storage()?.removeItem(LOCAL_DB_KEY);
  } catch {
    // nothing stored, or storage blocked: the in-memory copy is already empty
  }
}

const reloadListeners = new Set<() => void>();

/** Forget the in-memory copy so the next read loads storage again. */
export function reload() {
  cache = null;
  for (const cb of reloadListeners) cb();
}

/** Called after `reload` (e.g. another tab changed or erased the demo). Returns an unsubscribe function. */
export function onReload(cb: () => void): () => void {
  reloadListeners.add(cb);
  return () => {
    reloadListeners.delete(cb);
  };
}

// Another tab of the demo saved a change: never write back a stale copy.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === LOCAL_DB_KEY) reload();
  });
}

/** Current time as an ISO string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** A random UUID (same as `randomId` in ../api-cloud, without loading Supabase). */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC 4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** `userId`'s membership row in a group, if any. */
export function memberRow(d: LocalDb, groupId: string, userId: string): GroupMemberRow | undefined {
  return d.group_members.find((m) => m.group_id === groupId && m.user_id === userId);
}

/** Like `is_group_member()` on the server. */
export function isMember(d: LocalDb, groupId: string, userId: string): boolean {
  return memberRow(d, groupId, userId) !== undefined;
}

/** Like `is_group_owner()`: the group's owner who is still a member with the owner role. */
export function isOwner(d: LocalDb, groupId: string, userId: string): boolean {
  const g = d.groups.find((x) => x.id === groupId);
  return !!g && g.owner_id === userId && memberRow(d, groupId, userId)?.role === 'owner';
}

/** Ids of every group `userId` belongs to. */
export function groupIdsOf(d: LocalDb, userId: string): Set<string> {
  return new Set(d.group_members.filter((m) => m.user_id === userId).map((m) => m.group_id));
}
