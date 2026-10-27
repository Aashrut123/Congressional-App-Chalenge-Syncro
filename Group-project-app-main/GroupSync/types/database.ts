import type { RecurrenceRule } from '@/lib/recurrence';

export type { RecurrenceRule };

export type GroupRole = 'owner' | 'admin' | 'member';
export type EventKind = 'event' | 'meeting' | 'deadline';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high';
export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
export type TaskOrigin = 'manual' | 'ai' | 'fallback';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url?: string | null;
  skills?: string;
  interests?: string;
  timezone?: string;
  goals?: string[];
  custom_goal?: string;
  planning_style?: 'steady' | 'sprint' | 'flexible';
  onboarding_completed?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  color: string;
  created_by: string;
  created_at: string;
  outcome?: string;
  starts_on?: string | null;
  deadline?: string | null;
  status?: ProjectStatus;
  priority?: TaskPriority;
  archived_at?: string | null;
}

export interface Membership {
  group_id: string;
  user_id: string;
  role: GroupRole;
  joined_at: string;
  profile?: Profile;
}

export interface CalendarEvent {
  id: string;
  group_id: string;
  created_by: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  location: string;
  color: string | null;
  kind: EventKind;
  group?: Group;
}

export type AttendeeResponse = 'invited' | 'accepted' | 'declined';

export interface Meeting {
  id: string;
  group_id: string;
  event_id: string | null;
  created_by: string;
  title: string;
  description: string;
  agenda: string;
  starts_at: string;
  ends_at: string;
  location: string;
  notes: string;
  action_items: string;
}

export interface MeetingAttendee {
  meeting_id: string;
  user_id: string;
  response: AttendeeResponse;
  profile?: Pick<Profile, 'display_name'>;
}

export interface TaskAssignment {
  user_id: string;
  profile?: Profile;
}

export interface Task {
  id: string;
  group_id: string | null;
  created_by: string;
  title: string;
  description: string;
  due_at: string | null;
  starts_at?: string | null;
  original_due_at?: string | null;
  schedule_note?: string;
  priority: TaskPriority;
  status: TaskStatus;
  created_at: string;
  estimated_minutes?: number | null;
  actual_minutes?: number | null;
  origin?: TaskOrigin;
  blocked_reason?: string;
  plan_id?: string | null;
  milestone_id?: string | null;
  series_id?: string | null;
  recurrence?: RecurrenceRule | null;
  occurrence_index?: number;
  skipped?: boolean;
  group?: Group;
  assignments?: TaskAssignment[];
}

export interface Requirement {
  id: string;
  task_id: string;
  title: string;
  description: string;
  due_at: string | null;
  assigned_to: string | null;
  completed: boolean;
}

export interface Comment {
  id: string;
  task_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profile?: Profile;
}

export interface Milestone {
  id: string;
  group_id: string;
  title: string;
  description: string;
  due_on: string | null;
  completed_at: string | null;
  created_by: string;
  sort_order?: number;
}

export interface ProgressLog {
  id: string;
  group_id: string;
  user_id: string;
  log_date: string;
  accomplishments: string;
  next_steps: string;
  blockers: string;
  task_id: string | null;
  created_at: string;
  profile?: Profile;
  group?: Pick<Group, 'id' | 'name'>;
}

export interface AvailabilityWindow {
  id: string;
  user_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
}

export interface UnavailablePeriod {
  id: string;
  user_id: string;
  starts_on: string;
  ends_on: string;
  reason: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  group_id: string | null;
  kind: string;
  title: string;
  body: string;
  href: string;
  read_at: string | null;
  created_at: string;
}

export interface TaskDependency {
  task_id: string;
  depends_on: string;
}
