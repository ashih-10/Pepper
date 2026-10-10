/**
 * The demo's group activity feed: rows written for shared-task and membership
 * changes (as the server's trigger and RPCs do), plus an in-process stand-in
 * for the realtime channel that hands each new row to subscribed members.
 */
import type { ActivityKind, ActivityRow } from '../types';
import { afterCommit, isMember, nowIso, type LocalDb } from './db';

interface Listener {
  userId: string;
  onInsert: (row: ActivityRow) => void;
}

const listeners = new Set<Listener>();

export interface ActivityInput {
  group_id: string;
  actor_id: string | null;
  kind: ActivityKind;
  task_id?: string | null;
  task_title?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Append an activity row. Like realtime under row-level security, it goes to
 * listeners who are members of the group when the row is written, and arrives
 * asynchronously once the write is saved.
 */
export function logActivity(d: LocalDb, input: ActivityInput): ActivityRow {
  d.counters.activity += 1;
  const row: ActivityRow = {
    id: d.counters.activity,
    group_id: input.group_id,
    actor_id: input.actor_id,
    kind: input.kind,
    task_id: input.task_id ?? null,
    task_title: input.task_title ?? null,
    payload: input.payload ?? {},
    created_at: nowIso(),
  };
  d.activity.push(row);
  const targets = [...listeners].filter((l) => isMember(d, row.group_id, l.userId));
  if (targets.length) {
    const json = JSON.stringify(row);
    afterCommit(() => {
      for (const l of targets) {
        setTimeout(() => {
          if (listeners.has(l)) l.onInsert(JSON.parse(json) as ActivityRow);
        }, 0);
      }
    });
  }
  return row;
}

/** Receive new activity rows for `userId`'s groups. Returns an unsubscribe function. */
export function addActivityListener(userId: string, onInsert: (row: ActivityRow) => void): () => void {
  const l: Listener = { userId, onInsert };
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
