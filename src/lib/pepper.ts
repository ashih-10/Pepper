/**
 * The pepper engine: decides how "spicy" (urgent) every task is.
 *
 *   heat = how much it matters  x  how little time you REALLY have
 *
 * 1. WEIGHT (0-1): tests matter most, quizzes and projects next, homework least.
 *    If the student typed a grade-weight %, that overrides the default.
 * 2. TIME: days until due, minus the days of other work the student must finish
 *    BEFORE this task is due ("crowding"). That subtraction is what makes the
 *    ranking personal: the same shared test is hotter for a student with three
 *    other tests that week than for one with an empty week.
 * 3. NEGLECT: projects heat up extra as their timeline elapses, because
 *    completion is a single check-off and "not done yet" means "not started".
 * 4. LAST-MINUTE RULE: anything gets hot right before it's due, even homework.
 *
 * Everything here is a pure function of (tasks, now), so it runs instantly on
 * the phone, works offline, and gives the same answer every time.
 */
import type { TaskType, WeightTier } from './types';

export type PepperLevel = 'bell' | 'jalapeno' | 'serrano' | 'habanero' | 'ghost';
export type TaskState = 'active' | 'overdue' | 'passed' | 'done';

export interface PepperInfo {
  level: PepperLevel;
  label: string;
  emoji: string;
  color: string;
  rank: number;
  meaning: string;
}

export const PEPPERS: Record<PepperLevel, PepperInfo> = {
  bell: { level: 'bell', label: 'Bell Pepper', emoji: '🫑', color: '#7CB342', rank: 0, meaning: 'No heat. Far off or low stakes.' },
  jalapeno: { level: 'jalapeno', label: 'Jalapeño', emoji: '🌶️', color: '#2E7D32', rank: 1, meaning: 'Mild. Keep it in mind.' },
  serrano: { level: 'serrano', label: 'Serrano', emoji: '🌶️', color: '#F9A825', rank: 2, meaning: "Medium. On today's radar." },
  habanero: { level: 'habanero', label: 'Habanero', emoji: '🔥', color: '#EF6C00', rank: 3, meaning: 'Hot. Needs attention soon.' },
  ghost: { level: 'ghost', label: 'Ghost Pepper', emoji: '👻', color: '#C62828', rank: 4, meaning: 'Maximum. Do it as soon as possible.' },
};

export const LEVEL_ORDER: PepperLevel[] = ['bell', 'jalapeno', 'serrano', 'habanero', 'ghost'];

/** Heat thresholds: heat >= value means at least that level. */
export const THRESHOLDS: Record<Exclude<PepperLevel, 'bell'>, number> = {
  jalapeno: 0.2,
  serrano: 0.35,
  habanero: 0.55,
  ghost: 0.75,
};

/** Default importance of each tier (PRD 5.5: Test > Quiz = Project > Homework). */
export const TIER_WEIGHT: Record<WeightTier, number> = { high: 1, medium: 0.6, low: 0.3 };

/** Days of runway a task of this tier wants before it starts feeling urgent. */
export const LEAD_DAYS: Record<WeightTier, number> = { high: 4, medium: 2.5, low: 2 };

/**
 * Rough days of effort a task eats up. Used to measure how crowded your week
 * is: studying for a test takes a day and a half of evenings; homework, a
 * fraction of one.
 */
export const PREP_DAYS: Record<WeightTier, number> = { high: 1.5, medium: 0.75, low: 0.25 };
const PROJECT_PREP_DAYS = 1.5;

/** Crowding can eat at most this share of the time you have left. */
const MAX_CROWDING_SHARE = 0.6;
/** How strongly an untouched project heats up as its timeline runs out. */
const NEGLECT_BOOST = 0.35;
/** Exponent of the last-minute rule (bigger = kicks in later). */
const LAST_MINUTE_POWER = 5;

const DAY_MS = 86_400_000;

export interface PepperTask {
  id: string;
  task_type: TaskType;
  custom_tier: WeightTier | null;
  weight_pct: number | null;
  due_at: string | Date;
  created_at: string | Date;
  completed: boolean;
}

