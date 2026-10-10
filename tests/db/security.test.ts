/**
 * End-to-end security tests against a real Supabase stack (auth + REST + RLS).
 * Run with: npm run test:db   (needs `npx supabase start` running locally)
 *
 * Three students: Alice (group owner), Bob (member), Carol (outsider).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.API_URL;
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_ROLE_KEY;
const run = URL && ANON && SERVICE ? describe : describe.skip;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function newStudent(name: string) {
  const admin = createClient(URL!, SERVICE!, opts);
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.dev`;
  const password = 'test-password-123';
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw error;
  const client = createClient(URL!, ANON!, opts);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

run('row-level security', () => {
  let alice: { id: string; client: SupabaseClient };
  let bob: { id: string; client: SupabaseClient };
  let carol: { id: string; client: SupabaseClient };
  let aliceClassId: string;
  let bobClassId: string;
  let groupId: string;
  let joinCode: string;
  let sharedTaskId: string;
  let personalTaskId: string;

  beforeAll(async () => {
    [alice, bob, carol] = await Promise.all([
      newStudent('Alice'),
      newStudent('Bob'),
      newStudent('Carol'),
    ]);
    const a = await alice.client
      .from('classes')
      .insert({ name: 'AP Chem', color: '#E53935' })
      .select()
      .single();
    expect(a.error).toBeNull();
    aliceClassId = a.data!.id;
    const b = await bob.client
      .from('classes')
      .insert({ name: 'Chemistry', color: '#1E88E5' })
      .select()
      .single();
    bobClassId = b.data!.id;
  });

  it('creates a profile on sign-up and returns it via get_my_profile', async () => {
    const { data } = await alice.client.rpc('get_my_profile').maybeSingle<{ display_name: string; onboarded: boolean }>();
    expect(data?.display_name).toBe('Alice');
    expect(data?.onboarded).toBe(false);
  });

  it('keeps personal tasks private', async () => {
    const { data, error } = await alice.client
      .from('tasks')
      .insert({ title: 'Read ch. 4', task_type: 'homework', due_at: inDays(2), class_id: aliceClassId })
      .select()
      .single();
    expect(error).toBeNull();
    personalTaskId = data!.id;
    const seenByBob = await bob.client.from('tasks').select('id').eq('id', personalTaskId);
    expect(seenByBob.data).toEqual([]);
  });

  it("refuses a task filed under someone else's class", async () => {
    const { error } = await bob.client
      .from('tasks')
      .insert({ title: 'Sneaky', task_type: 'quiz', due_at: inDays(1), class_id: aliceClassId });
    expect(error).not.toBeNull();
  });

  it('creates a group via RPC and lets a classmate join by code', async () => {
    const created = await alice.client.rpc('create_group', { p_name: 'AP Chem P3', p_class_id: aliceClassId });
    expect(created.error).toBeNull();
    groupId = created.data.id;
    joinCode = created.data.join_code;
    expect(joinCode).toMatch(/^[A-Z2-9]{6}$/);

    const joined = await bob.client.rpc('join_group', { p_code: joinCode.toLowerCase(), p_class_id: bobClassId });
    expect(joined.error).toBeNull();
    expect(joined.data.id).toBe(groupId);

    const roster = await bob.client.from('group_members').select('user_id, role').eq('group_id', groupId);
    expect(roster.data).toHaveLength(2);
  });

  it('returns nothing for a bad join code', async () => {
    const { data, error } = await carol.client.rpc('join_group', { p_code: 'ZZZZZZ' });
    expect(error).toBeNull();
    expect(data?.id ?? null).toBeNull();
  });

  it("keeps groupmates' onboarding answers private", async () => {
    await alice.client.from('profiles').update({ struggles: 'private answer', goals: 'g' }).eq('id', alice.id);
    const peek = await bob.client.from('profiles').select('struggles').eq('id', alice.id);
    expect(peek.error).not.toBeNull();
    const own = await alice.client.rpc('get_my_profile').maybeSingle<{ struggles: string }>();
    expect(own.data?.struggles).toBe('private answer');
  });

  it('shows groupmates names but hides strangers', async () => {
    const bobSeesAlice = await bob.client.from('profiles').select('display_name').eq('id', alice.id);
    expect(bobSeesAlice.data?.[0]?.display_name).toBe('Alice');
    const carolSeesAlice = await carol.client.from('profiles').select('display_name').eq('id', alice.id);
    expect(carolSeesAlice.data).toEqual([]);
  });

  it('shares a task with members only', async () => {
    const { data, error } = await alice.client
      .from('tasks')
      .insert({ title: 'Unit 3 Test', task_type: 'test', due_at: inDays(5), group_id: groupId })
      .select()
      .single();
    expect(error).toBeNull();
    sharedTaskId = data!.id;
    expect((await bob.client.from('tasks').select('id').eq('id', sharedTaskId)).data).toHaveLength(1);
    expect((await carol.client.from('tasks').select('id').eq('id', sharedTaskId)).data).toEqual([]);
    const feed = await bob.client.from('activity').select('kind').eq('group_id', groupId);
    expect(feed.data?.map((r) => r.kind)).toContain('task_added');
  });

  it('keeps completion of a shared task private to each student', async () => {
    const done = await bob.client.from('task_completions').insert({ task_id: sharedTaskId });
    expect(done.error).toBeNull();
    const aliceView = await alice.client.from('task_completions').select('*').eq('task_id', sharedTaskId);
    expect(aliceView.data).toEqual([]);
    await bob.client.from('task_completions').delete().eq('task_id', sharedTaskId);
  });

  it('cannot complete a task you cannot see', async () => {
    const { error } = await carol.client.from('task_completions').insert({ task_id: sharedTaskId });
    expect(error).not.toBeNull();
  });

  it('logs a due-date change to the group feed', async () => {
    const newDue = inDays(3);
    const upd = await bob.client.from('tasks').update({ due_at: newDue }).eq('id', sharedTaskId);
    expect(upd.error).toBeNull();
    const feed = await alice.client
      .from('activity')
      .select('kind, actor_id, payload')
      .eq('group_id', groupId)
      .eq('kind', 'due_changed');
    expect(feed.data).toHaveLength(1);
    expect(feed.data![0].actor_id).toBe(bob.id);
  });

  it('blocks writes to protected columns and internal functions', async () => {
    const steal = await bob.client.from('tasks').update({ created_by: bob.id }).eq('id', sharedTaskId);
    expect(steal.error).not.toBeNull();
    const promote = await bob.client.from('group_members').update({ role: 'owner' }).eq('user_id', bob.id);
    expect(promote.error).not.toBeNull();
    const rename = await bob.client.from('groups').update({ name: 'Hacked' }).eq('id', groupId).select();
    expect(rename.data ?? []).toEqual([]);
    const forge = await bob.client.from('activity').insert({ group_id: groupId, kind: 'task_added' });
    expect(forge.error).not.toBeNull();
    const internal = await bob.client.rpc('new_join_code');
    expect(internal.error).not.toBeNull();
  });

  it("does not let a member move someone else's shared task to another group", async () => {
    const solo = await bob.client.rpc('create_group', { p_name: 'Bob solo' });
    const move = await bob.client.from('tasks').update({ group_id: solo.data.id }).eq('id', sharedTaskId);
    expect(move.error?.message).toMatch(/only the creator/);
    expect((await alice.client.from('tasks').select('id').eq('id', sharedTaskId)).data).toHaveLength(1);
    await bob.client.from('groups').delete().eq('id', solo.data.id);
  });

  it("does not let a member delete someone else's shared task", async () => {
    const del = await bob.client.from('tasks').delete().eq('id', sharedTaskId).select();
    expect(del.data ?? []).toEqual([]);
    expect((await alice.client.from('tasks').select('id').eq('id', sharedTaskId)).data).toHaveLength(1);
  });

  it('offers other members a copy when a shared task is deleted', async () => {
    const del = await alice.client.from('tasks').delete().eq('id', sharedTaskId);
    expect(del.error).toBeNull();
    const bobOffers = await bob.client.from('task_rescues').select('*');
    expect(bobOffers.data).toHaveLength(1);
    expect(bobOffers.data![0].snapshot.title).toBe('Unit 3 Test');
    const aliceOffers = await alice.client.from('task_rescues').select('*');
    expect(aliceOffers.data).toEqual([]);
    await bob.client.from('task_rescues').delete().eq('id', bobOffers.data![0].id);
  });

  it('hands ownership to the next member when the owner leaves', async () => {
    const left = await alice.client.rpc('leave_group', { p_group_id: groupId });
    expect(left.error).toBeNull();
    const g = await bob.client.from('groups').select('owner_id').eq('id', groupId).single();
    expect(g.data?.owner_id).toBe(bob.id);
    expect((await alice.client.from('groups').select('id').eq('id', groupId)).data).toEqual([]);
  });

  it('offers copies of all tasks when an owner deletes the group', async () => {
    await alice.client.rpc('join_group', { p_code: joinCode });
    await bob.client
      .from('tasks')
      .insert({ title: 'Lab report', task_type: 'custom', custom_label: 'Lab', custom_tier: 'medium', due_at: inDays(4), group_id: groupId });
    const del = await bob.client.from('groups').delete().eq('id', groupId);
    expect(del.error).toBeNull();
    const offers = await alice.client.from('task_rescues').select('reason, group_name, snapshot');
    expect(offers.data).toHaveLength(1);
    expect(offers.data![0].reason).toBe('group_deleted');
    expect(offers.data![0].snapshot.custom_label).toBe('Lab');
  });

  it('rotates the code when a member is removed, and only the owner can rotate it', async () => {
    const dave = await newStudent('Dave');
    const g = await dave.client.rpc('create_group', { p_name: 'Rotate test' });
    const oldCode = g.data.join_code;
    await carol.client.rpc('join_group', { p_code: oldCode });
    const notOwner = await carol.client.rpc('regenerate_join_code', { p_group_id: g.data.id });
    expect(notOwner.error).not.toBeNull();
    expect((await dave.client.rpc('remove_member', { p_group_id: g.data.id, p_user_id: carol.id })).error).toBeNull();
    const rejoin = await carol.client.rpc('join_group', { p_code: oldCode });
    expect(rejoin.data?.id ?? null).toBeNull();
    const fresh = await dave.client.rpc('regenerate_join_code', { p_group_id: g.data.id });
    expect(fresh.data).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('rate-limits wrong join codes', async () => {
    const eve = await newStudent('Eve');
    for (let i = 0; i < 20; i++) await eve.client.rpc('join_group', { p_code: 'QQQQQQ' });
    const blocked = await eve.client.rpc('join_group', { p_code: 'QQQQQQ' });
    expect(blocked.error?.message).toMatch(/Too many attempts/);
  });

  it("only lets a series' creator add tasks to it", async () => {
    const series = await alice.client
      .from('task_series')
      .insert({ title: 'Reading log', task_type: 'homework', rule: { freq: 'daily' }, first_due: inDays(1), generated_until: inDays(1) })
      .select()
      .single();
    expect(series.error).toBeNull();
    const mine = await alice.client.from('tasks').insert({ title: 'Reading log', task_type: 'homework', due_at: inDays(1), series_id: series.data!.id });
    expect(mine.error).toBeNull();
    const squat = await bob.client.from('tasks').insert({ title: 'x', task_type: 'homework', due_at: inDays(2), series_id: series.data!.id });
    expect(squat.error).not.toBeNull();
    expect((await bob.client.from('task_series').select('id').eq('id', series.data!.id)).data).toEqual([]);
  });

  it('stops a shared series with one feed entry and no copy offers', async () => {
    const sam = await newStudent('Sam');
    const g = await sam.client.rpc('create_group', { p_name: 'Stopper' });
    expect((await bob.client.rpc('join_group', { p_code: g.data.join_code })).error).toBeNull();
    const series = await sam.client
      .from('task_series')
      .insert({ group_id: g.data.id, title: 'Vocab', task_type: 'homework', rule: { freq: 'daily' }, first_due: inDays(1), generated_until: inDays(4) })
      .select()
      .single();
    expect(series.error).toBeNull();
    const rows = [1, 2, 3, 4].map((d) => ({
      group_id: g.data.id, title: 'Vocab', task_type: 'homework', due_at: inDays(d), series_id: series.data!.id, recurrence: { freq: 'daily' },
    }));
    expect((await sam.client.from('tasks').insert(rows)).error).toBeNull();

    const notMine = await bob.client.rpc('stop_series', { p_series_id: series.data!.id, p_after: inDays(1), p_until: '2099-01-01' });
    expect(notMine.error).not.toBeNull();

    const stop = await sam.client.rpc('stop_series', { p_series_id: series.data!.id, p_after: inDays(1), p_until: inDays(1).slice(0, 10) });
    expect(stop.error).toBeNull();
    expect(stop.data).toBe(3);
    const left = await bob.client.from('tasks').select('recurrence').eq('series_id', series.data!.id);
    expect(left.data).toHaveLength(1);
    expect(left.data![0].recurrence.until).toBe(inDays(1).slice(0, 10));
    const feed = await bob.client.from('activity').select('kind').eq('group_id', g.data.id);
    expect(feed.data!.filter((a) => a.kind === 'series_stopped')).toHaveLength(1);
    expect(feed.data!.filter((a) => a.kind === 'task_deleted')).toHaveLength(0);
    const offers = await bob.client.from('task_rescues').select('id').eq('group_name', 'Stopper');
    expect(offers.data).toEqual([]);
  });

  it('hands a group to the next member when the owner deletes their account', async () => {
    const owner = await newStudent('Owner');
    const g = await owner.client.rpc('create_group', { p_name: 'Handoff' });
    await bob.client.rpc('join_group', { p_code: g.data.join_code });
    await owner.client.from('tasks').insert({ title: 'Quiz', task_type: 'quiz', due_at: inDays(2), group_id: g.data.id });
    const admin = createClient(URL!, SERVICE!, opts);
    const del = await admin.auth.admin.deleteUser(owner.id);
    expect(del.error).toBeNull();
    const after = await bob.client.from('groups').select('owner_id').eq('id', g.data.id).single();
    expect(after.data?.owner_id).toBe(bob.id);
  });

  it('gives signed-out visitors nothing', async () => {
    const anon = createClient(URL!, ANON!, opts);
    const { data } = await anon.from('tasks').select('id');
    expect(data ?? []).toEqual([]);
  });
});
