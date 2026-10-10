const DAY = 86_400_000;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const weekdayShort = (d: Date) => WEEKDAYS[d.getDay()];
export const weekdayLong = (d: Date) => WEEKDAYS_LONG[d.getDay()];
export const monthLong = (m: number) => MONTHS_LONG[m];

export function formatDate(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Today 11:59 PM", "Tomorrow 8:00 AM", "Fri 8:00 AM", "Oct 30 8:00 AM" */
export function formatDue(due: Date, now: Date): string {
  const time = formatTime(due);
  const days = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[due.getDay()]} ${time}`;
  return `${MONTHS[due.getMonth()]} ${due.getDate()} ${time}`;
}

/** "in 3h", "in 2 days", "2 days late" */
export function formatRelative(due: Date, now: Date): string {
  const ms = due.getTime() - now.getTime();
  const abs = Math.abs(ms);
  let s: string;
  if (abs < 3_600_000) s = `${Math.max(1, Math.round(abs / 60_000))} min`;
  else if (abs < DAY) s = `${Math.round(abs / 3_600_000)}h`;
  else {
    const d = Math.round(abs / DAY);
    s = `${d} day${d === 1 ? '' : 's'}`;
  }
  return ms >= 0 ? `in ${s}` : `${s} late`;
}

/** Combine a YYYY-MM-DD day and an HH:MM time into a local Date. */
export function combine(day: string, time: string): Date {
  const d = fromDayKey(day);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

export function timeKey(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function timeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local time';
  } catch {
    return 'local time';
  }
}
