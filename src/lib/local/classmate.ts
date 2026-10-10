/**
 * Jordan, the scripted classmate who makes the demo's group features feel
 * live: a few seconds after you join his group he moves the sample test a day
 * earlier, and he joins the first group you create. Each happens once, only
 * while the page is open, and quietly does nothing if the demo was reset.
 */
import { addDays } from '../dates';
import { CLASSMATE_ID } from './constants';
import { isMember, nowIso, read, write } from './db';
import { logActivity } from './feed';
import { updateTaskRow } from './rules';

/** Delay before Jordan moves the sample test after you join his group. */
export const MOVE_TEST_DELAY_MS = 8_000;
/** Delay before Jordan joins a group you created. */
export const JOIN_GROUP_DELAY_MS = 4_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Run `action` once after `ms`, unless the same action is already waiting. */
function later(key: string, ms: number, action: () => void) {
  if (timers.has(key)) return;
  const id = setTimeout(() => {
    timers.delete(key);
    try {
      action();
    } catch {
      // the demo changed underneath the script (reset, group deleted): skip
    }
  }, ms);
  timers.set(key, id);
}

/** Cancel every scripted action still waiting (the demo is ending). */
export function cancelClassmate() {
  for (const id of timers.values()) clearTimeout(id);
  timers.clear();
}

/** You joined `groupId`: if it is Jordan's sample group, he soon moves the test a day earlier. */
export function classmateOnJoin(groupId: string) {
  const start = read();
  const userId = start.userId;
  if (!userId || groupId !== start.classmate.sampleGroupId || start.classmate.movedTest) return;
  later('move-test', MOVE_TEST_DELAY_MS, () =>
    write((d) => {
      if (d.userId !== userId || d.classmate.movedTest) return;
      // You left again before he got to it: try again next time you join.
      if (!isMember(d, groupId, userId)) return;
      d.classmate.movedTest = true;
      const test = d.tasks.find((t) => t.id === d.classmate.sampleTestId && t.group_id === groupId);
      if (!test || !isMember(d, groupId, CLASSMATE_ID)) return;
      updateTaskRow(d, CLASSMATE_ID, test, { due_at: addDays(new Date(test.due_at), -1).toISOString() });
    }),
  );
}

/** You created `groupId`: Jordan joins it a few seconds later (only your first group). */
export function classmateOnCreate(groupId: string) {
  const start = read();
  const userId = start.userId;
  if (!userId || start.classmate.joinedYourGroup) return;
  later(`join-group:${groupId}`, JOIN_GROUP_DELAY_MS, () =>
    write((d) => {
      if (d.userId !== userId || d.classmate.joinedYourGroup) return;
      if (!d.groups.some((g) => g.id === groupId) || isMember(d, groupId, CLASSMATE_ID)) return;
      d.classmate.joinedYourGroup = true;
      d.group_members.push({ group_id: groupId, user_id: CLASSMATE_ID, role: 'member', class_id: null, joined_at: nowIso() });
      logActivity(d, { group_id: groupId, actor_id: CLASSMATE_ID, kind: 'member_joined' });
    }),
  );
}
