import type {
  MilestoneStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/features/api-types";

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  ASSIGNMENT: "Assignment",
  HOMEWORK: "Homework",
  PROJECT: "Project",
  READING: "Reading",
  PRACTICE: "Practice",
  REVISION: "Revision",
  OTHER: "Other",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  CLASS: "Class",
  EXAM: "Exam",
  ASSIGNMENT: "Assignment",
  PROJECT: "Project",
  STUDY: "Study",
  MEETING: "Meeting",
  PERSONAL: "Personal",
  OTHER: "Other",
};