import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskInput } from '@/lib/api-cloud';
import { addDays, dayKey } from '@/lib/dates';
import { sampleExtract, samplePlan } from '@/lib/local/ai';
import * as api from '@/lib/local/api';
import { JOIN_GROUP_DELAY_MS, MOVE_TEST_DELAY_MS } from '@/lib/local/classmate';
import { CLASSMATE_ID, CLASSMATE_NAME, DEMO_GROUP_CODE, DEMO_GROUP_NAME, LOCAL_DB_KEY } from '@/lib/local/constants';
import { read, reload, write } from '@/lib/local/db';
import { insertTask } from '@/lib/local/rules';
import { endLocalSession, getLocalSession, onLocalSessionChange, startLocalSession } from '@/lib/local/session';
import type { ActivityRow } from '@/lib/types';

/** Minimal in-memory Web Storage: the node test environment has no localStorage. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  } as Storage;
}
const storage = memoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });

// Demo mode must never touch the network.
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network used in demo mode'));
afterAll(() => expect(fetchSpy).not.toHaveBeenCalled());

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

function input(p: Partial<TaskInput> = {}): TaskInput {
  return {
    title: 'Problem set',
    task_type: 'homework',
    custom_label: null,
    custom_tier: null,
    weight_pct: null,
    due_at: inDays(2),
    notes: null,
    class_id: null,
    group_id: null,
    recurrence: null,
    ...p,
  };
}

/** Activity rows of a group straight from the store (visible or not). */
const feed = (groupId: string) => read().activity.filter((a) => a.group_id === groupId);
const kinds = (groupId: string) => feed(groupId).map((a) => a.kind);
const jordanGroupId = () => read().groups.find((g) => g.join_code === DEMO_GROUP_CODE)!.id;
const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

let uid: string;

beforeEach(() => {
  endLocalSession();
  storage.clear();
  uid = startLocalSession().userId;
});

afterEach(() => {
  vi.useRealTimers();
  endLocalSession();
});

describe('demo session', () => {
  it('creates an empty profile and seeds Jordan and his group without joining it', async () => {
    expect(getLocalSession()).toEqual({ userId: uid });
    expect(startLocalSession().userId).toBe(uid); // already running: unchanged
    expect(await api.loadProfile()).toMatchObject({
      id: uid,
      display_name: '',
      onboarded: false,
      quiet_hours_enabled: true,
      quiet_start: 22,
      quiet_end: 7,
    });

    const d = read();
    const group = d.groups.find((g) => g.join_code === DEMO_GROUP_CODE)!;
    expect(group).toMatchObject({ name: DEMO_GROUP_NAME, owner_id: CLASSMATE_ID });
    const shared = d.tasks.filter((t) => t.group_id === group.id);
    expect(shared).toHaveLength(2);
    expect(shared.every((t) => t.created_by === CLASSMATE_ID && t.class_id === null)).toBe(true);
    const daysOut = (type: string) => (Date.parse(shared.find((t) => t.task_type === type)!.due_at) - Date.now()) / DAY;
    expect(daysOut('test')).toBeGreaterThan(3);
    expect(daysOut('test')).toBeLessThan(5);
    expect(daysOut('custom')).toBeGreaterThan(5);
    expect(daysOut('custom')).toBeLessThan(7);

    const planner = await api.loadPlanner();
    expect(planner.groups).toEqual([]);
    expect(planner.tasks).toEqual([]); // Jordan's shared tasks stay hidden until you join
    expect(planner.members).toEqual([]);
    expect(planner.names.get(uid)).toBe('');
    expect(planner.names.has(CLASSMATE_ID)).toBe(false);
    expect(await api.latestActivityId()).toBe(0);
    expect(storage.getItem(LOCAL_DB_KEY)).not.toBeNull();
  });

  it('ending the demo erases it from the device and notifies listeners', async () => {
    const seen: unknown[] = [];
    const off = onLocalSessionChange((s) => seen.push(s));
    endLocalSession();
    off();
    expect(seen).toEqual([null]);
    expect(getLocalSession()).toBeNull();
    expect(storage.getItem(LOCAL_DB_KEY)).toBeNull();
    await expect(api.loadPlanner()).rejects.toThrow('Not signed in');
    expect(startLocalSession().userId).not.toBe(uid);
  });

  it('persists every write and tolerates corrupt storage', async () => {
    const t = await api.createTask(input({ title: 'Saved' }));
    reload(); // forget the in-memory copy: the next read comes from storage
    expect((await api.loadPlanner()).tasks.map((x) => x.id)).toEqual([t.id]);

    storage.setItem(LOCAL_DB_KEY, '{not json');
    reload();
    expect(getLocalSession()).toBeNull();
    expect(startLocalSession().userId).toBeTruthy();
  });

  it('starts over instead of failing on a malformed row or a session with no profile', async () => {
    const doc = JSON.parse(storage.getItem(LOCAL_DB_KEY)!);
    storage.setItem(LOCAL_DB_KEY, JSON.stringify({ ...doc, tasks: [...doc.tasks, null] }));
    reload();
    expect(getLocalSession()).toBeNull();

    startLocalSession();
    const fresh = JSON.parse(storage.getItem(LOCAL_DB_KEY)!);
    storage.setItem(LOCAL_DB_KEY, JSON.stringify({ ...fresh, profiles: [] }));
    reload();
    expect(getLocalSession()).toBeNull();
  });
});

