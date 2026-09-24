// Domain types mirroring the API response shapes (see apps/api/src/modules).

export interface Page<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

// ── Academics ─────────────────────────────────────

export type YearStatus = "UPCOMING" | "ACTIVE" | "COMPLETED";

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: YearStatus;
}

export interface Semester {
  id: string;
  academicYearId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: YearStatus;
  academicYear?: AcademicYear;
}

export type CourseStatus = "ACTIVE" | "COMPLETED" | "DROPPED";

export interface CourseSemester {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: YearStatus;
  academicYear: { id: string; name: string; startDate: string; endDate: string; status: YearStatus };
}

export interface Course {
  id: string;
  code: string | null;
  name: string;
  credits: number | null;
  description: string | null;
  instructor: string | null;
  semesterId: string | null;
  status: CourseStatus;
  createdAt: string;
  updatedAt: string;
  semester: CourseSemester | null;
}

// ── Tasks ─────────────────────────────────────────

export type TaskStatus = "TODO" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TaskType =
  | "ASSIGNMENT"
  | "HOMEWORK"
  | "PROJECT"
  | "READING"
  | "PRACTICE"
  | "REVISION"
  | "OTHER";

export interface CourseRef {
  id: string;
  code: string | null;
  name: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  status: TaskStatus;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTagRef {
  id: string;
  taskId: string;
  name: string;
  color: string | null;
}

export interface Task {
  id: string;
  courseId: string | null;
  title: string;
  description: string | null;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  estimatedMinutes: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  course?: CourseRef | null;
  subtasks?: Subtask[];
  tags?: TaskTagRef[];
}

// ── Notes ─────────────────────────────────────────

export interface Note {
  id: string;
  courseId: string | null;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  course?: CourseRef | null;
}

// ── Events ────────────────────────────────────────

export type EventType =
  | "CLASS"
  | "EXAM"
  | "ASSIGNMENT"
  | "PROJECT"
  | "STUDY"
  | "MEETING"
  | "PERSONAL"
  | "OTHER";

export interface CalEvent {
  id: string;
  courseId: string | null;
  title: string;
  description: string | null;
  type: EventType;
  startAt: string;
  endAt: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
  course?: CourseRef | null;
}

// ── Study sessions ────────────────────────────────

export interface StudySession {
  id: string;
  courseId: string | null;
  taskId: string | null;
  topic: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  focusRating: number | null;
  createdAt: string;
  course?: CourseRef | null;
}

export interface StudySessionListResult extends Page<StudySession> {
  summary: { count: number; totalMinutes: number };
}

// ── Goals ─────────────────────────────────────────

export type GoalStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";
export type MilestoneStatus = "TODO" | "IN_PROGRESS" | "COMPLETED";

export interface GoalMilestone {
  id: string;
  goalId: string;
  title: string;
  status: MilestoneStatus;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  status: GoalStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  milestones?: GoalMilestone[];
}

// ── Notifications ─────────────────────────────────

export type NotificationStatus = "UNREAD" | "READ" | "ARCHIVED";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  status: NotificationStatus;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResult extends Page<AppNotification> {
  unreadCount: number;
}

// ── Resources / Grades ────────────────────────────

export interface ResourceRecord {
  id: string;
  courseId: string | null;
  title: string;
  url: string | null;
  fileType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  course?: CourseRef | null;
}

export type GradeType =
  | "ASSIGNMENT"
  | "EXAM"
  | "QUIZ"
  | "PROJECT"
  | "PARTICIPATION"
  | "FINAL"
  | "OTHER"
  | "ASSESSMENT";

export interface GradeRecord {
  id: string;
  courseId: string | null;
  title: string;
  score: number | null;
  maxScore: number | null;
  weight: number | null;
  type: GradeType;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
  course?: CourseRef | null;
}

// ── Settings ──────────────────────────────────────

// The backend settings store is a flat { key: string } map (see
// `apps/api/src/modules/settings/schema.ts`); a null value deletes a key.
// Boolean preferences are therefore persisted as "true"/"false" strings.
export type SettingValue = string | null;

export interface Settings {
  [key: string]: SettingValue;
}

// ── AI ────────────────────────────────────────────

export type ConversationType = "CHAT" | "TUTOR" | "QUIZ" | "STUDY_PLAN" | "EXPLAIN";

export interface Conversation {
  id: string;
  title: string;
  type: ConversationType;
  createdAt: string;
  updatedAt: string;
}

export type AiMessageRole = "USER" | "ASSISTANT" | "SYSTEM";

export interface AiMessage {
  id: string;
  conversationId: string;
  role: AiMessageRole;
  content: string;
  createdAt: string;
}

// ── Dashboard ─────────────────────────────────────

export interface DashboardData {
  academicYears: AcademicYear[];
  currentAcademicYear: AcademicYear | null;
  currentSemester: Semester | null;
  courses: {
    total: number;
    active: number;
    recent: Array<{ id: string; code: string; name: string }>;
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
  upcomingTasks: Array<{ id: string; title: string; dueDate: string | null; priority: TaskPriority; status: TaskStatus }>;
  events: {
    today: Array<{ id: string; title: string; type: EventType; startAt: string; endAt: string }>;
    upcoming: Array<{ id: string; title: string; type: EventType; startAt: string; endAt: string }>;
  };
  studySessions: {
    todayMinutes: number;
    todayCount: number;
    recent: Array<{ id: string; topic: string | null; startedAt: string; endedAt: string | null; durationMinutes: number | null }>;
  };
  activeGoals: Array<{ id: string; title: string; progress: number; deadline: string | null; status: GoalStatus }>;
  recentNotes: Array<{ id: string; title: string; updatedAt: string }>;
  recentGrades: Array<{ id: string; title: string; score: number | null; maxScore: number | null; recordedAt: string }>;
  notifications: { unreadCount: number };
}