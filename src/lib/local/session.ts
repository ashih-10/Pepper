/**
 * The demo "sign-in": a student created on this device, plus Jordan (a
 * scripted classmate) and his study group to join with a code. Everything
 * lives in this browser's storage; ending the demo erases it.
 */
import { addDays, combine, dayKey } from '../dates';
import type { Profile } from '../types';
import { cancelClassmate } from './classmate';
import { CLASSMATE_ID, CLASSMATE_NAME, DEMO_GROUP_CODE, DEMO_GROUP_NAME } from './constants';
import { onReload, randomId, read, resetDb, write, type LocalDb } from './db';
import { insertTask } from './rules';

export interface LocalSession {
  userId: string;
}

const listeners = new Set<(s: LocalSession | null) => void>();
/** The student id last handed out, to spot another tab starting or ending the demo. */
let lastSeen: string | null = null;

function notify() {
  const s = getLocalSession();
  for (const cb of listeners) cb(s);
}

onReload(() => {
  const before = lastSeen;
  if ((getLocalSession()?.userId ?? null) !== before) {
    cancelClassmate();
    notify();
  }
});

/** A profile row with the database defaults. */
function profile(id: string, patch: Partial<Profile> = {}): Profile {
  return {
    id,
    display_name: '',
    education_level: null,
    grade: null,
    goals: null,
    struggles: null,
    quiet_hours_enabled: true,
    quiet_start: 22,
    quiet_end: 7,
    onboarded: false,
    ...patch,
  };
}

/** The demo student, Jordan, and Jordan's group with two shared tasks (the student is not in it yet). */
function seed(d: LocalDb, userId: string, now: Date) {
  d.userId = userId;
  d.profiles.push(profile(userId), profile(CLASSMATE_ID, { display_name: CLASSMATE_NAME, onboarded: true }));
  const since = addDays(now, -3).toISOString();
  const groupId = randomId();
  d.groups.push({ id: groupId, name: DEMO_GROUP_NAME, owner_id: CLASSMATE_ID, join_code: DEMO_GROUP_CODE, created_at: since });
  d.group_members.push({ group_id: groupId, user_id: CLASSMATE_ID, role: 'owner', class_id: null, joined_at: since });
  const shared = { group_id: groupId, class_id: null, weight_pct: null, series_id: null, recurrence: null };
  const test = insertTask(d, CLASSMATE_ID, {
    ...shared,
    title: 'Unit 4 Test: Stoichiometry',
    task_type: 'test',
    custom_label: null,
    custom_tier: null,
    due_at: combine(dayKey(addDays(now, 4)), '08:00').toISOString(),
    notes: 'Calculators allowed. Review the mole-ratio worksheet.',
    created_at: since,
  });
  insertTask(d, CLASSMATE_ID, {
    ...shared,
    title: 'Titration lab write-up',
    task_type: 'custom',
    custom_label: 'Lab',
    custom_tier: 'medium',
    due_at: combine(dayKey(addDays(now, 6)), '23:59').toISOString(),
    notes: null,
    created_at: addDays(now, -2).toISOString(),
  });
  // Jordan added these days ago: date their feed entries to match.
  for (const a of d.activity) {
    const t = d.tasks.find((x) => x.id === a.task_id);
    if (t) a.created_at = t.created_at;
  }
  d.classmate = { sampleGroupId: groupId, sampleTestId: test.id, movedTest: false, joinedYourGroup: false };
}

/** The demo "signed-in" student on this device, or null before the demo starts. */
export function getLocalSession(): LocalSession | null {
  const userId = read().userId;
  lastSeen = userId;
  return userId ? { userId } : null;
}

/**
 * Start the demo: creates the on-device student, Jordan and the sample group.
 * If a demo is already running on this device, returns it unchanged.
 */
export function startLocalSession(): LocalSession {
  const existing = getLocalSession();
  if (existing) return existing;
  cancelClassmate();
  resetDb();
  const userId = randomId();
  write((d) => seed(d, userId, new Date()));
  notify();
  return { userId };
}

/** Leave the demo and erase everything it stored on this device. */
export function endLocalSession(): void {
  cancelClassmate();
  resetDb();
  notify();
}

/** Called whenever the demo session starts or ends. Returns an unsubscribe function. */
export function onLocalSessionChange(cb: (s: LocalSession | null) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
