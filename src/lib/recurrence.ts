/**
 * Recurring tasks (daily reading log, weekly worksheet, ...).
 * Set the pattern once; the app keeps generating the next few weeks of
 * instances, like a scheduled job that runs whenever the app opens.
 *
 * A series is generated from its own record (task_series), never from the
 * instances that happen to survive: `firstDue` is the fixed anchor (time of
 * day, weekday) and `generatedUntil` is a watermark. Everything up to the
 * watermark was already generated (or deliberately skipped), so deleting or
 * editing an instance never brings it back or shifts the series.
 */
import { formatDate, fromDayKey } from './dates';
import type { Recurrence } from './types';

/** How far ahead to keep instances generated. */
export const HORIZON_DAYS = 21;
/** Safety cap so a bad rule can never create thousands of rows. */
const MAX_INSTANCES = 60;
const DAY_MS = 86_400_000;

/** End of the rule's `until` day (local time), or +Infinity when open-ended. */
function untilEnd(until: string | null | undefined): number {
  if (!until) return Number.POSITIVE_INFINITY;
  const [y, m, d] = until.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/** Whole local calendar days from `a` to `b` (DST-proof). */
function calendarDays(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / DAY_MS);
}

/**
 * Occurrences strictly after `after` and no later than `end` (ms), anchored
 * at `anchor` (not itself included: it is the series' first instance).
 * Each date is built from the anchor's local wall-clock fields, so the time
 * of day survives DST changes and never drifts.
 */
function occurrences(rule: Recurrence, anchor: Date, after: number, end: number): Date[] {
  const out: Date[] = [];
  const at = (k: number) =>
    new Date(
      anchor.getFullYear(),
      anchor.getMonth(),
      anchor.getDate() + k,
      anchor.getHours(),
      anchor.getMinutes(),
      anchor.getSeconds(),
      anchor.getMilliseconds(),
    );
  const stride = rule.freq === 'weekly' ? 7 : 1;
  // Jump straight to the day of `after`: anything on an earlier day is <= after.
  const skip = Math.max(0, calendarDays(anchor, new Date(after)));
  let k = Math.max(stride, Math.ceil(skip / stride) * stride);
  for (let guard = 0; guard < 1000 && out.length < MAX_INSTANCES; guard++, k += stride) {
    const d = at(k);
    if (d.getTime() > end) break;
    if (rule.freq === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) continue;
    if (d.getTime() > after) out.push(d);
  }
  return out;
}

/**
 * Occurrences strictly after `after`, up to `horizonEnd` and the rule's
 * `until` date. `anchor` fixes the time of day and, for weekly rules, the
 * weekday.
 */
export function nextOccurrences(rule: Recurrence, anchor: Date, after: Date, horizonEnd: Date): Date[] {
  return occurrences(rule, anchor, after.getTime(), Math.min(horizonEnd.getTime(), untilEnd(rule.until)));
}

/**
 * Instances to add to a series so it covers the next `horizonDays`.
 * Only future dates after the watermark are returned (no backfill of days
 * missed while the app was closed). The returned watermark is where the
 * next top-up resumes; store it even when `dates` is empty.
 */
export function seriesTopUp(
  rule: Recurrence,
  firstDue: Date,
  generatedUntil: Date,
  now: Date = new Date(),
  horizonDays: number = HORIZON_DAYS,
): { dates: Date[]; generatedUntil: Date } {
  const upper = Math.min(now.getTime() + horizonDays * DAY_MS, untilEnd(rule.until));
  const after = Math.max(generatedUntil.getTime(), now.getTime());
  const dates = occurrences(rule, firstDue, after, upper);
  // If the safety cap cut the list short, resume right after the last date.
  const reached = dates.length >= MAX_INSTANCES ? dates[dates.length - 1].getTime() : upper;
  return { dates, generatedUntil: new Date(Math.max(generatedUntil.getTime(), reached)) };
}

/**
 * Legacy helper: future instances after the latest existing one.
 * Prefer seriesTopUp, which keeps a stable anchor and a watermark.
 */
export function topUp(rule: Recurrence, latestDue: Date, now: Date = new Date()): Date[] {
  return seriesTopUp(rule, latestDue, latestDue, now).dates;
}

export function describeRecurrence(rule: Recurrence | null | undefined): string | null {
  if (!rule) return null;
  const base = rule.freq === 'daily' ? 'Every day' : rule.freq === 'weekdays' ? 'Every weekday' : 'Every week';
  if (!rule.until) return base;
  return `${base} until ${formatDate(fromDayKey(rule.until))}`;
}
