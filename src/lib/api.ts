/**
 * The app's data layer. With a Supabase project configured, every call goes
 * to the server (`api-cloud.ts`, protected by row-level security). Without
 * one, the app runs as an on-device demo (`local/api.ts`) and nothing leaves
 * the device. Both implement exactly the same functions.
 */
import * as cloud from './api-cloud';
import * as local from './local/api';
import { isDemo } from './supabase';

export type { PlannerData, TaskInput, TaskSeed } from './api-cloud';

const impl: typeof cloud = isDemo ? local : cloud;

export const {
  loadPlanner,
  loadProfile,
  updateProfile,
  addClass,
  updateClass,
  deleteClass,
  createTask,
  topUpMySeries,
  stopSeries,
  updateTask,
  deleteTask,
  bulkInsertTasks,
  deleteTaggedTasks,
  setCompleted,
  copyRescue,
  dismissRescue,
  createGroup,
  joinGroup,
  regenerateJoinCode,
  leaveGroup,
  deleteGroup,
  removeMember,
  setGroupClass,
  loadActivity,
  activitySince,
  latestActivityId,
  subscribeActivity,
  randomId,
} = impl;
