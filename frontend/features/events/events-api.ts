import { api } from "@/lib/api/client";
import type { CalEvent, EventType, Page } from "@/types/api-types";

export interface EventListParams {
  courseId?: string;
  type?: EventType;
  startFrom?: string;
  startTo?: string;
  limit?: number;
  cursor?: string;
}

export function listEvents(params: EventListParams = {}): Promise<Page<CalEvent>> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<Page<CalEvent>>(qs ? `/events?${qs}` : "/events");
}

export async function listAllEvents(
  params: Omit<EventListParams, "limit" | "cursor"> = {},
): Promise<Page<CalEvent>> {
  const items: CalEvent[] = [];
  let cursor: string | undefined;

  do {
    const page = await listEvents({ ...params, limit: 100, cursor });
    items.push(...page.items);
    cursor = page.hasMore ? page.nextCursor ?? undefined : undefined;
  } while (cursor);

  return { items, hasMore: false, nextCursor: null };
}

export function getEvent(id: string): Promise<CalEvent> {
  return api.get<CalEvent>(`/events/${id}`);
}

export interface CreateEventInput {
  title: string;
  description?: string | null;
  type?: EventType;
  startAt: string;
  endAt?: string | null;
  location?: string | null;
  courseId?: string | null;
}

export function createEvent(input: CreateEventInput): Promise<CalEvent> {
  return api.post<CalEvent>("/events", input);
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  type?: EventType;
  startAt?: string;
  endAt?: string | null;
  location?: string | null;
  courseId?: string | null;
}

export function updateEvent(id: string, input: UpdateEventInput): Promise<CalEvent> {
  return api.patch<CalEvent>(`/events/${id}`, input);
}

export function deleteEvent(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/events/${id}`);
}