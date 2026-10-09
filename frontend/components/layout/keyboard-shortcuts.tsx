"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * `g`-prefixed destination shortcuts. Deliberately mnemonic and collision-free
 * with typing, because the handler ignores keystrokes fired inside form fields.
 */
export const NAV_SHORTCUTS: Record<string, string> = {
  d: "/dashboard",
  a: "/ai",
  t: "/tasks",
  n: "/notes",
  c: "/courses",
  e: "/exams",
  l: "/calendar",
  r: "/resources",
  s: "/study",
  o: "/goals",
  y: "/analytics",
};

const HREF_SHORTCUT_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(NAV_SHORTCUTS).map(([key, href]) => [href, `G ${key.toUpperCase()}`]),
);

/** Shortcut hint for a nav href, e.g. `/tasks` -> "G T". Undefined if none. */
export function navShortcutFor(href: string): string | undefined {
  return HREF_SHORTCUT_LABEL[href];
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
};

export function useShellShortcuts({
  onToggleSidebar,
  onOpenHelp,
  onOpenPalette,
}: {
  onToggleSidebar: () => void;
  onOpenHelp: () => void;
  onOpenPalette: () => void;
}) {
  const router = useRouter();
  const leader = useRef<number | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key;

      // `g` opens a one-second window for the second key.
      if (leader.current !== null) {
        const withinWindow = Date.now() - leader.current < 1000;
        leader.current = null;
        const destination = NAV_SHORTCUTS[key.toLowerCase()];
        if (withinWindow && destination) {
          event.preventDefault();
          router.push(destination);
          return;
        }
      }

      if (key === "g") {
        leader.current = Date.now();
        return;
      }

      switch (key) {
        case "[":
          event.preventDefault();
          onToggleSidebar();
          break;
        case "?":
          event.preventDefault();
          onOpenHelp();
          break;
        case "/":
          event.preventDefault();
          onOpenPalette();
          break;
        case "n":
          event.preventDefault();
          router.push("/tasks?new=1");
          break;
        case "N":
          event.preventDefault();
          router.push("/notes?note=new");
          break;
        case "c":
          event.preventDefault();
          router.push("/calendar?new=1");
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenHelp, onOpenPalette, onToggleSidebar, router]);
}

interface ShortcutItem {
  keys: string[];
  label: string;
}

const GROUPS: { title: string; items: ShortcutItem[] }[] = [
  {
    title: "Global",
    items: [
      { keys: ["Ctrl", "K"], label: "Open search & commands" },
      { keys: ["/"], label: "Open search & commands" },
      { keys: ["G", "then", "D"], label: "Go to Dashboard" },
      { keys: ["G", "then", "A"], label: "Go to AI Assistant" },
      { keys: ["G", "then", "T"], label: "Go to Tasks" },
      { keys: ["G", "then", "N"], label: "Go to Notes" },
      { keys: ["G", "then", "C"], label: "Go to Courses" },
      { keys: ["G", "then", "L"], label: "Go to Calendar" },
      { keys: ["G", "then", "S"], label: "Go to Study" },
    ],
  },
  {
    title: "Create & layout",
    items: [
      { keys: ["N"], label: "New task" },
      { keys: ["Shift", "N"], label: "New note" },
      { keys: ["C"], label: "New calendar event" },
      { keys: ["["], label: "Toggle sidebar" },
      { keys: ["?"], label: "Show this help" },
    ],
  },
];

function Key({ children }: { children: string }) {
  if (children === "then") {
    return <span className="px-0.5 text-[11px] text-muted-foreground">then</span>;
  }
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Move around StudentOS without leaving the keyboard.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </p>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li
                    key={`${group.title}-${item.label}-${item.keys.join("-")}`}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span className="text-foreground/85">{item.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((key) => (
                        <Key key={key}>{key}</Key>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
