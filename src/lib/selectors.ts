/** Pure helpers that slice the scored task list for each screen. */
import { compareByHeat, isHot } from './pepper';
import { dayKey, sameDay } from './dates';
import type { DotsByDay } from '@/components/calendar';
import type { ScoredTask } from '@/state/planner';

const byHeat = (a: ScoredTask, b: ScoredTask) =>
  compareByHeat({ heat: a.score.heat, due_at: a.due_at }, { heat: b.score.heat, due_at: b.due_at });

const open = (t: ScoredTask) => t.score.state === 'active' || t.score.state === 'overdue';

export interface DayView {
  /** Still to do, hottest first (on today's view this includes late work). */
  due: ScoredTask[];
  /** Hot items due this day, for the stacked-urgency callout. */
  hot: ScoredTask[];
  /** Future tasks (today's view only), hottest first. */
  upcoming: ScoredTask[];
  /** Finished (or passed) items for this day: the day's history. */
  done: ScoredTask[];
}

export function dayView(tasks: ScoredTask[], day: Date, now: Date): DayView {
  const isToday = sameDay(day, now);
  const due = tasks
    .filter((t) => open(t) && (sameDay(new Date(t.due_at), day) || (isToday && t.score.state === 'overdue')))
    .sort(byHeat);
  const done = tasks
    .filter(
      (t) =>
        (t.completed_at && (sameDay(new Date(t.completed_at), day) || sameDay(new Date(t.due_at), day))) ||
        (t.score.state === 'passed' && sameDay(new Date(t.due_at), day)),
    )
    .sort((a, b) => (b.completed_at ?? b.due_at).localeCompare(a.completed_at ?? a.due_at));
  const upcoming = isToday
    ? tasks.filter((t) => open(t) && new Date(t.due_at) > now && !sameDay(new Date(t.due_at), day)).sort(byHeat)
    : [];
  return { due, hot: due.filter((t) => isHot(t.score.level)), upcoming, done };
}

/** Class-colored dots per day for open tasks (workload density). */
export function dotsByDay(tasks: ScoredTask[]): DotsByDay {
  const map: DotsByDay = new Map();
  for (const t of [...tasks].sort(byHeat)) {
    if (!open(t)) continue;
    const key = dayKey(new Date(t.due_at));
    const list = map.get(key) ?? [];
    list.push(t.color);
    map.set(key, list);
  }
  return map;
}

/** Hottest open tasks, for the AI game plan. */
export function planCandidates(tasks: ScoredTask[]): ScoredTask[] {
  const openTasks = tasks.filter(open).sort(byHeat);
  const hot = openTasks.filter((t) => isHot(t.score.level));
  return (hot.length ? hot : openTasks).slice(0, 8);
}