export interface PepperResult {
  id: string;
  state: TaskState;
  /** null when there is nothing left to do (done, or a test/quiz whose date passed). */
  level: PepperLevel | null;
  heat: number;
  weight: number;
  tier: WeightTier;
  /** The student's grade-weight % when they entered one (it overrides the tier). */
  weightPct: number | null;
  daysLeft: number;
  crowdingDays: number;
  effectiveDaysLeft: number;
  neglect: number;
}

const toMs = (d: string | Date) => (typeof d === 'string' ? Date.parse(d) : d.getTime());
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function tierOf(t: Pick<PepperTask, 'task_type' | 'custom_tier'>): WeightTier {
  switch (t.task_type) {
    case 'test':
      return 'high';
    case 'quiz':
    case 'project':
      return 'medium';
    case 'homework':
      return 'low';
    case 'custom':
      return t.custom_tier ?? 'medium';
  }
}

/** Tests and quizzes can't be done late: once the date passes they go quiet. */
export function isExam(t: Pick<PepperTask, 'task_type'>): boolean {
  return t.task_type === 'test' || t.task_type === 'quiz';
}

/**
 * Turn a grade-weight % into a 0-1 weight. 20%+ of the grade counts as much
 * as a default test; 1% is barely above homework.
 */
export function weightFromPct(pct: number): number {
  return clamp(0.25 + (0.75 * pct) / 20, 0.15, 1);
}

export function weightOf(t: Pick<PepperTask, 'task_type' | 'custom_tier' | 'weight_pct'>): number {
  if (t.weight_pct != null && t.weight_pct > 0) return weightFromPct(t.weight_pct);
  return TIER_WEIGHT[tierOf(t)];
}

function leadDaysOf(t: PepperTask): number {
  if (t.task_type === 'project') {
    const spanDays = (toMs(t.due_at) - toMs(t.created_at)) / DAY_MS;
    return Math.max(5, 0.35 * spanDays);
  }
  return LEAD_DAYS[tierOf(t)];
}

function prepDaysOf(t: PepperTask): number {
  return t.task_type === 'project' ? PROJECT_PREP_DAYS : PREP_DAYS[tierOf(t)];
}

export function stateOf(t: PepperTask, nowMs: number): TaskState {
  if (t.completed) return 'done';
  if (toMs(t.due_at) >= nowMs) return 'active';
  return isExam(t) ? 'passed' : 'overdue';
}

export function levelForHeat(heat: number): PepperLevel {
  if (heat >= THRESHOLDS.ghost) return 'ghost';
  if (heat >= THRESHOLDS.habanero) return 'habanero';
  if (heat >= THRESHOLDS.serrano) return 'serrano';
  if (heat >= THRESHOLDS.jalapeno) return 'jalapeno';
  return 'bell';
}

/**
 * Score every task on a student's plate at time `now`.
 * The whole plate is needed because crowding depends on the other tasks.
 */
