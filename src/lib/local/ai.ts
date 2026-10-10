/**
 * Demo stand-ins for the AI features (which need the server's Claude key):
 * fixed sample results, clearly labeled, after a short pause so the loading
 * states show. Nothing is sent anywhere; the photo is never read.
 */
import { addDays, dayKey } from '../dates';
import type { ExtractResult, GamePlan, PlanTaskInput } from '../ai';

/** Pretend thinking time, so the app's loading states are visible. */
export const SAMPLE_DELAY_MS = 600;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Demo stand-in for photo reading: sample tasks, clearly marked as samples. */
export async function sampleExtract(classNames: string[], now: Date): Promise<ExtractResult> {
  await pause(SAMPLE_DELAY_MS);
  const className = classNames.find((n) => n.trim().length > 0) ?? null;
  return {
    tasks: [
      {
        title: 'Chapter 6 Quiz',
        class_name: className,
        due_date: dayKey(addDays(now, 3)),
        due_time: '08:00',
        task_type: 'quiz',
        custom_label: null,
        custom_tier: null,
        weight_pct: 5,
        notes: 'Covers sections 6.1-6.4.',
        unclear: [],
        question: null,
      },
      {
        title: 'Reaction rates lab report',
        class_name: className,
        due_date: dayKey(addDays(now, 8)),
        due_time: null,
        task_type: 'custom',
        custom_label: 'Lab report',
        custom_tier: 'medium',
        weight_pct: null,
        notes: 'Include the data table and two graphs.',
        unclear: ['due_time', 'weight_pct'],
        question: 'What time is the lab report due, and how much of your grade is it worth?',
      },
    ],
    message: 'Demo mode: these are sample results, not a real reading of your photo.',
  };
}

interface Step {
  tip: string;
  minutes: number;
}

const BY_KIND: Record<string, Step> = {
  test: { tip: 'Do one timed practice set, then re-study only what you missed.', minutes: 45 },
  quiz: { tip: 'Make ten quick flashcards and quiz yourself twice.', minutes: 20 },
  project: { tip: 'Pick the next small piece and finish just that one.', minutes: 40 },
  homework: { tip: 'Start the first problem now; momentum does the rest.', minutes: 30 },
  lab: { tip: 'Fill in the data table first, then write the results paragraph.', minutes: 35 },
  essay: { tip: 'Write a messy outline: thesis plus three points.', minutes: 30 },
};
const OTHER: Step = { tip: 'Open it and do the first small step right away.', minutes: 20 };

function stepFor(kind: string): Step {
  const k = kind.trim().toLowerCase();
  if (BY_KIND[k]) return BY_KIND[k];
  if (k.includes('lab')) return BY_KIND.lab;
  if (k.includes('essay') || k.includes('paper')) return BY_KIND.essay;
  return OTHER;
}

/** Demo stand-in for the AI game plan, built from the formula's order. */
export async function samplePlan(tasks: PlanTaskInput[], _nowLabel: string): Promise<GamePlan> {
  await pause(SAMPLE_DELAY_MS);
  return {
    headline: tasks.length
      ? `Sample plan (demo mode): ${tasks.length} task${tasks.length === 1 ? '' : 's'}, hottest first.`
      : 'Sample plan (demo mode): nothing urgent today.',
    steps: tasks.map((t) => ({ task_id: t.id, ...stepFor(t.kind) })),
    closing: 'This is a sample plan; with a server, the AI writes one around your goals.',
  };
}
