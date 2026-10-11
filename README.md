# Pepper Planner 🌶️🥛

An AI-prioritized, shared academic planner for students (Congressional App Challenge 2026).

Students log tests, quizzes, projects and homework. Every task gets a **pepper level**
(🫑 Bell → 🌶️ Jalapeño → 🌶️ Serrano → 🔥 Habanero → 👻 Ghost Pepper) that heats up as the
deadline gets close, weighted by how much the task counts and how crowded the student's week is.
Finishing a task pours a glass of milk over it. Students create their own groups so one person
logs a shared deadline and it lands in everyone's list, ranked against each person's own workload.

**Live demo: https://ashih-10.github.io/Pepper/** (no sign-up). Until a Supabase project is connected it runs as
an on-device demo: your data is kept only in that browser's storage and nothing is sent anywhere, so photo
reading and the game plan use built-in samples instead of Claude. Join the sample group with code `CHEM24` to see
shared deadlines.

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

Just want to look around? Run `npm install && npx expo start` with no `.env`: without Supabase settings
the app runs in **Demo mode** (everything stays on the device, nothing is sent to a server).

### Deploy: GitHub Pages

`.github/workflows/pages.yml` runs on every push to `main`: typecheck, lint, unit tests, then
`expo export -p web` under the `/Pepper` base path, published to the `gh-pages` branch.

1. **One time:** after the first **Deploy to GitHub Pages** run finishes (Actions tab), go to
   **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `gh-pages`,
   folder `/ (root)`, **Save**. The site appears at the link above a minute or two later.
2. **Switch the live site from the demo to the real app:** **Settings → Secrets and variables → Actions →
   Variables**, add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (variables, not
   secrets: both are public by design, row-level security protects the data). Then **Actions → Deploy to GitHub
   Pages → Run workflow**. In Supabase, **Auth → URL Configuration**: add `https://ashih-10.github.io/Pepper/`
   to **Redirect URLs** (and as **Site URL** if this is the main site). Delete the variables and
   re-run the workflow to go back to the demo.

Note: every GitHub Pages site of an account shares the `ashih-10.github.io` origin, so its browser storage
(the demo's data, or the sign-in session once the real app is connected) is readable by the account's other
Pages sites. Don't host other people's content on this account's Pages, or use Vercel or a custom domain for
the real app.

### Deploy: Vercel

`vercel.json` is already set up (single-page build, every path served by `index.html`, site at the root).
On vercel.com: **Add New → Project → import this repo**, add the two environment variables
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, then **Deploy** (without them it
deploys the demo). They are baked into the build, so redeploy after changing them, and add the Vercel URL to
Supabase's Redirect URLs. Pepper alerts are phone-only; everything else (groups, live sync, AI photo reading,
game plan) works on the web.

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
src/lib/api.ts           data layer: Supabase (api-cloud.ts) or the on-device demo (local/), same functions
supabase/migrations/     database tables, triggers, RPCs, row-level security
supabase/functions/      extract-task (Claude Haiku vision), plan-today (Claude Sonnet)
tests/                   unit tests; tests/db = security + AI-function tests (need local Supabase)
```

## Tests

```bash
npm test                 # pepper formula, recurrence, alerts, on-device demo backend (58 tests)
npx supabase start       # local Supabase in Docker
npm run test:db          # row-level security end-to-end (27 attack tests)
npm run typecheck && npx expo lint
```

`tests/db/functions.test.ts` checks the AI functions against a fake Claude server
(`tests/mocks/fake-claude.mjs`), so it runs without spending API credits.

## AI disclosure

Built with help from Claude Code (an AI coding assistant). See the "How It Works" PDF in `docs/`
for the full disclosure and which parts are AI-assisted. In the app itself, AI is used for two
things only: reading assignment photos (Claude Haiku) and writing the daily game plan
(Claude Sonnet). Pepper levels come from a deterministic formula, not from AI.
