/**
 * The planner's shared state: loads the student's data, keeps it live with
 * Supabase Realtime, scores every task with the pepper engine, and keeps the
 * phone's alert queue and recurring tasks topped up.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { planAlerts } from '@/lib/alert-plan';
import * as api from '@/lib/api';
import { formatDue } from '@/lib/dates';
import { notifyNow, schedulePepperAlerts } from '@/lib/notifications';
import { scorePlate, type PepperResult } from '@/lib/pepper';
import { getPref, setPref } from '@/lib/prefs';
import { topUp } from '@/lib/recurrence';
import { supabase } from '@/lib/supabase';
import { NO_CLASS_COLOR } from '@/lib/theme';
import type { ActivityRow, ClassRow, GroupMemberRow, GroupRow, PlannerTask, RescueRow, TaskRow } from '@/lib/types';

import { useAuth } from './auth';

export interface ScoredTask extends PlannerTask {
  score: PepperResult;
}

interface PlannerCtx {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  classes: ClassRow[];
  groups: GroupRow[];
  members: GroupMemberRow[];
  names: Map<string, string>;
  rescues: RescueRow[];
  tasks: ScoredTask[];
  taskById: (id: string) => ScoredTask | undefined;
  classById: (id: string | null) => ClassRow | undefined;
  myMembership: (groupId: string) => GroupMemberRow | undefined;
  toggleComplete: (taskId: string) => Promise<void>;
  /** "now" as the pepper engine sees it (includes the demo time warp). */
  now: Date;
  demoMode: boolean;
  setDemoMode: (on: boolean) => void;
  warpHours: number;
  setWarpHours: (h: number) => void;
}

const Ctx = createContext<PlannerCtx | null>(null);

const DEADLINE_KINDS = new Set(['due_changed', 'type_changed', 'task_deleted']);

const EMPTY: api.PlannerData = {
  classes: [],
  tasks: [],
  completions: new Map(),
  groups: [],
  members: [],
  names: new Map(),
  rescues: [],
};

