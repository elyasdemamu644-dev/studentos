import type {
  AiCapabilityEvidence,
  AiCapabilityKind,
  AiHealthStatus,
  AiMode,
  AiProviderName,
  AiRoutingPreset,
  AiRoutingStrategy,
  ConversationType,
  ExecutionAutonomyMode,
  MemoryCategory,
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
 * AI conversation kinds. `STUDY_PLAN` and friends are the intent the assistant
 * starts from; the conversation's own title is derived from the first message
 * once one exists, so these labels describe intent rather than content.
 */
export const CONVERSATION_TYPE_LABELS: Record<ConversationType, string> = {
  CHAT: "Chat",
  TUTOR: "Tutor",
  QUIZ: "Quiz",
  STUDY_PLAN: "Study plan",
  EXPLAIN: "Explain",
};

export const CONVERSATION_TYPE_DESCRIPTIONS: Record<ConversationType, string> = {
  CHAT: "General study questions",
  TUTOR: "Guided teaching & practice",
  QUIZ: "Test your knowledge",
  STUDY_PLAN: "Plan a study schedule",
  EXPLAIN: "Break down a topic",
};

/** Placeholder titles for a conversation that has no messages yet. */
export const UNTITLED_CONVERSATION = "New conversation";

/**
 * AI behaviour modes. `AUTO` is the balanced default; each other mode asks the
 * assistant to run the turn differently (shorter, more reasoning, a deliverable,
 * end-to-end, source-grounded, or tutor-style).
 */
export const AI_MODE_LABELS: Record<AiMode, string> = {
  AUTO: "Auto",
  QUICK: "Quick",
  THINK: "Think",
  BUILDER: "Builder",
  AGENT: "Agent",
  RESEARCH: "Research",
  STUDY: "Study",
};

export const AI_MODE_DESCRIPTIONS: Record<AiMode, string> = {
  AUTO: "Balanced answers, the assistant decides",
  QUICK: "Short, direct answers",
  THINK: "Reason it through step by step",
  BUILDER: "Produce a saved deliverable",
  AGENT: "Work the task through end to end",
  RESEARCH: "Answer from your sources, with citations",
  STUDY: "Learn with explanation and practice",
};

/** The mode order shown in pickers (AUTO first). */
export const AI_MODES: readonly AiMode[] = [
  "AUTO",
  "QUICK",
  "THINK",
  "BUILDER",
  "AGENT",
  "RESEARCH",
  "STUDY",
];

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

/**
 * Execution autonomy modes. `manual` is the safe default; `autonomous` allows
 * a curated set of safe WRITE tools to run without confirmation.
 */
export const EXECUTION_AUTONOMY_MODE_LABELS: Record<ExecutionAutonomyMode, string> = {
  manual: "Manual",
  autonomous: "Autonomous",
};

export const EXECUTION_AUTONOMY_MODE_DESCRIPTIONS: Record<ExecutionAutonomyMode, string> = {
  manual: "Every change requires your confirmation",
  autonomous: "Safe changes run automatically; you can still review",
};

export const EXECUTION_AUTONOMY_MODES: readonly ExecutionAutonomyMode[] = [
  "manual",
  "autonomous",
];

// -- AI routing ---------------------------------

export const AI_ROUTING_STRATEGY_LABELS: Record<AiRoutingStrategy, string> = {
  FIXED: "Fixed model",
  AUTO: "Auto (policy-driven)",
};

export const AI_ROUTING_STRATEGY_DESCRIPTIONS: Record<AiRoutingStrategy, string> = {
  FIXED: "Always use the model you pin, or report it unavailable — never a substitute.",
  AUTO: "Pick from your allowed models by priority, preset and cost rules.",
};

export const AI_ROUTING_PRESET_LABELS: Record<AiRoutingPreset, string> = {
  quality: "Quality first",
  speed: "Speed first",
  cost: "Lowest cost",
  "local-first": "Local first",
  balanced: "Balanced",
};

export const AI_ROUTING_PRESET_DESCRIPTIONS: Record<AiRoutingPreset, string> = {
  quality: "Prefer stronger reasoning and tool support.",
  speed: "Prefer smaller, faster models.",
  cost: "Prefer the cheapest models, including free ones.",
  "local-first": "Prefer an on-device / on-network model when one is available.",
  balanced: "A reasonable mix of capability and cost.",
};

export const AI_ROUTING_PRESETS: readonly AiRoutingPreset[] = [
  "quality",
  "speed",
  "cost",
  "local-first",
  "balanced",
];

/**
 * Capability evidence levels, ordered strongest to weakest in the UI. The label
 * states *how* a claim is known, so a text test never masquerades as proof of
 * image or tool support.
 */
export const AI_CAPABILITY_EVIDENCE_LABELS: Record<AiCapabilityEvidence, string> = {
  VERIFIED: "Verified",
  PROVIDER_REPORTED: "Provider-reported",
  USER_CONFIGURED: "You configured this",
  UNKNOWN: "Unknown",
};

export const AI_CAPABILITY_EVIDENCE_DESCRIPTIONS: Record<AiCapabilityEvidence, string> = {
  VERIFIED: "Exercised successfully on this account.",
  PROVIDER_REPORTED: "Declared by the provider's own model metadata.",
  USER_CONFIGURED: "You asserted this while configuring.",
  UNKNOWN: "Not proven — not relied on for gating a request.",
};

export const AI_CAPABILITY_KIND_LABELS: Record<AiCapabilityKind, string> = {
  TEXT: "Text",
  VISION: "Images",
  TOOLS: "Tools",
  STRUCTURED_OUTPUT: "Structured output",
  LONG_CONTEXT: "Long context",
  REASONING: "Reasoning",
};

export const AI_HEALTH_STATUS_LABELS: Record<AiHealthStatus, string> = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  UNHEALTHY: "Unhealthy",
  UNKNOWN: "Unknown",
};

// -- Saved memories -----------------------------

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  PREFERENCE: "Preferences",
  ACADEMIC: "Academic",
  GOALS: "Goals",
  SCHEDULE: "Schedule",
  OTHER: "Other",
};

export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  "PREFERENCE",
  "ACADEMIC",
  "GOALS",
  "SCHEDULE",
  "OTHER",
];
