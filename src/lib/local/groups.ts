/**
 * Demo study groups: the server's group RPCs (create, join, leave, remove,
 * regenerate code), the activity feed reads, and live updates, all on device.
 */
import type { ActivityRow, GroupRow } from '../types';
import { classmateOnCreate, classmateOnJoin } from './classmate';
import { copy, groupIdsOf, isMember, isOwner, memberRow, nowIso, randomId, read, write } from './db';
import { addActivityListener, logActivity } from './feed';
import { checkMemberClass, deleteGroupRow, me, newJoinCode } from './rules';

/** Create a group you own, mapped to one of your classes. */
export async function createGroup(name: string, classId: string | null): Promise<GroupRow> {
  const group = write((d) => {
    const uid = me(d);
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed.length < 1 || trimmed.length > 60) throw new Error('group name must be 1-60 characters');
    checkMemberClass(d, uid, classId);
    const at = nowIso();
    const g: GroupRow = { id: randomId(), name: trimmed, owner_id: uid, join_code: newJoinCode(d), created_at: at };
    d.groups.push(g);
    d.group_members.push({ group_id: g.id, user_id: uid, role: 'owner', class_id: classId, joined_at: at });
    return copy(g);
  });
  classmateOnCreate(group.id);
  return group;
}

/** Join with a code (any case, spaces ignored). Already a member: returns the group. */
export async function joinGroup(code: string, classId: string | null): Promise<GroupRow> {
  const { group, joined } = write((d) => {
    const uid = me(d);
    const wanted = (code ?? '').trim().toUpperCase();
    const g = d.groups.find((x) => x.join_code === wanted);
    if (!g) throw new Error('No group found with that code');
    checkMemberClass(d, uid, classId);
    if (isMember(d, g.id, uid)) return { group: copy(g), joined: false };
    d.group_members.push({ group_id: g.id, user_id: uid, role: 'member', class_id: classId, joined_at: nowIso() });
    logActivity(d, { group_id: g.id, actor_id: uid, kind: 'member_joined' });
    return { group: copy(g), joined: true };
  });
  if (joined) classmateOnJoin(group.id);
  return group;
}

/** Owner only: replace the group's join code. Returns the new code. */
export async function regenerateJoinCode(groupId: string): Promise<string> {
  return write((d) => {
    if (!isOwner(d, groupId, me(d))) throw new Error('only the owner can change the code');
    const g = d.groups.find((x) => x.id === groupId)!;
    g.join_code = newJoinCode(d);
    return g.join_code;
  });
}

/** Leave a group. An owner hands it to the longest-standing member; the last one out deletes it. */
export async function leaveGroup(groupId: string) {
  write((d) => {
    const uid = me(d);
    const mine = memberRow(d, groupId, uid);
    if (!mine) throw new Error('not a member of this group');
    if (mine.role === 'owner') {
      const heir = d.group_members
        .filter((m) => m.group_id === groupId && m.user_id !== uid)
        .sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at))[0];
      if (!heir) {
        deleteGroupRow(d, uid, groupId);
        return;
      }
      const g = d.groups.find((x) => x.id === groupId);
      if (g) g.owner_id = heir.user_id;
      heir.role = 'owner';
    }
    d.group_members = d.group_members.filter((m) => m !== mine);
    logActivity(d, { group_id: groupId, actor_id: uid, kind: 'member_left' });
  });
}

/** Owner only (anyone else changes nothing): delete the group and its shared tasks. */
export async function deleteGroup(groupId: string) {
  write((d) => {
    const uid = me(d);
    const g = d.groups.find((x) => x.id === groupId);
    if (!g || g.owner_id !== uid || !isMember(d, groupId, uid)) return;
    deleteGroupRow(d, uid, groupId);
  });
}

/** Owner only: remove a member and rotate the code so they can't walk straight back in. */
export async function removeMember(groupId: string, userId: string) {
  write((d) => {
    const uid = me(d);
    if (!isOwner(d, groupId, uid)) throw new Error('only the owner can remove members');
    if (userId === uid) throw new Error('use leave_group to leave your own group');
    const row = memberRow(d, groupId, userId);
    if (!row) return;
    d.group_members = d.group_members.filter((m) => m !== row);
    const g = d.groups.find((x) => x.id === groupId)!;
    g.join_code = newJoinCode(d);
    logActivity(d, { group_id: groupId, actor_id: uid, kind: 'member_removed', payload: { user_id: userId } });
  });
}

/** Map a group to one of your classes (your own membership only). */
export async function setGroupClass(groupId: string, userId: string, classId: string | null) {
  write((d) => {
    const uid = me(d);
    const row = userId === uid ? memberRow(d, groupId, uid) : undefined;
    if (!row) return;
    checkMemberClass(d, uid, classId);
    row.class_id = classId;
  });
}

/** Activity rows you may see: those of the groups you are in now. */
function visibleActivity(): ActivityRow[] {
  const d = read();
  const mine = groupIdsOf(d, me(d));
  return d.activity.filter((a) => mine.has(a.group_id));
}

export async function loadActivity(groupId: string, limit = 50): Promise<ActivityRow[]> {
  const rows = visibleActivity()
    .filter((a) => a.group_id === groupId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  return copy(rows.slice(0, limit));
}

export async function activitySince(afterId: number): Promise<ActivityRow[]> {
  const rows = visibleActivity()
    .filter((a) => a.id > afterId)
    .sort((a, b) => a.id - b.id);
  return copy(rows.slice(0, 100));
}

/** Newest activity id you can see (0 if none). Used to start catch-up fresh. */
export async function latestActivityId(): Promise<number> {
  return visibleActivity().reduce((max, a) => Math.max(max, a.id), 0);
}

/**
 * Live group updates: every new activity row in a group you belong to
 * (including Jordan's scripted changes) arrives asynchronously, like a
 * realtime insert event. Returns an unsubscribe function.
 */
export function subscribeActivity(userId: string, onInsert: (row: ActivityRow) => void): () => void {
  return addActivityListener(userId, onInsert);
}