describe('groups', () => {
  it('joins Jordan’s group with the code, then sees its tasks, members and feed', async () => {
    const g = await api.joinGroup('  chem24 ', null);
    expect(g).toMatchObject({ name: DEMO_GROUP_NAME, join_code: DEMO_GROUP_CODE });

    const planner = await api.loadPlanner();
    expect(planner.groups.map((x) => x.id)).toEqual([g.id]);
    expect(planner.tasks).toHaveLength(2);
    expect(planner.members.map((m) => [m.user_id, m.role]).sort()).toEqual(
      [
        [CLASSMATE_ID, 'owner'],
        [uid, 'member'],
      ].sort(),
    );
    expect(planner.names.get(CLASSMATE_ID)).toBe(CLASSMATE_NAME);

    const activity = await api.loadActivity(g.id);
    expect(activity[0]).toMatchObject({ kind: 'member_joined', actor_id: uid });
    expect(activity.filter((a) => a.kind === 'task_added' && a.actor_id === CLASSMATE_ID)).toHaveLength(2);
    expect(await api.latestActivityId()).toBe(activity[0].id);
    expect((await api.activitySince(0)).map((a) => a.id)).toEqual(activity.map((a) => a.id).reverse());

    // already a member: same group back, no second "joined" row
    expect((await api.joinGroup(DEMO_GROUP_CODE, null)).id).toBe(g.id);
    expect(kinds(g.id).filter((k) => k === 'member_joined')).toHaveLength(1);
  });

  it('rejects an unknown code', async () => {
    await expect(api.joinGroup('ZZZZZZ', null)).rejects.toThrow('No group found with that code');
  });

  it('an owner leaving hands the group to the longest-standing member', async () => {
    fakeTimers();
    const g = await api.createGroup('  Bio crew ', null);
    expect(g.name).toBe('Bio crew');
    expect(g.join_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}$/);
    await vi.advanceTimersByTimeAsync(JOIN_GROUP_DELAY_MS); // Jordan joins
    expect(feed(g.id).at(-1)).toMatchObject({ kind: 'member_joined', actor_id: CLASSMATE_ID });

    await api.leaveGroup(g.id);
    const d = read();
    expect(d.groups.find((x) => x.id === g.id)?.owner_id).toBe(CLASSMATE_ID);
    expect(d.group_members.filter((m) => m.group_id === g.id)).toEqual([
      expect.objectContaining({ user_id: CLASSMATE_ID, role: 'owner' }),
    ]);
    expect(feed(g.id).at(-1)).toMatchObject({ kind: 'member_left', actor_id: uid });
    expect((await api.loadPlanner()).groups).toEqual([]);
    await expect(api.leaveGroup(g.id)).rejects.toThrow('not a member of this group');
  });

  it('the last one out deletes the group (and Jordan does not join a deleted group)', async () => {
    fakeTimers();
    const g = await api.createGroup('Solo', null);
    await api.createTask(input({ group_id: g.id }));
    await api.leaveGroup(g.id);
    await vi.advanceTimersByTimeAsync(JOIN_GROUP_DELAY_MS);
    const d = read();
    expect(d.groups.some((x) => x.id === g.id)).toBe(false);
    expect(d.tasks.some((t) => t.group_id === g.id)).toBe(false);
    expect(d.group_members.some((m) => m.group_id === g.id)).toBe(false);
  });

  it('only the owner removes members, and removing one rotates the code', async () => {
    fakeTimers();
    const g = await api.createGroup('Physics', null);
    await vi.advanceTimersByTimeAsync(JOIN_GROUP_DELAY_MS);
    await api.removeMember(g.id, CLASSMATE_ID);
    expect(read().groups.find((x) => x.id === g.id)!.join_code).not.toBe(g.join_code);
    expect(feed(g.id).at(-1)).toMatchObject({ kind: 'member_removed', actor_id: uid, payload: { user_id: CLASSMATE_ID } });
    await expect(api.removeMember(g.id, uid)).rejects.toThrow('use leave_group');

    const next = await api.regenerateJoinCode(g.id);
    expect(read().groups.find((x) => x.id === g.id)!.join_code).toBe(next);

    await api.joinGroup(DEMO_GROUP_CODE, null);
    await expect(api.removeMember(jordanGroupId(), CLASSMATE_ID)).rejects.toThrow('only the owner can remove members');
    await expect(api.regenerateJoinCode(jordanGroupId())).rejects.toThrow('only the owner can change the code');
  });

  it('only the owner can delete a group', async () => {
    const own = await api.createGroup('Mine', null);
    await api.createTask(input({ group_id: own.id }));
    await api.joinGroup(DEMO_GROUP_CODE, null);
    await api.deleteGroup(jordanGroupId()); // not yours: nothing happens
    expect(read().groups.some((g) => g.join_code === DEMO_GROUP_CODE)).toBe(true);
    await api.deleteGroup(own.id);
    expect(read().groups.some((g) => g.id === own.id)).toBe(false);
    expect(read().tasks.some((t) => t.group_id === own.id)).toBe(false);
    expect((await api.loadPlanner()).rescues).toEqual([]); // offers go to the other members only
  });
});

