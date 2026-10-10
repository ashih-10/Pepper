import { describe, expect, it } from 'vitest';

import { inQuietHours, MAX_ALERTS, planAlerts, type AlertTask } from '@/lib/alert-plan';
import { nextOccurrences, topUp } from '@/lib/recurrence';

describe('recurring tasks', () => {
  const mondayEvening = new Date('2026-10-12T20:00:00'); // Monday

  it('repeats daily at the same time of day', () => {
    const out = nextOccurrences({ freq: 'daily' }, mondayEvening, mondayEvening, new Date('2026-10-15T23:00:00'));
    expect(out.map((d) => d.getDate())).toEqual([13, 14, 15]);
    expect(out.every((d) => d.getHours() === 20)).toBe(true);
  });

  it('skips weekends for weekday rules', () => {
    const friday = new Date('2026-10-16T08:00:00');
    const out = nextOccurrences({ freq: 'weekdays' }, friday, friday, new Date('2026-10-21T23:00:00'));
    expect(out.map((d) => d.getDay())).toEqual([1, 2, 3]);
  });

  it('repeats weekly on the same weekday', () => {
    const out = nextOccurrences({ freq: 'weekly' }, mondayEvening, mondayEvening, new Date('2026-11-01T00:00:00'));
    expect(out.map((d) => d.getDate())).toEqual([19, 26]);
    expect(out.every((d) => d.getDay() === 1)).toBe(true);
  });

  it('stops at the until date (inclusive)', () => {
    const out = nextOccurrences({ freq: 'daily', until: '2026-10-14' }, mondayEvening, mondayEvening, new Date('2026-12-01'));
    expect(out.map((d) => d.getDate())).toEqual([13, 14]);
  });

  it('tops a series up to three weeks ahead and never past it', () => {
    const now = new Date('2026-10-12T09:00:00');
    const out = topUp({ freq: 'daily' }, mondayEvening, now);
    expect(out.length).toBe(20);
    expect(out[out.length - 1].getTime()).toBeLessThanOrEqual(now.getTime() + 21 * 86_400_000);
  });
});

describe('alert planning', () => {
  const now = new Date('2026-10-12T15:00:00');
  const quietOff = { enabled: false, start: 22, end: 7 };
  const quietOn = { enabled: true, start: 22, end: 7 };
  const mk = (p: Partial<AlertTask> & Pick<AlertTask, 'task_type' | 'due_at' | 'title'>): AlertTask => ({
    id: p.title,
    custom_tier: null,
    weight_pct: null,
    created_at: now.toISOString(),
    completed: false,
    ...p,
  });

  it('fires ghost-pepper alerts every 10 minutes, capped at the phone limit', () => {
    const alerts = planAlerts([mk({ title: 'Essay', task_type: 'homework', due_at: '2026-10-11T23:59:00' })], quietOff, now);
    expect(alerts.length).toBe(MAX_ALERTS);
    expect(alerts.every((a) => a.level === 'ghost')).toBe(true);
    expect(alerts[1].at.getTime() - alerts[0].at.getTime()).toBe(10 * 60_000);
  });

  it('lists every hot task in one alert, hottest first', () => {
    const alerts = planAlerts(
      [
        mk({ title: 'Lab', task_type: 'homework', due_at: '2026-10-11T23:59:00' }),
        mk({ title: 'Unit Test', task_type: 'test', due_at: '2026-10-13T08:00:00' }),
      ],
      quietOff,
      now,
    );
    expect(alerts[0].body).toContain('1. Lab');
    expect(alerts[0].body).toContain('2. Unit Test');
  });

  it('stays silent during quiet hours', () => {
    const alerts = planAlerts([mk({ title: 'Essay', task_type: 'homework', due_at: '2026-10-11T23:59:00' })], quietOn, now);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some((a) => inQuietHours(a.at, quietOn))).toBe(false);
  });

  it('sends nothing for tests whose date has passed', () => {
    const alerts = planAlerts([mk({ title: 'Old quiz', task_type: 'quiz', due_at: '2026-10-11T08:00:00' })], quietOff, now);
    expect(alerts).toEqual([]);
  });

  it('sends a single quiet ping when a task first warms up', () => {
    const alerts = planAlerts([mk({ title: 'Read ch 5', task_type: 'homework', due_at: '2026-10-14T20:00:00' })], quietOn, now);
    const pings = alerts.filter((a) => a.title.includes('Warming up'));
    expect(pings.length).toBe(1);
    expect(pings[0].sound).toBe(false);
  });

  it('sends serrano reminders at most once a day', () => {
    const alerts = planAlerts([mk({ title: 'Quiz', task_type: 'quiz', due_at: '2026-10-14T23:00:00' })], quietOff, new Date('2026-10-12T08:00:00'), 40);
    const serrano = alerts.filter((a) => a.level === 'serrano');
    const days = new Set(serrano.map((a) => a.at.toDateString()));
    expect(serrano.length).toBe(days.size);
  });
});