export function scorePlate(tasks: PepperTask[], now: Date | number = Date.now()): Map<string, PepperResult> {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const out = new Map<string, PepperResult>();

  // Tasks that still need work (active or overdue-but-submittable), soonest first.
  const pending = tasks
    .filter((t) => {
      const s = stateOf(t, nowMs);
      return s === 'active' || s === 'overdue';
    })
    .sort((a, b) => toMs(a.due_at) - toMs(b.due_at));

  for (const t of tasks) {
    const state = stateOf(t, nowMs);
    const tier = tierOf(t);
    const weight = weightOf(t);
    const dueMs = toMs(t.due_at);
    const daysLeft = (dueMs - nowMs) / DAY_MS;
    const weightPct = t.weight_pct != null && t.weight_pct > 0 ? t.weight_pct : null;
    const base = { id: t.id, state, tier, weight, weightPct, daysLeft };

    if (state === 'done' || state === 'passed') {
      out.set(t.id, { ...base, level: null, heat: 0, crowdingDays: 0, effectiveDaysLeft: daysLeft, neglect: 0 });
      continue;
    }
    if (state === 'overdue') {
      out.set(t.id, { ...base, level: 'ghost', heat: 1, crowdingDays: 0, effectiveDaysLeft: 0, neglect: 0 });
      continue;
    }

    // Crowding: effort owed to other pending tasks due before (or with) this one.
    let crowding = 0;
    for (const other of pending) {
      if (other.id === t.id) continue;
      if (toMs(other.due_at) > dueMs) break;
      crowding += prepDaysOf(other);
    }
    const crowdingDays = Math.min(crowding, MAX_CROWDING_SHARE * daysLeft);
    const effectiveDaysLeft = Math.max(0, daysLeft - crowdingDays);

    // Urgency: 1 when due now, 0.5 when exactly one "lead time" away, fading after.
    let urgency = 1 / (1 + effectiveDaysLeft / leadDaysOf(t));

    // Neglect: untouched projects warm up as their timeline elapses.
    let neglect = 0;
    if (t.task_type === 'project') {
      const createdMs = toMs(t.created_at);
      const span = dueMs - createdMs;
      const elapsed = span > 0 ? clamp((nowMs - createdMs) / span, 0, 1) : 1;
      neglect = NEGLECT_BOOST * elapsed * elapsed;
      urgency = Math.min(1, urgency + neglect);
    }

    // Weighted urgency, plus the last-minute rule that makes even low-weight
    // tasks spike in the final hours.
    const heat = clamp(weight * urgency + (1 - weight) * urgency ** LAST_MINUTE_POWER, 0, 1);
    out.set(t.id, {
      ...base,
      level: levelForHeat(heat),
      heat,
      crowdingDays,
      effectiveDaysLeft,
      neglect,
    });
  }
  return out;
}

/** Hottest first; ties broken by whichever is due sooner. */
export function compareByHeat(
  a: { heat: number; due_at: string | Date },
  b: { heat: number; due_at: string | Date },
): number {
  if (b.heat !== a.heat) return b.heat - a.heat;
  return toMs(a.due_at) - toMs(b.due_at);
}

/** Order for the stacked-urgency callout: by weight, then due date. */
export function compareByWeight(
  a: { weight: number; due_at: string | Date },
  b: { weight: number; due_at: string | Date },
): number {
  if (b.weight !== a.weight) return b.weight - a.weight;
  return toMs(a.due_at) - toMs(b.due_at);
}

export function isHot(level: PepperLevel | null): boolean {
  return level === 'habanero' || level === 'ghost';
}

/** Plain-English reason for a task's pepper level (shown on the task screen). */
export function explain(r: PepperResult): string {
  if (r.state === 'done') return 'Done. Cooled down with a glass of milk.';
  if (r.state === 'passed') return 'The date passed, so there is nothing left to do. No more alerts.';
  if (r.state === 'overdue') return 'Past due, but it can still be turned in late, so it stays at max heat until you check it off.';
  const weightText =
    r.weightPct != null
      ? `${Number(r.weightPct)}% of your grade (${Math.round(r.weight * 100)}/100)`
      : `${r.tier} (${Math.round(r.weight * 100)}/100)`;
  const parts = [
    `Weight: ${weightText}.`,
    `Due in ${formatDays(r.daysLeft)}.`,
  ];
  if (r.crowdingDays >= 0.1) {
    parts.push(
      `You have about ${formatDays(r.crowdingDays)} of other work due first, so it really feels like ${formatDays(r.effectiveDaysLeft)}.`,
    );
  }
  if (r.neglect >= 0.05) parts.push('Long project still unchecked, so it heats up as time passes.');
  parts.push(`Heat ${Math.round(r.heat * 100)}/100.`);
  return parts.join(' ');
}

function formatDays(days: number): string {
  if (days < 1) {
    const h = Math.max(0, Math.round(days * 24));
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(days * 10) / 10;
  return `${d} day${d === 1 ? '' : 's'}`;
}
