/**
 * End-to-end tests for the AI edge functions, run against `supabase functions
 * serve` with ANTHROPIC_BASE_URL pointed at tests/mocks/fake-claude.mjs.
 * Run with: npm run test:functions  (see README)
 */
import fs from 'node:fs';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.API_URL;
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_ROLE_KEY;
const FN = process.env.FUNCTIONS_URL;
const LOG = process.env.FAKE_CLAUDE_LOG;
const run = URL && ANON && SERVICE && LOG && (FN || process.env.FN_URL_EXTRACT_TASK) ? describe : describe.skip;
// Optional per-function URL override, e.g. FN_URL_EXTRACT_TASK, when running a
// function directly with `deno run` instead of `supabase functions serve`.
const fnUrl = (name: string) => process.env[`FN_URL_${name.replace('-', '_').toUpperCase()}`] ?? `${FN}/${name}`;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
// 1x1 PNG, padded so it passes the minimum-length check
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='.padEnd(120, 'A');

run('AI edge functions', () => {
  let token: string;
  let client: SupabaseClient;

  beforeAll(async () => {
    const admin = createClient(URL!, SERVICE!, opts);
    const email = `fn-${Date.now()}@test.dev`;
    await admin.auth.admin.createUser({ email, password: 'pw-1234567', email_confirm: true });
    client = createClient(URL!, ANON!, opts);
    const { data } = await client.auth.signInWithPassword({ email, password: 'pw-1234567' });
    token = data.session!.access_token;
    await client.from('profiles').update({ struggles: 'I procrastinate on essays' }).eq('id', data.user!.id);
    fs.writeFileSync(LOG!, '');
  });

  const call = (name: string, body: unknown, auth = true) =>
    fetch(fnUrl(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  const lastRequest = () => {
    const lines = fs.readFileSync(LOG!, 'utf8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  };

  it('rejects calls without a login', async () => {
    const res = await call('extract-task', {}, false);
    expect(res.status).toBe(401);
  });

  it('rejects malformed requests before calling Claude', async () => {
    const res = await call('extract-task', { image: 'x' });
    expect(res.status).toBe(400);
  });

  it('extracts tasks from a photo and cleans up the result', async () => {
    const res = await call('extract-task', {
      image: PNG,
      media_type: 'image/png',
      today: '2026-10-12',
      weekday: 'Monday',
      timezone: 'America/Chicago',
      classes: ['AP Chem', 'English'],
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.tasks).toHaveLength(2);
    expect(out.tasks[0].class_name).toBe('AP Chem'); // case-matched to the real class
    expect(out.tasks[1].class_name).toBeNull(); // not one of the student's classes
    expect(out.tasks[1].unclear).toEqual(expect.arrayContaining(['due_date', 'class']));
    expect(out.tasks[1].due_date).toBeNull(); // 2026-13-40 is not a real date
    expect(out.tasks[1].custom_tier).toBe('medium');

    const req = lastRequest();
    expect(req.body.model).toBe('claude-haiku-5-5');
    expect(req.body.output_config.effort).toBe('medium');
    expect(req.body.output_config.format.type).toBe('json_schema');
    expect(req.body.messages[0].content[0].type).toBe('image');
    expect(req.headers['x-api-key']).toBe('test-key-not-real');
  });

  it('builds a game plan in the formula order and drops unknown tasks', async () => {
    const res = await call('plan-today', {
      now: 'Monday 4:00 PM',
      timezone: 'America/Chicago',
      tasks: [
        { id: 'a1', title: 'Essay', kind: 'Essay', class_name: 'English', due: 'today 11:59 PM', pepper: 'Ghost Pepper' },
        { id: 'b2', title: 'Unit 3 Test', kind: 'Test', class_name: 'AP Chem', due: 'tomorrow 8:00 AM', pepper: 'Habanero' },
      ],
    });
    expect(res.status).toBe(200);
    const plan = await res.json();
    expect(plan.steps.map((s: { task_id: string }) => s.task_id)).toEqual(['a1', 'b2']);

    const req = lastRequest();
    expect(req.body.model).toBe('claude-sonnet-5-5');
    expect(req.body.fallbacks).toBe('default');
    expect(req.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(JSON.stringify(req.body.messages)).toContain('I procrastinate on essays');
  });

  it("enforces the daily AI limit", async () => {
    for (let i = 0; i < 40; i++) await client.rpc('use_ai_quota');
    const res = await call('plan-today', {
      now: 'x',
      timezone: 'UTC',
      tasks: [{ id: 'a', title: 'A', kind: 'Test', class_name: null, due: 'today', pepper: 'Ghost Pepper' }],
    });
    expect(res.status).toBe(429);
  });
});
