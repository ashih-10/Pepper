import { describe, expect, it } from 'vitest';

import {
  compareByHeat,
  explain,
  levelForHeat,
  scorePlate,
  weightFromPct,
  type PepperTask,
} from '@/lib/pepper';

const NOW = new Date('2026-10-12T15:00:00'); // a Monday afternoon
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

let n = 0;
function task(p: Partial<PepperTask> & Pick<PepperTask, 'task_type'>): PepperTask {
  return {
    id: `t${++n}`,
    custom_tier: null,
    weight_pct: null,
    due_at: at(1),
    created_at: NOW.toISOString(),
    completed: false,
    ...p,
  };
}

function levelOf(t: PepperTask, plate: PepperTask[] = [t], now = NOW) {
  return scorePlate(plate, now).get(t.id)!;
}

describe('pepper levels for a single task', () => {
  it('heats a test up as the date approaches', () => {
    expect(levelOf(task({ task_type: 'test', due_at: at(21) })).level).toBe('bell');
    expect(levelOf(task({ task_type: 'test', due_at: at(10) })).level).toBe('jalapeno');
    expect(levelOf(task({ task_type: 'test', due_at: at(5) })).level).toBe('serrano');
    expect(levelOf(task({ task_type: 'test', due_at: at(3) })).level).toBe('habanero');
    expect(levelOf(task({ task_type: 'test', due_at: at(1) })).level).toBe('ghost');
  });

  it('lets low-stakes homework climb the scale near its due time', () => {
    expect(levelOf(task({ task_type: 'homework', due_at: at(3) })).level).toBe('bell');
    expect(levelOf(task({ task_type: 'homework', due_at: at(1.3) })).level).toBe('jalapeno');
    expect(levelOf(task({ task_type: 'homework', due_at: at(8 / 24) })).level).toBe('habanero');
    expect(levelOf(task({ task_type: 'homework', due_at: at(1 / 24) })).level).toBe('ghost');
  });

  it('never cools down on its own as time passes', () => {
    const t = task({ task_type: 'quiz', due_at: at(6) });
    let prev = -1;
    for (let h = 0; h < 6 * 24; h += 3) {
      const heat = levelOf(t, [t], new Date(NOW.getTime() + h * 3_600_000)).heat;
      expect(heat).toBeGreaterThanOrEqual(prev);
      prev = heat;
    }
  });

  it('ranks test > quiz = project > homework for the same due date', () => {
    const due = at(2);
    const heat = (p: Partial<PepperTask> & Pick<PepperTask, 'task_type'>) =>
      levelOf(task({ ...p, due_at: due })).heat;
    const test = heat({ task_type: 'test' });
    const quiz = heat({ task_type: 'quiz' });
    const homework = heat({ task_type: 'homework' });
    expect(test).toBeGreaterThan(quiz);
    expect(quiz).toBeGreaterThan(homework);
  });

  it('uses the custom tier the student picked', () => {
    const lab = levelOf(task({ task_type: 'custom', custom_tier: 'high', due_at: at(3) }));
    const test = levelOf(task({ task_type: 'test', due_at: at(3) }));
    expect(lab.heat).toBeCloseTo(test.heat);
  });

  it('lets an entered grade weight override the default', () => {
    const plain = levelOf(task({ task_type: 'homework', due_at: at(4) }));
    const big = levelOf(task({ task_type: 'homework', weight_pct: 25, due_at: at(4) }));
    expect(big.heat).toBeGreaterThan(plain.heat);
    expect(weightFromPct(20)).toBe(1);
    expect(weightFromPct(1)).toBeLessThan(0.35);
  });
});

describe('what happens after the due date', () => {
  it('goes quiet for tests and quizzes (nothing left to do)', () => {
    const r = levelOf(task({ task_type: 'test', due_at: at(-0.1) }));
    expect(r.state).toBe('passed');
    expect(r.level).toBeNull();
  });

  it('stays at max heat for late-submittable work', () => {
    const r = levelOf(task({ task_type: 'homework', due_at: at(-1) }));
    expect(r.state).toBe('overdue');
    expect(r.level).toBe('ghost');
  });

  it('cools completely when checked off', () => {
    const r = levelOf(task({ task_type: 'test', due_at: at(0.5), completed: true }));
    expect(r.state).toBe('done');
    expect(r.level).toBeNull();
  });
});