describe('tasks', () => {
  it('creates personal tasks quietly and shared ones with a task_added row', async () => {
    const cls = await api.addClass('Biology', '#1E88E5', 0);
    const t = await api.createTask(input({ title: '  Read ch. 4 ', class_id: cls.id }));
    expect(t).toMatchObject({ title: 'Read ch. 4', created_by: uid, class_id: cls.id, group_id: null });
    expect(read().activity.some((a) => a.task_id === t.id)).toBe(false);

    const g = await api.joinGroup(DEMO_GROUP_CODE, null);
    const shared = await api.createTask(input({ title: 'Group notes', group_id: g.id, class_id: cls.id }));
    expect(shared.class_id).toBeNull(); // shared tasks take each member's class mapping
    expect(feed(g.id).at(-1)).toMatchObject({
      kind: 'task_added',
      actor_id: uid,
      task_id: shared.id,
      task_title: 'Group notes',
      payload: { due_at: shared.due_at, task_type: 'homework', recurring: false },
    });

    await expect(api.createTask(input({ title: '   ' }))).rejects.toThrow();
    await expect(api.createTask(input({ class_id: 'not-my-class' }))).rejects.toThrow('class does not belong');
  });

  it('a recurring task gets a series and a few weeks of instances, announced once', async () => {
    const g = await api.joinGroup(DEMO_GROUP_CODE, null);
    const first = await api.createTask(
      input({ title: 'Reading log', group_id: g.id, due_at: inDays(1), recurrence: { freq: 'daily' } }),
    );
    expect(first.series_id).toBeTruthy();
    const instances = read().tasks.filter((t) => t.series_id === first.series_id);
    expect(instances.length).toBeGreaterThan(15);
    const added = feed(g.id).filter((a) => a.kind === 'task_added' && a.task_title === 'Reading log');
    expect(added).toHaveLength(1);
    expect(added[0].payload.recurring).toBe(true);
    expect(await api.topUpMySeries(uid)).toBe(0); // already generated ahead
  });

  it('stopSeries removes later instances with one series_stopped row and no rescues', async () => {
    const g = await api.joinGroup(DEMO_GROUP_CODE, null);
    const first = await api.createTask(
      input({ title: 'Vocab drill', group_id: g.id, due_at: inDays(1), recurrence: { freq: 'daily' } }),
    );
    const before = read().tasks.filter((t) => t.series_id === first.series_id).length;
    const removed = await api.stopSeries(first.series_id!, new Date(first.due_at));
    expect(removed).toBe(before - 1);

    const left = read().tasks.filter((t) => t.series_id === first.series_id);
    expect(left.map((t) => t.id)).toEqual([first.id]);
    expect(left[0].recurrence?.until).toBe(dayKey(new Date(first.due_at)));
    const rows = feed(g.id).filter((a) => a.task_title === 'Vocab drill');
    expect(rows.map((a) => a.kind)).toEqual(['task_added', 'series_stopped']);
    expect(rows[1].payload).toEqual({ removed });
    expect(read().task_rescues).toEqual([]);
    await expect(api.stopSeries('nope', new Date())).rejects.toThrow('only the person who made');
  });

  it('only the creator or the group owner may delete a task', async () => {
    fakeTimers();
    const g = await api.joinGroup(DEMO_GROUP_CODE, null);
    const jordans = (await api.loadPlanner()).tasks[0];
    expect(await api.deleteTask(jordans.id)).toBe(false);
    expect(read().tasks.some((t) => t.id === jordans.id)).toBe(true);

    const mine = await api.createTask(input({ title: 'Mine to delete', group_id: g.id }));
    expect(await api.deleteTask(mine.id)).toBe(true);
    expect(feed(g.id).at(-1)).toMatchObject({
      kind: 'task_deleted',
      actor_id: uid,
      task_id: mine.id,
      payload: { title: 'Mine to delete', task_type: 'homework' },
    });

    // In a group you own, you may delete Jordan's task too.
    const own = await api.createGroup('Owned', null);
    await vi.advanceTimersByTimeAsync(JOIN_GROUP_DELAY_MS);
    const his = write((d) =>
      insertTask(d, CLASSMATE_ID, { ...input({ title: 'His', group_id: own.id }), series_id: null, recurrence: null }),
    );
    expect(await api.deleteTask(his.id)).toBe(true);
    expect(await api.deleteTask('missing')).toBe(false);
  });

  it('editing a shared task logs due, type and text changes like the trigger', async () => {
    const g = await api.joinGroup(DEMO_GROUP_CODE, null);
    const t = await api.createTask(input({ group_id: g.id }));
    const start = feed(g.id).length;
    const due = inDays(5);
    await api.updateTask(
      t.id,
      input({ title: 'New title', task_type: 'custom', custom_label: 'Lab', custom_tier: 'high', due_at: due, group_id: g.id }),
    );
    const rows = feed(g.id).slice(start);
    expect(rows.map((a) => a.kind)).toEqual(['due_changed', 'type_changed', 'task_edited']);
    expect(rows[0].payload).toEqual({ from: t.due_at, to: due });
    expect(rows[1].payload).toEqual({ from: 'homework', to: 'custom', label: 'Lab' });
    expect(rows[2].payload).toEqual({ old_title: 'Problem set' });

    const jordans = read().tasks.find((x) => x.group_id === g.id && x.created_by === CLASSMATE_ID)!;
    await expect(api.updateTask(jordans.id, input({ title: 'Mine now', group_id: null }))).rejects.toThrow(
      'only the creator can move a task',
    );
  });

  it('completions are private to you and need a visible task', async () => {
    const hidden = read().tasks.find((t) => t.created_by === CLASSMATE_ID)!;
    await expect(api.setCompleted(hidden.id, true)).rejects.toThrow();
    await api.joinGroup(DEMO_GROUP_CODE, null);
    await api.setCompleted(hidden.id, true);
    expect((await api.loadPlanner()).completions.has(hidden.id)).toBe(true);
    await api.setCompleted(hidden.id, false);
    expect((await api.loadPlanner()).completions.has(hidden.id)).toBe(false);
  });

  it('demo-week helpers insert and remove tagged personal tasks; deleting a class clears it', async () => {
    const cls = await api.addClass('History', '#8E24AA', 0);
    const seed = { custom_label: null, custom_tier: null, class_id: cls.id, notes: 'Demo task' };
    await api.bulkInsertTasks([
      { ...seed, title: 'Essay', task_type: 'project', due_at: inDays(3), created_at: inDays(-20) },
      { ...seed, title: 'Map quiz', task_type: 'quiz', due_at: inDays(4), created_at: inDays(0) },
    ]);
    const keep = await api.createTask(input({ class_id: cls.id }));
    expect((await api.loadPlanner()).tasks).toHaveLength(3);
    await api.deleteClass(cls.id);
    expect(read().tasks.every((t) => t.class_id === null)).toBe(true);
    await api.deleteTaggedTasks(uid, 'Demo task');
    expect((await api.loadPlanner()).tasks.map((t) => t.id)).toEqual([keep.id]);
  });
});

