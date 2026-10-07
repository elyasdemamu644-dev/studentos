"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A side sheet for small screens.
 *
 * The conversation and context drawers both needed one, and each had rolled
 * its own overlay button — so neither trapped focus, moved it into the sheet,
 * or gave it back on close.
 *
 * Radix `Dialog` underneath supplies the focus trap, Escape, `aria-modal`,
 * scroll lock and focus restoration; this only adds edge-anchored positioning.
 */
export function Drawer({
  open,
  onOpenChange,
  side = "left",
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "left" | "right";
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const titleId = React.useId();
  const descriptionId = React.useId();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="surface-blur fixed inset-0 z-50 bg-overlay data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            "fixed inset-y-0 z-50 flex w-[88vw] max-w-sm flex-col bg-background shadow-pop outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
            side === "left" ? "left-0 border-r border-border" : "right-0 border-l border-border",
            className,
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <DialogPrimitive.Title id={titleId} className="truncate text-sm font-semibold">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description id={descriptionId} className="truncate text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}