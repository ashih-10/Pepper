/**
 * Demo data for recording the submission video: a realistic week with a
 * test, quizzes, homework, a lab and a long-neglected project.
 * Every demo task is tagged so it can be removed in one tap.
 */
import { addDays, combine, dayKey } from './dates';
import { addClass, bulkInsertTasks, deleteTaggedTasks, type TaskSeed } from './api';
import { CLASS_COLORS } from './theme';
import type { ClassRow, TaskType, WeightTier } from './types';

export const DEMO_TAG = 'Demo task';

const DEMO_CLASSES = ['AP Chemistry', 'English 10', 'Algebra II', 'US History'];

interface DemoTask {
  title: string;
  cls: number;
  type: TaskType;
  label?: string;
  tier?: WeightTier;
  inDays: number;
  time: string;
  createdDaysAgo?: number;
}

const DEMO_TASKS: DemoTask[] = [
  { title: 'Read pages 112-130', cls: 1, type: 'homework', inDays: 0, time: '23:59' },
  { title: 'Problem set 4.2', cls: 2, type: 'homework', inDays: 1, time: '23:59' },
  { title: 'Vocab quiz', cls: 1, type: 'quiz', inDays: 1, time: '08:00' },
  { title: 'Chapter 7 Test', cls: 0, type: 'test', inDays: 3, time: '08:00' },
  { title: 'Titration lab report', cls: 0, type: 'custom', label: 'Lab', tier: 'medium', inDays: 5, time: '23:59' },
  { title: 'Unit 2 Quiz', cls: 2, type: 'quiz', inDays: 9, time: '08:00' },
  { title: 'Civil War documentary project', cls: 3, type: 'project', inDays: 10, time: '23:59', createdDaysAgo: 21 },
  { title: 'Fill out field trip form', cls: 3, type: 'custom', label: 'Form', tier: 'low', inDays: 6, time: '15:00' },
];

/** Add the sample classes (if missing) and a week of sample tasks; returns how many tasks were added. */
export async function loadDemoData(existing: ClassRow[], now = new Date()): Promise<number> {
  const classes = [...existing];
  for (const name of DEMO_CLASSES) {
    if (!classes.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      classes.push(await addClass(name, CLASS_COLORS[classes.length % CLASS_COLORS.length], classes.length));
    }
  }
  const byName = (i: number) => classes.find((c) => c.name.toLowerCase() === DEMO_CLASSES[i].toLowerCase())!;
  const rows: TaskSeed[] = DEMO_TASKS.map((t) => ({
    title: t.title,
    task_type: t.type,
    custom_label: t.label ?? null,
    custom_tier: t.tier ?? null,
    class_id: byName(t.cls).id,
    due_at: combine(dayKey(addDays(now, t.inDays)), t.time).toISOString(),
    notes: DEMO_TAG,
    // Every row sets created_at: in a batch insert, a column missing from one
    // row is sent as NULL for that row instead of using the default.
    created_at: addDays(now, -(t.createdDaysAgo ?? 0)).toISOString(),
  }));
  await bulkInsertTasks(rows);
  return rows.length;
}

/** Remove every task added by `loadDemoData` (matched by its tag). */
export async function removeDemoData(userId: string): Promise<void> {
  await deleteTaggedTasks(userId, DEMO_TAG);
}