describe('live activity', () => {
  it('delivers rows asynchronously, including Jordan moving the test once', async () => {
    fakeTimers();
    const got: ActivityRow[] = [];
    const off = api.subscribeActivity(uid, (r) => got.push(r));
    const g = await api.joinGroup(DEMO_GROUP_CODE, null);
    expect(got).toEqual([]); // not synchronous
    await vi.advanceTimersByTimeAsync(0);
    expect(got.map((r) => r.kind)).toEqual(['member_joined']);

    const test = read().tasks.find((t) => t.group_id === g.id && t.task_type === 'test')!;
    await vi.advanceTimersByTimeAsync(MOVE_TEST_DELAY_MS + 1); // +1: the delivery tick after the move
    const moved = addDays(new Date(test.due_at), -1).toISOString();
    expect(read().tasks.find((t) => t.id === test.id)!.due_at).toBe(moved);
    expect(got.at(-1)).toMatchObject({
      kind: 'due_changed',
      actor_id: CLASSMATE_ID,
      task_id: test.id,
      payload: { from: test.due_at, to: moved },
    });

    // leaving and rejoining does not replay it
    await api.leaveGroup(g.id);
    await api.joinGroup(DEMO_GROUP_CODE, null);
    await vi.advanceTimersByTimeAsync(MOVE_TEST_DELAY_MS);
    expect(feed(g.id).filter((a) => a.kind === 'due_changed')).toHaveLength(1);

    off();
    const count = got.length;
    await api.createTask(input({ group_id: g.id }));
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toHaveLength(count);
  });

  it('only delivers rows of groups you are in', async () => {
    fakeTimers();
    const got: ActivityRow[] = [];
    const off = api.subscribeActivity(uid, (r) => got.push(r));
    write((d) =>
      insertTask(d, CLASSMATE_ID, { ...input({ group_id: jordanGroupId() }), series_id: null, recurrence: null }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual([]);
    off();
  });

  it('scripted classmate timers do nothing after the demo is reset', async () => {
    fakeTimers();
    await api.joinGroup(DEMO_GROUP_CODE, null);
    await api.createGroup('Reset me', null);
    endLocalSession();
    startLocalSession();
    await vi.advanceTimersByTimeAsync(MOVE_TEST_DELAY_MS + JOIN_GROUP_DELAY_MS);
    expect(read().activity.some((a) => a.kind === 'due_changed' || a.kind === 'member_joined')).toBe(false);
  });
});

describe('demo AI', () => {
  it('returns two labeled sample tasks using the first class name', async () => {
    const now = new Date();
    const res = await sampleExtract(['AP Chemistry', 'English 10'], now);
    expect(res.message).toBe('Demo mode: these are sample results, not a real reading of your photo.');
    expect(res.tasks).toHaveLength(2);
    expect(res.tasks.every((t) => t.class_name === 'AP Chemistry')).toBe(true);
    expect(res.tasks[1].unclear).toEqual(['due_time', 'weight_pct']);
    expect(res.tasks[1].question).toBeTruthy();
    expect(res.tasks[0].due_date! > dayKey(now)).toBe(true);
    expect((await sampleExtract([], now)).tasks[0].class_name).toBeNull();
  });

  it('builds a sample plan in the given order', async () => {
    const task = (id: string, kind: string) => ({ id, title: id, kind, class_name: null, due: 'Today', pepper: 'Hot' });
    const plan = await samplePlan([task('b', 'Test'), task('a', 'Lab'), task('c', 'Form')], 'Mon 4:00 PM');
    expect(plan.headline).toMatch(/sample/i);
    expect(plan.steps.map((s) => s.task_id)).toEqual(['b', 'a', 'c']);
    expect(plan.steps.every((s) => s.tip.length > 0 && s.minutes > 0)).toBe(true);
    expect(plan.closing).toBeTruthy();
  });
});