describe('personalized ranking', () => {
  it('makes the same shared test hotter for a student with a crowded week', () => {
    const shared = task({ task_type: 'test', due_at: at(6) });
    const busyPlate = [
      shared,
      task({ task_type: 'test', due_at: at(2) }),
      task({ task_type: 'test', due_at: at(3) }),
      task({ task_type: 'project', due_at: at(4), created_at: at(-10) }),
    ];
    const relaxed = levelOf(shared, [shared]);
    const busy = levelOf(shared, busyPlate);
    expect(busy.heat).toBeGreaterThan(relaxed.heat);
    expect(busy.crowdingDays).toBeGreaterThan(2);
    expect(busy.level).not.toBe(relaxed.level);
  });

  it('gives the demo-script shared test different levels for two students (PRD demo step 5)', () => {
    const sharedTest = () => task({ id: 'shared', task_type: 'test', due_at: at(5 - 7 / 24) });
    // Student A: the "demo week" (homework, a quiz and a test before the shared test)
    const a = sharedTest();
    const busyWeek = [
      a,
      task({ task_type: 'homework', due_at: at(0.3), completed: true }),
      task({ task_type: 'homework', due_at: at(1.4) }),
      task({ task_type: 'quiz', due_at: at(0.7) }),
      task({ task_type: 'test', due_at: at(2.7) }),
      task({ task_type: 'custom', custom_tier: 'medium', due_at: at(5.4) }),
    ];
    // Student B: nothing else on their plate
    const b = sharedTest();
    expect(levelOf(a, busyWeek).level).toBe('habanero');
    expect(levelOf(b, [b]).level).toBe('serrano');
  });

  it('ignores finished work and work due later when measuring crowding', () => {
    const t = task({ task_type: 'quiz', due_at: at(3) });
    const plate = [
      t,
      task({ task_type: 'test', due_at: at(1), completed: true }),
      task({ task_type: 'test', due_at: at(10) }),
    ];
    expect(levelOf(t, plate).crowdingDays).toBe(0);
  });
});

describe('long projects', () => {
  it('heat up when left unchecked for most of their timeline', () => {
    const fresh = task({ task_type: 'project', due_at: at(10), created_at: NOW.toISOString() });
    const neglected = task({ task_type: 'project', due_at: at(10), created_at: at(-30) });
    expect(levelOf(neglected).heat).toBeGreaterThan(levelOf(fresh).heat);
    expect(levelOf(neglected).neglect).toBeGreaterThan(0.1);
  });
});

describe('helpers', () => {
  it('maps heat to levels at the thresholds', () => {
    expect(levelForHeat(0)).toBe('bell');
    expect(levelForHeat(0.2)).toBe('jalapeno');
    expect(levelForHeat(0.35)).toBe('serrano');
    expect(levelForHeat(0.55)).toBe('habanero');
    expect(levelForHeat(0.75)).toBe('ghost');
  });

  it('sorts hottest first, then soonest', () => {
    const list = [
      { heat: 0.3, due_at: at(2) },
      { heat: 0.9, due_at: at(5) },
      { heat: 0.3, due_at: at(1) },
    ].sort(compareByHeat);
    expect(list.map((x) => x.heat)).toEqual([0.9, 0.3, 0.3]);
    expect(list[1].due_at).toBe(at(1));
  });

  it('describes an entered grade weight honestly', () => {
    const r = levelOf(task({ task_type: 'homework', weight_pct: 15, due_at: at(3) }));
    expect(explain(r)).toMatch(/15% of your grade/);
    expect(explain(r)).not.toMatch(/low/);
  });

  it('explains crowding in plain English', () => {
    const shared = task({ task_type: 'test', due_at: at(6) });
    const plate = [shared, task({ task_type: 'test', due_at: at(2) }), task({ task_type: 'test', due_at: at(3) })];
    expect(explain(levelOf(shared, plate))).toMatch(/other work due first/);
  });
});
