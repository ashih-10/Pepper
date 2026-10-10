/**
 * Plans which pepper alerts to schedule on the phone (PRD 5.6 + 5.8).
 *
 * Phones only let an app queue a limited number of local notifications
 * (iOS: 64), so we simulate the next HORIZON_HOURS in 10-minute steps,
 * decide when each alert should fire, and keep the earliest MAX_ALERTS.
 * The plan is rebuilt every time the app opens or a task changes, so the
 * queue keeps refilling and alerts never back off.
 *
 * Cadence by the hottest level at that moment:
 *   Ghost Pepper  every 10 minutes
 *   Habanero      every 2 hours
 *   Serrano       once a day (4 PM)
 *   Jalapeño      one quiet ping when a task first warms up
 *   Bell Pepper   no alerts
 * Every alert lists ALL hot tasks, not just the top one.
 */
import {
  PEPPERS,
  compareByHeat,
  scorePlate,
  type PepperLevel,
  type PepperTask,
} from './pepper';

export const HORIZON_HOURS = 48;
export const MAX_ALERTS = 60;
const STEP_MIN = 10;
const HABANERO_EVERY_MIN = 120;
const SERRANO_HOUR = 16;

export interface AlertTask extends PepperTask {
  title: string;
}

export interface QuietHours {
  enabled: boolean;
  /** Hour (0-23) quiet time starts, e.g. 22. */
  start: number;
  /** Hour (0-23) quiet time ends, e.g. 7. */
  end: number;
}

export interface PlannedAlert {
  at: Date;
  level: PepperLevel;
  title: string;
  body: string;
  /** false = silent ping (lock screen only) */
  sound: boolean;
  taskIds: string[];
}

export function inQuietHours(d: Date, q: QuietHours): boolean {
  if (!q.enabled || q.start === q.end) return false;
  const h = d.getHours();
  return q.start < q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end;
}

function hotList(entries: { title: string; level: PepperLevel }[]): string {
  return entries
    .map((e, i) => `${i + 1}. ${e.title} (${PEPPERS[e.level].label})`)
    .join('\n');
}

export function planAlerts(
  tasks: AlertTask[],
  quiet: QuietHours,
  now: Date = new Date(),
  horizonHours = HORIZON_HOURS,
): PlannedAlert[] {
  const alerts: PlannedAlert[] = [];
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
  const warmed = new Set<string>();
  // Tasks already warm right now don't need a "warming up" ping.
  for (const [id, r] of scorePlate(tasks, now)) {
    if (r.level && r.level !== 'bell') warmed.add(id);
  }

  let lastGhost = -Infinity;
  let lastHabanero = -Infinity;
  const serranoDays = new Set<string>();
  const start = now.getTime() + 60_000;
  const end = now.getTime() + horizonHours * 3_600_000;

  for (let ms = start; ms <= end && alerts.length < MAX_ALERTS; ms += STEP_MIN * 60_000) {
    const at = new Date(ms);
    const scores = [...scorePlate(tasks, at).values()].filter((r) => r.level !== null);
    if (scores.length === 0) continue;

    // Nothing fires during quiet hours; anything that warmed up overnight
    // gets its ping when quiet hours end.
    if (inQuietHours(at, quiet)) continue;

    // New jalapeño-or-hotter tasks get a one-time quiet ping.
    const newlyWarm = scores.filter((r) => r.level !== 'bell' && !warmed.has(r.id));
    for (const r of newlyWarm) warmed.add(r.id);

    const hot = scores
      .filter((r) => r.level === 'ghost' || r.level === 'habanero' || r.level === 'serrano')
      .map((r) => ({ ...r, due_at: tasks.find((t) => t.id === r.id)!.due_at }))
      .sort(compareByHeat);
    const top: PepperLevel | null = hot[0]?.level ?? null;
    const entries = hot.map((r) => ({ title: titleOf.get(r.id)!, level: r.level! }));
    const dayKey = at.toDateString();

    let fire = false;
    if (top === 'ghost' && ms - lastGhost >= STEP_MIN * 60_000) {
      fire = true;
      lastGhost = ms;
    } else if (top === 'habanero' && ms - lastHabanero >= HABANERO_EVERY_MIN * 60_000) {
      fire = true;
      lastHabanero = ms;
    } else if (top === 'serrano' && at.getHours() >= SERRANO_HOUR && !serranoDays.has(dayKey)) {
      fire = true;
      serranoDays.add(dayKey);
    }

    if (fire && top) {
      const info = PEPPERS[top];
      alerts.push({
        at,
        level: top,
        title:
          entries.length > 1
            ? `${info.emoji} ${entries.length} hot tasks. Here's the order`
            : `${info.emoji} ${info.label}: ${entries[0].title}`,
        body: hotList(entries),
        sound: top === 'ghost' || top === 'habanero',
        taskIds: hot.map((r) => r.id),
      });
      continue;
    }

    if (newlyWarm.length > 0) {
      const names = newlyWarm.map((r) => titleOf.get(r.id)!).join(', ');
      alerts.push({
        at,
        level: 'jalapeno',
        title: '🌶️ Warming up',
        body: `${names} ${newlyWarm.length === 1 ? 'is' : 'are'} starting to heat up.`,
        sound: false,
        taskIds: newlyWarm.map((r) => r.id),
      });
    }
  }
  return alerts;
}
