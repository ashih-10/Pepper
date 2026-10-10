export type TaskType = 'test' | 'quiz' | 'project' | 'homework' | 'custom';
export type WeightTier = 'high' | 'medium' | 'low';
export type EducationLevel = 'middle' | 'high' | 'college';

export type RecurrenceFreq = 'daily' | 'weekdays' | 'weekly';
export interface Recurrence {
  freq: RecurrenceFreq;
  /** Last day (YYYY-MM-DD, inclusive) to generate instances for. */
  until?: string | null;
}

/** A row from the `tasks` table. */
export interface TaskRow {
  id: string;
  created_by: string;
  group_id: string | null;
  class_id: string | null;
  title: string;
  task_type: TaskType;
  custom_label: string | null;
  custom_tier: WeightTier | null;
  weight_pct: number | null;
  due_at: string;
  notes: string | null;
  series_id: string | null;
  recurrence: Recurrence | null;
  created_at: string;
  updated_at: string;
}

/** A row from `task_series`: the template and rule of a recurring task. */
export interface TaskSeriesRow {
  id: string;
  created_by: string;
  group_id: string | null;
  class_id: string | null;
  title: string;
  task_type: TaskType;
  custom_label: string | null;
  custom_tier: WeightTier | null;
  weight_pct: number | null;
  notes: string | null;
  rule: Recurrence;
  first_due: string;
  generated_until: string;
  created_at: string;
}

export interface ClassRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  position: number;
}

export interface Profile {
  id: string;
  display_name: string;
  education_level: EducationLevel | null;
  grade: string | null;
  goals: string | null;
  struggles: string | null;
  quiet_hours_enabled: boolean;
  quiet_start: number;
  quiet_end: number;
  onboarded: boolean;
}

export interface GroupRow {
  id: string;
  name: string;
  owner_id: string;
  join_code: string;
  created_at: string;
}

export interface GroupMemberRow {
  group_id: string;
  user_id: string;
  role: 'owner' | 'member';
  class_id: string | null;
  joined_at: string;
}

export type ActivityKind =
  | 'task_added'
  | 'task_edited'
  | 'due_changed'
  | 'type_changed'
  | 'task_deleted'
  | 'series_stopped'
  | 'member_joined'
  | 'member_left'
  | 'member_removed';

export interface ActivityRow {
  id: number;
  group_id: string;
  actor_id: string | null;
  kind: ActivityKind;
  task_id: string | null;
  task_title: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface TaskSnapshot {
  title: string;
  task_type: TaskType;
  custom_label: string | null;
  custom_tier: WeightTier | null;
  weight_pct: number | null;
  due_at: string;
  notes: string | null;
}

export interface RescueRow {
  id: number;
  user_id: string;
  group_name: string;
  reason: 'task_deleted' | 'group_deleted';
  snapshot: TaskSnapshot;
  created_at: string;
}

/** A task as the planner sees it: the row plus this student's own context. */
export interface PlannerTask extends TaskRow {
  completed_at: string | null;
  class_name: string | null;
  color: string;
  group_name: string | null;
}
