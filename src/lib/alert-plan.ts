/**
 * Plans which pepper alerts to schedule on the phone (PRD 5.6 + 5.8).
 *
 * Phones only let an app queue a limited number of local notifications
 * (iOS: 64), so we simulate the next HORIZON_HOURS in 10-minute steps,
 * decide when each alert should fire, and keep the earliest MAX_ALERTS.
 * The plan is rebuilt every time the app opens or a task changes, so the
 * queue keeps refilling and alerts never back off.
 *
 * Cadence by the hottest level at that moment, on a fixed wall-clock grid:
 *   Ghost Pepper  every 10 minutes (:00, :10, :20, ...)
 *   Habanero      every 2 hours, on even hours (8:00, 10:00, ...)
 *   Serrano       once a day at 4:00 PM
 *   Jalapeño      one quiet ping when a task first warms up
 *   Bell Pepper   no alerts
 * Because the times come from the clock, not from when the plan was built,
 * rebuilding the plan (every app open or edit) reproduces the same future
 * alerts and never fires an extra one just because something changed.
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
const STEP_MS = STEP_MIN * 60_000;
const HABANERO_EVERY_HOURS = 2;
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
  const dueOf = new Map(tasks.map((t) => [t.id, t.due_at]));
  const warmed = new Set<string>();
  // Tasks already warm right now don't need a "warming up" ping.
  for (const [id, r] of scorePlate(tasks, now)) {
    if (r.level && r.level !== 'bell') warmed.add(id);
  }

  // First grid point at least a minute from now (phones need a little lead).
  const start = Math.ceil((now.getTime() + 60_000) / STEP_MS) * STEP_MS;
  const end = now.getTime() + horizonHours * 3_600_000;

  for (let ms = start; ms <= end && alerts.length < MAX_ALERTS; ms += STEP_MS) {
    const at = new Date(ms);
    const scores = [...scorePlate(tasks, at).values()].filter((r) => r.level !== null);
    if (scores.length === 0) continue;

    // Nothing fires during quiet hours; anything that warmed up overnight
    // gets its ping after quiet hours end.
    if (inQuietHours(at, quiet)) continue;

    const newlyWarm = scores.filter((r) => r.level !== 'bell' && !warmed.has(r.id));
    const hot = scores
      .filter((r) => r.level === 'ghost' || r.level === 'habanero' || r.level === 'serrano')
      .map((r) => ({ ...r, due_at: dueOf.get(r.id)! }))
      .sort(compareByHeat);
    const top: PepperLevel | null = hot[0]?.level ?? null;

    const onTheHour = at.getMinutes() === 0;
    const fire =
      top === 'ghost' ||
      (top === 'habanero' && onTheHour && at.getHours() % HABANERO_EVERY_HOURS === 0) ||
      (top === 'serrano' && onTheHour && at.getHours() === SERRANO_HOUR);

    if (fire && top) {
      const info = PEPPERS[top];
      const entries = hot.map((r) => ({ title: titleOf.get(r.id)!, level: r.level! }));
      // Tasks that just warmed up ride along instead of being dropped.
      const extra = newlyWarm.filter((r) => !hot.some((h) => h.id === r.id));
      const also = extra.length ? `\nAlso warming up: ${extra.map((r) => titleOf.get(r.id)!).join(', ')}` : '';
      alerts.push({
        at,
        level: top,
        title:
          entries.length > 1
            ? `${info.emoji} ${entries.length} hot tasks. Here's the order`
            : `${info.emoji} ${info.label}: ${entries[0].title}`,
        body: hotList(entries) + also,
        sound: top === 'ghost' || top === 'habanero',
        taskIds: [...hot.map((r) => r.id), ...extra.map((r) => r.id)],
      });
      for (const r of newlyWarm) warmed.add(r.id);
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
      for (const r of newlyWarm) warmed.add(r.id);
    }
  }
  return alerts;
}
