import { CalendarClock, Link2, MapPin } from "lucide-react";
import type { CalEvent } from "@/features/api-types";
import { formatDate, formatTime } from "@/lib/format";
import { EVENT_TYPE_LABELS } from "@/lib/labels";

export function EventCard({ event }: { event: CalEvent }) {
  const start = event.startAt;
  const end = event.endAt ?? start;
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
            <span className="text-[10px] font-semibold uppercase leading-none">{formatDate(start, "MMM")}</span>
            <span className="text-sm font-bold leading-tight">{formatDate(start, "d")}</span>
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{event.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatTime(start)} – {formatTime(end)}
              {event.type && <span> · {EVENT_TYPE_LABELS[event.type] ?? event.type}</span>}
            </p>
            {(event.course || event.location) && (
              <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {event.course && (
                  <span className="inline-flex items-center gap-1">
                    <Link2 className="h-3 w-3" aria-hidden />
                    {event.course.name}
                  </span>
                )}
                {event.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" aria-hidden />
                    {event.location}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
    </div>
  );
}