export function PlannerProvider({ children }: { children: ReactNode }) {
  const { userId, profile } = useAuth();
  // Data is stored with the user id it belongs to (no flash of another
  // account's tasks after switching users).
  const [loaded, setLoaded] = useState<{ uid: string | null; data: api.PlannerData }>({ uid: null, data: EMPTY });
  const data = loaded.uid === userId ? loaded.data : EMPTY;
  const loading = loaded.uid !== userId;
  const setData = useCallback(
    (fn: (d: api.PlannerData) => api.PlannerData) => setLoaded((cur) => ({ ...cur, data: fn(cur.data) })),
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [demoMode, setDemoModeState] = useState(() => getPref('pp:demo') === '1');
  const [warpHours, setWarpHours] = useState(0);
  const toppedUp = useRef(new Set<string>());
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const fresh = await api.loadPlanner(userId);
      setLoaded({ uid: userId, data: fresh });
      setError(null);
    } catch (e) {
      setLoaded((cur) => (cur.uid === userId ? cur : { uid: userId, data: EMPTY }));
      setError(e instanceof Error ? e.message : 'Could not load your planner.');
    }
  }, [userId]);

  // Initial load (and reload when the signed-in account changes).
  useEffect(() => {
    if (!userId) return;
    toppedUp.current.clear();
    let live = true;
    api.loadPlanner(userId).then(
      (fresh) => {
        if (!live) return;
        setLoaded({ uid: userId, data: fresh });
        setError(null);
      },
      (e) => {
        if (!live) return;
        setLoaded({ uid: userId, data: EMPTY });
        setError(e instanceof Error ? e.message : 'Could not load your planner.');
      },
    );
    return () => {
      live = false;
    };
  }, [userId]);

  // Re-score every minute so peppers heat up while the app is open.
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Live sync: any change to tasks/groups the student can see triggers a reload;
  // deadline changes made by someone else also pop a notification.
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    };
    const channel = supabase
      .channel(`planner-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, soon)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, (payload) => {
        const row = payload.new as ActivityRow;
        rememberActivity(userId, row.id);
        if (row.actor_id !== userId && DEADLINE_KINDS.has(row.kind)) {
          const group = dataRef.current.groups.find((g) => g.id === row.group_id);
          notifyNow(`📅 ${group?.name ?? 'Group'} update`, describeDeadlineChange(row));
        }
        soon();
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  // Catch up on deadline changes that happened while the app was closed.
  useEffect(() => {
    if (!userId || loading) return;
    const key = `pp:lastActivity:${userId}`;
    const last = Number(getPref(key) ?? '0');
    api
      .activitySince(last)
      .then((rows) => {
        if (rows.length === 0) return;
        rememberActivity(userId, rows[rows.length - 1].id);
        if (last === 0) return; // first run on this device: nothing is "new"
        const changes = rows.filter((r) => r.actor_id !== userId && DEADLINE_KINDS.has(r.kind));
        if (changes.length === 1) notifyNow('📅 Group update', describeDeadlineChange(changes[0]));
        else if (changes.length > 1) {
          notifyNow(`📅 ${changes.length} deadline changes`, changes.map(describeDeadlineChange).join('\n'));
        }
      })
      .catch(() => {});
  }, [userId, loading]);

  // Recurring tasks: keep each series generated ~3 weeks ahead.
  useEffect(() => {
    if (loading) return;
    const latest = new Map<string, TaskRow>();
    for (const t of data.tasks) {
      if (!t.series_id || !t.recurrence) continue;
      const cur = latest.get(t.series_id);
      if (!cur || t.due_at > cur.due_at) latest.set(t.series_id, t);
    }
    const jobs: Promise<void>[] = [];
    for (const [seriesId, row] of latest) {
      if (toppedUp.current.has(seriesId)) continue;
      toppedUp.current.add(seriesId);
      const dates = topUp(row.recurrence!, new Date(row.due_at));
      if (dates.length) jobs.push(api.addSeriesInstances(row, dates));
    }
    if (jobs.length) Promise.all(jobs).then(refresh).catch(() => {});
  }, [data.tasks, loading, refresh]);

  const classById = useCallback((id: string | null) => data.classes.find((c) => c.id === id), [data.classes]);
  const myMembership = useCallback(
    (groupId: string) => data.members.find((m) => m.group_id === groupId && m.user_id === userId),
    [data.members, userId],
  );

  const planner: PlannerTask[] = useMemo(
    () =>
      data.tasks.map((t) => {
        const group = t.group_id ? data.groups.find((g) => g.id === t.group_id) : undefined;
        const classId = t.group_id
          ? data.members.find((m) => m.group_id === t.group_id && m.user_id === userId)?.class_id ?? null
          : t.class_id;
        const cls = data.classes.find((c) => c.id === classId);
        return {
          ...t,
          weight_pct: t.weight_pct == null ? null : Number(t.weight_pct),
          completed_at: data.completions.get(t.id) ?? null,
          class_name: cls?.name ?? null,
          color: cls?.color ?? NO_CLASS_COLOR,
          group_name: group?.name ?? null,
        };
      }),
    [data, userId],
  );

  const now = useMemo(() => new Date(tick + warpHours * 3_600_000), [tick, warpHours]);

  const tasks: ScoredTask[] = useMemo(() => {
    const scores = scorePlate(
      planner.map((t) => ({ ...t, completed: t.completed_at !== null })),
      now,
    );
    return planner.map((t) => ({ ...t, score: scores.get(t.id)! }));
  }, [planner, now]);

  // Rebuild the phone's alert queue whenever tasks or quiet hours change.
  useEffect(() => {
    if (loading || !profile) return;
    const timer = setTimeout(() => {
      const alerts = planAlerts(
        planner.map((t) => ({ ...t, completed: t.completed_at !== null })),
        { enabled: profile.quiet_hours_enabled, start: profile.quiet_start, end: profile.quiet_end },
        new Date(),
      );
      schedulePepperAlerts(alerts).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [planner, profile, loading]);

  const toggleComplete = useCallback(
    async (taskId: string) => {
      const wasDone = dataRef.current.completions.has(taskId);
      const optimistic = (done: boolean) =>
        setData((d) => {
          const completions = new Map(d.completions);
          if (done) completions.set(taskId, new Date().toISOString());
          else completions.delete(taskId);
          return { ...d, completions };
        });
      optimistic(!wasDone);
      try {
        await api.setCompleted(taskId, !wasDone);
      } catch (e) {
        optimistic(wasDone);
        throw e;
      }
    },
    [setData],
  );

  const setDemoMode = useCallback((on: boolean) => {
    setPref('pp:demo', on ? '1' : null);
    setDemoModeState(on);
    if (!on) setWarpHours(0);
  }, []);

  const value = useMemo<PlannerCtx>(
    () => ({
      loading,
      error,
      refresh,
      classes: data.classes,
      groups: data.groups,
      members: data.members,
      names: data.names,
      rescues: data.rescues,
      tasks,
      taskById: (id) => tasks.find((t) => t.id === id),
      classById,
      myMembership,
      toggleComplete,
      now,
      demoMode,
      setDemoMode,
      warpHours,
      setWarpHours,
    }),
    [loading, error, refresh, data, tasks, classById, myMembership, toggleComplete, now, demoMode, setDemoMode, warpHours],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner(): PlannerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlanner must be used inside PlannerProvider');
  return ctx;
}

function rememberActivity(userId: string, id: number) {
  const key = `pp:lastActivity:${userId}`;
  if (id > Number(getPref(key) ?? '0')) setPref(key, String(id));
}

export function describeDeadlineChange(row: ActivityRow): string {
  const title = row.task_title ?? 'A task';
  const p = row.payload as Record<string, string | null>;
  if (row.kind === 'due_changed' && p.to) return `${title} moved to ${formatDue(new Date(p.to), new Date())}`;
  if (row.kind === 'type_changed') return `${title} is now a ${p.to === 'custom' ? (p.label ?? 'custom task') : p.to}`;
  if (row.kind === 'task_deleted') return `${title} was removed from the group`;
  return title;
}
