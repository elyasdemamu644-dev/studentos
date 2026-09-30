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
export type NotificationType =
  | "ASSIGNMENT_DUE"
  | "EXAM_REMINDER"
  | "OVERDUE_TASK"
  | "STUDY_REMINDER"
  | "STUDY_PLAN_REMINDER"
  | "GOAL_REMINDER"
  | "GENERAL";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  delivery: string;
  channel: string | null;
  status: NotificationStatus;
  readAt: string | null;
  /** Set when the reminder was derived from another record. */
  relatedType: string | null;
  relatedId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationsResult extends Page<AppNotification> {
  unreadCount: number;
}

/** Result of the reminder sweep (POST /notifications/generate). */
export interface NotificationGenerateResult {
  created: number;
  scanned: number;
  unreadCount: number;
}

// ── Resources ─────────────────────────────────────

export type ResourceStorageType = "URL" | "UPLOAD";

export type ResourceType =
  | "PDF"
  | "VIDEO"
  | "AUDIO"
  | "SLIDES"
  | "LINK"
  | "DOCUMENT"
  | "OTHER";

/**
 * Mirrors the API resource mapper. `UPLOAD` storage is reserved for the
 * deferred S3 phase, so the UI creates `URL` resources today and keeps the
 * file metadata fields for records that already carry them.
 */
export interface ResourceRecord {
  id: string;
  courseId: string | null;
  title: string;
  description: string | null;
  url: string | null;
  storageType: ResourceStorageType;
  fileKey: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  resourceType: ResourceType;
  createdAt: string;
  updatedAt: string;
  course?: CourseRef | null;
}

// ── Grades ────────────────────────────────────────

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

// What the assistant did while producing its reply. Mirrors `ToolActivityEntry`
// in `apps/api/src/modules/ai/agent.ts`.
export interface AiToolActivity {
  tool: string;
  label: string;
  status: "success" | "error" | "proposed";
  summary: string;
}

// A change the assistant wants to make. Mirrors `PendingAction` in
// `apps/api/src/modules/ai/confirmations.ts`. Nothing here is applied until the
// user confirms.
export type PendingActionStatus = "PENDING" | "EXECUTED" | "CANCELLED" | "SUPERSEDED";

export interface PendingAction {
  id: string;
  title: string;
  status: PendingActionStatus;
  actions: Array<{ tool: string; description: string }>;
  createdAt: string;
  /** When the proposal stops being confirmable. */
  expiresAt: string;
  result: unknown | null;
}

// ── AI connections ────────────────────────────────

// Mirrors `AiProviderName` in `apps/api/src/modules/ai-connections/schema.ts`.
export type AiProviderName =
  | "openai"
  | "gemini"
  | "anthropic"
  | "openrouter"
  | "ollama"
  | "custom";

export interface AiConnection {
  id: string;
  provider: AiProviderName;
  model: string | null;
  endpoint: string | null;
  enabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiConnectionTestResult {
  success: boolean;
  message: string;
  model: string | null;
  error: string | null;
}

// ── Dashboard ─────────────────────────────────────

export interface DashboardCourse {
  id: string;
  code: string | null;
  name: string;
  status: CourseStatus;
  taskTotal: number;
  taskCompleted: number;
  /** 0-100, or null when the course has no tasks. */
  taskProgress: number | null;
  /** 0-100 weighted average, or null when nothing is scored. */
  gradeAverage: number | null;
  gradeCount: number;
}

export interface DashboardEvent {
  id: string;
  title: string;
  type: EventType;
  startAt: string;
  endAt: string;
  location: string | null;
  course: CourseRef | null;
}

export interface DashboardTask {
  id: string;
  title: string;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  course: CourseRef | null;
}

export type ActivityKind = "task" | "note" | "grade" | "event" | "goal" | "resource";

export interface DashboardActivity {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  at: string;
  href: string | null;
}

export interface DashboardData {
  academicYears: AcademicYear[];
  currentAcademicYear: AcademicYear | null;
  currentSemester: Semester | null;
  courses: {
    total: number;
    active: number;
    completed: number;
    recent: DashboardCourse[];
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    overdue: number;
    dueToday: number;
  };
  upcomingTasks: DashboardTask[];
  overdueTasks: DashboardTask[];
  exams: {
    upcoming: Array<Omit<DashboardEvent, "type">>;
    /** Whole days until the next exam, or null when none is scheduled. */
    nextInDays: number | null;
  };
  events: {
    today: DashboardEvent[];
    upcoming: DashboardEvent[];
  };
  studySessions: {
    todayMinutes: number;
    todayCount: number;
    weekMinutes: number;
    recent: Array<{ id: string; topic: string | null; startedAt: string; endedAt: string | null; durationMinutes: number | null }>;
  };
  activeGoals: Array<{
    id: string;
    title: string;
    progress: number;
    deadline: string | null;
    status: GoalStatus;
    milestoneTotal: number;
    milestoneCompleted: number;
  }>;
  recentNotes: Array<{ id: string; title: string; updatedAt: string; course: CourseRef | null }>;
  recentGrades: Array<{
    id: string;
    title: string;
    score: number | null;
    maxScore: number | null;
    type: GradeType;
    recordedAt: string;
    course: CourseRef | null;
  }>;
  resources: { total: number };
  notifications: {
    unreadCount: number;
    recent: Array<{
      id: string;
      title: string;
      message: string;
      type: NotificationType;
      status: NotificationStatus;
      relatedType: string | null;
      relatedId: string | null;
      createdAt: string;
    }>;
  };
  activity: DashboardActivity[];
}

// ── Course summary ────────────────────────────────

/** Cross-system rollup returned by GET /courses/:id/summary. */
export interface CourseSummary {
  course: {
    id: string;
    name: string;
    code: string | null;
    status: CourseStatus;
    credits: number | null;
    semesterId: string | null;
  };
  tasks: {
    total: number;
    completed: number;
    open: number;
    overdue: number;
    /** 0-100, or null when the course has no tasks. */
    progress: number | null;
    byStatus: Record<string, number>;
  };
  events: {
    upcoming: Array<{
      id: string;
      title: string;
      type: EventType;
      startAt: string;
      endAt: string | null;
      location: string | null;
    }>;
    examCount: number;
  };
  nextExam: { id: string; title: string; startAt: string; location: string | null } | null;
  notes: { total: number };
  resources: { total: number };
  grades: {
    total: number;
    scored: number;
    /** 0-100 weighted average, or null when nothing is scored. */
    average: number | null;
    recent: Array<{
      id: string;
      title: string;
      score: number | null;
      maxScore: number | null;
      weight: number | null;
      type: GradeType;
      recordedAt: string;
    }>;
  };
  study: { sessions: number; totalMinutes: number };
  goals: { relatedActive: number };
  eventsToday: number;
}