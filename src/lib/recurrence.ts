/**
 * Recurring tasks (daily reading log, weekly worksheet, ...).
 * Set the pattern once; the app keeps generating the next few weeks of
 * instances, like a scheduled job that runs whenever the app opens.
 */
import type { Recurrence } from './types';

/** How far ahead to keep instances generated. */
export const HORIZON_DAYS = 21;
/** Safety cap so a bad rule can never create thousands of rows. */
const MAX_INSTANCES = 60;

const isWeekday = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;

function untilEnd(until: string | null | undefined): number {
  if (!until) return Number.POSITIVE_INFINITY;
  const [y, m, d] = until.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/** Next occurrence after `d`, keeping the same local wall-clock time. */
function step(d: Date, freq: Recurrence['freq']): Date {
  const next = new Date(d);
  if (freq === 'weekly') {
    next.setDate(next.getDate() + 7);
    return next;
  }
  next.setDate(next.getDate() + 1);
  if (freq === 'weekdays') {
    while (!isWeekday(next)) next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Occurrences strictly after `after`, up to `horizonEnd` and the rule's
 * `until` date. `anchor` is any existing instance (it fixes the time of day
 * and, for weekly rules, the weekday).
 */
export function nextOccurrences(rule: Recurrence, anchor: Date, after: Date, horizonEnd: Date): Date[] {
  const end = Math.min(horizonEnd.getTime(), untilEnd(rule.until));
  const out: Date[] = [];
  let cur = new Date(anchor);
  // Walk forward from the anchor; skip anything not after `after`.
  for (let guard = 0; guard < 1000 && out.length < MAX_INSTANCES; guard++) {
    cur = step(cur, rule.freq);
    if (cur.getTime() > end) break;
    if (cur.getTime() > after.getTime()) out.push(new Date(cur));
  }
  return out;
}

/** Instances to add to a series so it covers the next HORIZON_DAYS. */
export function topUp(rule: Recurrence, latestDue: Date, now: Date = new Date()): Date[] {
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  return nextOccurrences(rule, latestDue, latestDue, horizon);
}

export function describeRecurrence(rule: Recurrence | null | undefined): string | null {
  if (!rule) return null;
  const base = rule.freq === 'daily' ? 'Every day' : rule.freq === 'weekdays' ? 'Every weekday' : 'Every week';
  return rule.until ? `${base} until ${rule.until}` : base;
}
