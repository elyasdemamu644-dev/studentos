"use client";

import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  ChevronDown,
  GraduationCap,
  ListTodo,
  Plus,
  StickyNote,
  Target,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface QuickCreateAction {
  label: string;
  href: string;
  icon: LucideIcon;
  hint?: string;
}

/**
 * Every destination already owns its create flow behind a query param (see
 * `command-palette.tsx`), so quick-create is pure navigation — no duplicate
 * forms, no extra API surface.
 */
const ACTIONS: QuickCreateAction[] = [
  { label: "New task", href: "/tasks?new=1", icon: ListTodo, hint: "N" },
  { label: "New note", href: "/notes?note=new", icon: StickyNote, hint: "⇧N" },
  { label: "New calendar event", href: "/calendar?new=1", icon: CalendarPlus, hint: "C" },
  { label: "New course", href: "/courses?new=1", icon: GraduationCap },
  { label: "New goal", href: "/goals?new=1", icon: Target },
  { label: "Start focus session", href: "/study", icon: Timer },
];

export function QuickCreateMenu({
  collapsedLabel = false,
  className,
}: {
  /** Icon-only trigger, used in the compact/mobile header. */
  collapsedLabel?: boolean;
  className?: string;
}) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="default"
          size={collapsedLabel ? "icon" : "sm"}
          className={cn("gap-1.5 shadow-card", collapsedLabel && "shadow-card", className)}
          aria-label="Create"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {!collapsedLabel && (
            <>
              <span>New</span>
              <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Create</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ACTIONS.map((action, index) => (
          <DropdownMenuItem
            key={action.href}
            onSelect={() => router.push(action.href)}
            className={index === ACTIONS.length - 1 ? "mt-1" : undefined}
          >
            <action.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span>{action.label}</span>
            {action.hint && <DropdownMenuShortcut>{action.hint}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
