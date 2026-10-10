# Pepper Planner 🌶️🥛

An AI-prioritized, shared academic planner for students (Congressional App Challenge 2026).

Students log tests, quizzes, projects and homework. Every task gets a **pepper level**
(🫑 Bell → 🌶️ Jalapeño → 🌶️ Serrano → 🔥 Habanero → 👻 Ghost Pepper) that heats up as the
deadline gets close, weighted by how much the task counts and how crowded the student's week is.
Finishing a task pours a glass of milk over it. Students create their own groups so one person
logs a shared deadline and it lands in everyone's list, ranked against each person's own workload.

## Stack

| Layer | Tool |
|---|---|
| App | Expo SDK 57 (React Native, Expo Router), runs in Expo Go, iOS, Android and web |
| Backend | Supabase: Postgres + row-level security, Auth, Realtime |
| AI | Claude API, called only from Supabase Edge Functions (the key never ships in the app) |
| Alerts | `expo-notifications` local notifications, rescheduled every time tasks change |

## Run it

Full step-by-step instructions are in the **Setup Guide PDF** (`docs/`). Short version:

```bash
npm install
cp .env.example .env            # paste your Supabase URL + publishable key
npx supabase link --project-ref <your-ref>
npx supabase db push            # creates the tables + security rules
npx supabase secrets set ANTHROPIC_API_KEY=<your key>
npx supabase functions deploy extract-task
npx supabase functions deploy plan-today
npx expo start                  # scan the QR code with Expo Go
```

### Web version on Vercel

`vercel.json` is already set up (single-page build, every path served by `index.html`).
On vercel.com: **Add New → Project → import this repo**, add the two environment variables
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, then **Deploy**.
They are baked into the build, so redeploy after changing them. Pepper alerts are phone-only;
everything else (groups, live sync, AI photo reading, game plan) works on the web.

## Where things live

```
src/app/                 screens (Expo Router: every file is a route)
  (tabs)/index.tsx       Today: day strip, stacked-urgency callout, AI game plan, task lists
  (tabs)/calendar.tsx    month view with class-colored workload dots
  (tabs)/groups.tsx      create / join groups
  (tabs)/me.tsx          profile, classes, quiet hours, demo tools
  task/new.tsx           add a task by hand or by photo (AI fills it, you confirm)
  task/[id].tsx          task details: pepper level, why, check off, edit, delete
  group/[id].tsx         invite code, shared tasks, members, activity feed
src/lib/pepper.ts        THE PEPPER FORMULA (pure functions, fully unit-tested)
src/lib/alert-plan.ts    which alerts fire when (cadence per pepper level, quiet hours)
src/lib/recurrence.ts    recurring tasks (a series template, kept 3 weeks ahead)
src/state/planner.tsx    loads data, live sync (via the group activity feed), scoring, alerts
supabase/migrations/     database tables, triggers, RPCs, row-level security
supabase/functions/      extract-task (Claude Haiku vision), plan-today (Claude Sonnet)
tests/                   unit tests; tests/db = security + AI-function tests (need local Supabase)
```

## Tests

```bash
npm test                 # pepper formula, recurrence, alert planning (36 tests)
npx supabase start       # local Supabase in Docker
npm run test:db          # row-level security end-to-end (23 tests)
npm run typecheck && npx expo lint
```

`tests/db/functions.test.ts` checks the AI functions against a fake Claude server
(`tests/mocks/fake-claude.mjs`), so it runs without spending API credits.

## AI disclosure

Built with help from Claude Code (an AI coding assistant). See the "How It Works" PDF in `docs/`
for the full disclosure and which parts are AI-assisted. In the app itself, AI is used for two
things only: reading assignment photos (Claude Haiku) and writing the daily game plan
(Claude Sonnet). Pepper levels come from a deterministic formula, not from AI.
