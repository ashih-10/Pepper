/**
 * The planner's shared state: loads the student's data, keeps it live with
 * Supabase Realtime, scores every task with the pepper engine, and keeps the
 * phone's alert queue and recurring tasks topped up.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { planAlerts } from '@/lib/alert-plan';
import * as api from '@/lib/api';
import { formatDue } from '@/lib/dates';
import { notifyNow, schedulePepperAlerts } from '@/lib/notifications';
import { scorePlate, type PepperResult } from '@/lib/pepper';
import { getPref, setPref } from '@/lib/prefs';
import { supabase } from '@/lib/supabase';
import { NO_CLASS_COLOR } from '@/lib/theme';
import type { ActivityRow, ClassRow, GroupMemberRow, GroupRow, PlannerTask, RescueRow } from '@/lib/types';

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

const DEADLINE_KINDS = new Set(['due_changed', 'type_changed', 'task_deleted', 'series_stopped']);

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
  // account's tasks after switching users). `ok` is false until a load has
  // succeeded, so a failed first load never wipes the phone's alert queue.
  const [loaded, setLoaded] = useState<{ uid: string | null; data: api.PlannerData; ok: boolean }>({
    uid: null,
    data: EMPTY,
    ok: false,
  });
  const data = loaded.uid === userId ? loaded.data : EMPTY;
  const loading = loaded.uid !== userId;
  const loadedOk = loaded.uid === userId && loaded.ok;
  const setData = useCallback(
    (fn: (d: api.PlannerData) => api.PlannerData) => setLoaded((cur) => ({ ...cur, data: fn(cur.data) })),
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [demoMode, setDemoModeState] = useState(() => getPref('pp:demo') === '1');
  const [warpHours, setWarpHours] = useState(0);
  // Bumped by every load and every local change: a load that started before a
  // newer one (or before a check-off) is thrown away instead of overwriting it.
  const seq = useRef(0);
  const lastTopUp = useRef(0);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const load = useCallback((uid: string): Promise<void> => {
    const my = ++seq.current;
    return api.loadPlanner().then(
      (fresh) => {
        if (my !== seq.current) return;
        setLoaded({ uid, data: fresh, ok: true });
        setError(null);
      },
      (e) => {
        if (my !== seq.current) return;
        setLoaded((cur) => (cur.uid === uid ? cur : { uid, data: EMPTY, ok: false }));
        setError(e instanceof Error ? e.message : 'Could not load your planner.');
      },
    );
  }, []);

  const refresh = useCallback(async () => {
    if (userId) await load(userId);
  }, [userId, load]);

  // Recurring tasks: keep the series you created generated ~3 weeks ahead.
  // Only the creator's device does this; throttled to once per 10 minutes.
  const topUpSeries = useCallback(async () => {
    if (!userId || Date.now() - lastTopUp.current < 10 * 60_000) return;
    lastTopUp.current = Date.now();
    try {
      if ((await api.topUpMySeries(userId)) > 0) await load(userId);
    } catch {
      lastTopUp.current = 0; // try again next time
    }
  }, [userId, load]);

  // Deadline changes made by others while the app was closed.
  const catchUp = useCallback(async () => {
    if (!userId) return;
    const key = `pp:lastActivity:${userId}`;
    const last = Number(getPref(key) ?? '0');
    try {
      if (last === 0) {
        // First run on this device: nothing is "new"; start from the newest row.
        const newest = await api.latestActivityId();
        if (newest) setPref(key, String(newest));
        return;
      }
      const changes: ActivityRow[] = [];
      let after = last;
      for (let page = 0; page < 5; page++) {
        const rows = await api.activitySince(after);
        if (rows.length === 0) break;
        changes.push(...rows.filter((r) => r.actor_id !== userId && DEADLINE_KINDS.has(r.kind)));
        after = rows[rows.length - 1].id;
        if (rows.length < 100) break;
      }
      // Older than 5 pages: skip ahead to the newest so it isn't replayed later.
      if (after !== last) rememberActivity(userId, Math.max(after, await api.latestActivityId()));
      if (changes.length === 1) notifyNow('📅 Group update', describeDeadlineChange(changes[0]));
      else if (changes.length > 1) {
        notifyNow(`📅 ${changes.length} deadline changes`, changes.slice(0, 8).map(describeDeadlineChange).join('\n'));
      }
    } catch {
      // offline: try again next time the app comes to the front
    }
  }, [userId]);

  // Initial load (and reload when the signed-in account changes).
  useEffect(() => {
    if (!userId) return;
    lastTopUp.current = 0;
    load(userId).then(() => {
      catchUp();
      topUpSeries();
    });
  }, [userId, load, catchUp, topUpSeries]);

  // Coming back to the app: reload (which also rebuilds the alert queue),
  // catch up on group changes, and top up recurring tasks.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setTick(Date.now());
      load(userId).then(() => {
        catchUp();
        topUpSeries();
      });
    });
    return () => sub.remove();
  }, [userId, load, catchUp, topUpSeries]);

  // Re-score every minute so peppers heat up while the app is open.
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Live sync through the group activity feed: every shared-task and
  // membership change writes an activity row, and those INSERT events are
  // RLS-checked, so only members of that group receive them.
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`planner-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, (payload) => {
        const row = payload.new as ActivityRow;
        rememberActivity(userId, row.id);
        if (row.actor_id !== userId && DEADLINE_KINDS.has(row.kind)) {
          const group = dataRef.current.groups.find((g) => g.id === row.group_id);
          notifyNow(`📅 ${group?.name ?? 'Group'} update`, describeDeadlineChange(row));
        }
        clearTimeout(timer);
        timer = setTimeout(() => load(userId), 300);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

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
  // Never from a failed load (that would wipe every alert), and not before
  // onboarding finishes (that's when we ask for notification permission).
  useEffect(() => {
    if (!loadedOk || !profile?.onboarded) return;
    const timer = setTimeout(() => {
      const alerts = planAlerts(
        planner.map((t) => ({ ...t, completed: t.completed_at !== null })),
        { enabled: profile.quiet_hours_enabled, start: profile.quiet_start, end: profile.quiet_end },
        new Date(),
      );
      schedulePepperAlerts(alerts).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [planner, profile, loadedOk]);

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
      seq.current++; // a load already in flight must not undo this
      optimistic(!wasDone);
      try {
        await api.setCompleted(taskId, !wasDone);
        if (userId) load(userId);
      } catch (e) {
        optimistic(wasDone);
        throw e;
      }
    },
    [setData, userId, load],
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
  if (row.kind === 'series_stopped') return `${title} stopped repeating`;
  return title;
}
