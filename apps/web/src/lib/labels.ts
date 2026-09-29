import type {
  AiProviderName,
  MilestoneStatus,
  ResourceType,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/types/api-types";

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

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  PDF: "PDF",
  VIDEO: "Video",
  AUDIO: "Audio",
  SLIDES: "Slides",
  LINK: "Link",
  DOCUMENT: "Document",
  OTHER: "Other",
};

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  ASSIGNMENT_DUE: "Assignment due",
  EXAM_REMINDER: "Exam reminder",
  OVERDUE_TASK: "Overdue task",
  STUDY_REMINDER: "Study reminder",
  STUDY_PLAN_REMINDER: "Study plan",
  GOAL_REMINDER: "Goal reminder",
  GENERAL: "Update",
};

export const AI_PROVIDER_LABELS: Record<AiProviderName, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
  custom: "Custom endpoint",
};

/**
 * Providers that authenticate by endpoint alone, so no API key is required.
 * Mirrors `CREDENTIAL_FREE_PROVIDERS` in the API's ai-connections schema.
 */
export const CREDENTIAL_FREE_PROVIDERS: readonly AiProviderName[] = ["ollama"];

/** Providers that are meaningless without an explicit endpoint. */
export const ENDPOINT_REQUIRED_PROVIDERS: readonly AiProviderName[] = ["ollama", "custom"];

export function isCredentialFreeProvider(provider: AiProviderName): boolean {
  return CREDENTIAL_FREE_PROVIDERS.includes(provider);
}

export function isEndpointRequiredProvider(provider: AiProviderName): boolean {
  return ENDPOINT_REQUIRED_PROVIDERS.includes(provider);
}
