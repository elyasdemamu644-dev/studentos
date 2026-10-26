"use client";

import { useState } from "react";
import { Zap } from "lucide-react";

import { ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Drawer } from "@/components/ui/drawer";
import { MissionProgress } from "@/components/domain/mission-progress";
import { MissionBuilder } from "@/features/ai/mission-builder";
import { useMissions } from "@/features/ai/hooks";

/**
 * The Missions surface.
 *
 * A mission is work the student asked for that outlives one answer: a plan,
 * executed step by step, with the steps that change something held back until
 * the student approves them. This panel is where that state is visible and
 * where the approval is given — so the panel is not a report, it is the place
 * the decision is made.
 *
 * Headerless on purpose, like the Files panel: the `WorkspacePanel` that wraps
 * it in the workspace owns the header, and the drawer below supplies its own.
 * Two placements, one body, one set of controls.
 */

/**
 * The panel body: the student's missions, newest first, each with its progress
 * and whatever it is waiting for.
 */
export function AiMissionsPanel({ conversationId }: { conversationId?: string | null } = {}) {
  const missions = useMissions({ limit: 20 });

  if (missions.isPending) {
    return (
      <div className="p-3">
        <ListSkeleton rows={3} label="Loading missions" />
      </div>
    );
  }

  if (missions.isError) {
    return (
      <div className="p-3">
        <ErrorState
          error={missions.error}
          title="Unable to load missions"
          retry={() => {
            void missions.refetch();
          }}
        />
      </div>
    );
  }

  const items = missions.data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <Zap className="mx-auto h-8 w-8 mb-2 opacity-50" aria-hidden />
        <p className="font-medium">No missions yet</p>
        <p className="text-sm mt-1">Create a mission to run a multi-step plan using your tools.</p>
        <div className="mt-3 flex justify-center">
          <MissionBuilder conversationId={conversationId} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <div className="flex justify-end px-1">
        <MissionBuilder conversationId={conversationId} />
      </div>
      {items.map((mission) => (
        <div
          key={mission.id}
          className="cursor-pointer rounded-lg border border-border/50 p-2 transition-colors hover:bg-muted/30"
        >
          <MissionProgress mission={mission} compact />
        </div>
      ))}
    </div>
  );
}

/**
 * Drawer version of the Missions panel, for the widths with no room for a
 * fifth column. The trigger disappears exactly when the column appears, so the
 * two are never both offering the same surface.
 */
export function AiMissionsDrawer({ conversationId }: { conversationId?: string | null } = {}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open missions"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-ai px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-card transition-colors hover:text-foreground max-sm:h-11 max-sm:w-11 max-sm:justify-center max-sm:gap-0 max-sm:px-0 lg:h-11 lg:w-11 lg:justify-center lg:gap-0 lg:px-0 min-[1800px]:hidden"
      >
        <Zap className="h-3.5 w-3.5" aria-hidden />
        <span className="max-sm:sr-only lg:sr-only">Missions</span>
      </button>

      <Drawer
        open={open}
        onOpenChange={setOpen}
        side="right"
        title="Missions"
        description="Multi-step work, and the changes waiting for your approval"
      >
        <AiMissionsPanel conversationId={conversationId} />
      </Drawer>
    </>
  );
}
