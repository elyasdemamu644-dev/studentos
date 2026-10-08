"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarClock,
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  Library,
  ListTodo,
  LogOut,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
  StickyNote,
  Target,
  Timer,
  User,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ThemeModeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/domain/notification-bell";
import { useAuth } from "@/features/auth/auth-provider";
import { useGenerateNotifications } from "@/features/notifications/hooks";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CommandPaletteProvider, useCommandPalette } from "@/components/layout/command-palette";

/**
 * Grouped so the sidebar reads as a product, not a flat list of 13 routes.
 * `Command` is listed first because the assistant is the app's centrepiece.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: typeof ListTodo;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Command",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/ai", label: "AI Assistant", icon: Sparkles },
    ],
  },
  {
    label: "Academics",
    items: [
      { href: "/courses", label: "Courses", icon: BookOpen },
      { href: "/academics", label: "Term structure", icon: GraduationCap },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/exams", label: "Exams", icon: CalendarClock },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Work",
    items: [
      { href: "/tasks", label: "Tasks", icon: ListTodo },
      { href: "/notes", label: "Notes", icon: StickyNote },
      { href: "/resources", label: "Resources", icon: Library },
      { href: "/study", label: "Study", icon: Timer },
      { href: "/goals", label: "Goals", icon: Target },
      { href: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

/**
 * The five items shown directly in the mobile bottom bar, picked by href so
 * reordering `NAV_GROUPS` can never break it. Everything else lives behind
 * "More".
 */
export const MOBILE_NAV_HREFS = [
  "/dashboard",
  "/ai",
  "/tasks",
  "/calendar",
  "/study",
] as const;

export { NAV_ITEMS };

export function isNavActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Routes that are workspaces rather than pages.
 *
 * A normal route scrolls inside the padded, width-capped `<main>`: the document
 * grows and the whole page moves. A workspace is different — the AI assistant
 * is three panes that each scroll on their own, with the transcript and composer
 * pinned inside the viewport. Percentage heights only resolve against a definite
 * parent height, so these routes need the shell to hand them the viewport
 * instead of `min-height`. They also need the page padding and the content
 * width cap removed, or the three panes get squeezed inside a reading column.
 */
export const WORKSPACE_ROUTES = ["/ai"] as const;

export function isWorkspaceRoute(pathname: string): boolean {
  return WORKSPACE_ROUTES.some((href) => isNavActive(pathname, href));
}

const AI_HREF = "/ai";

function NavItemLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
  className,
}: {
  href: string;
  label: string;
  icon: typeof ListTodo;
  active: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-3 rounded-nav px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
        href === AI_HREF && !active && "text-primary",
        className,
      )}
    >
      <Icon
        className={cn("h-4 w-4 shrink-0", href === AI_HREF && !active && "text-primary")}
        aria-hidden
      />
      <span className="truncate">{label}</span>
      {active && (
        <span
          className="absolute inset-y-[15%] left-0 rounded-full bg-primary"
          style={{ width: "var(--nav-indicator)" }}
          aria-hidden
        />
      )}
    </Link>
  );
}

function NavLinks({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className={className} aria-label="Primary">
      <ul className="space-y-5">
        {NAV_GROUPS.map((group) => (
          <li key={group.label}>
            <p
              className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70"
              style={{ letterSpacing: "var(--tracking-heading)" }}
            >
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavItemLink
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={isNavActive(pathname, item.href)}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-sm font-bold text-primary-foreground shadow-card">
        S
      </span>
      <span className="font-display-strong text-base">StudentOS</span>
    </Link>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "S";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 flex-1 lg:block">
            <span className="block truncate font-medium">
              {user.firstName} {user.lastName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel>
          {user.firstName} {user.lastName}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <User className="h-4 w-4" aria-hidden />
            Profile settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => logout()}>
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar() {
  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col border-r border-sidebar-border bg-sidebar lg:flex"
    >
      <div className="flex h-14 shrink-0 items-center px-5">
        <Brand />
      </div>
      <Separator className="bg-sidebar-border" />
      <div className="flex flex-1 flex-col justify-between overflow-y-auto p-[var(--nav-inset)]">
        <NavLinks />
        <div className="mt-6 space-y-3">
          <ThemeModeToggle compact />
          <UserMenu />
        </div>
      </div>
    </aside>
  );
}

function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const mainItems = NAV_ITEMS.filter((item) =>
    (MOBILE_NAV_HREFS as readonly string[]).includes(item.href),
  );
  const moreItems = NAV_ITEMS.filter(
    (item) => !(MOBILE_NAV_HREFS as readonly string[]).includes(item.href),
  );
  const moreHrefs = [...moreItems.map((i) => i.href), "/settings"];
  const moreActive = moreHrefs.some((href) => isNavActive(pathname, href));

  // Escape closes, Tab is trapped inside, and focus returns to the trigger —
  // the previous version let focus sit behind the overlay.
  useEffect(() => {
    if (!moreOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = sheetRef.current;
    const trigger = triggerRef.current;
    const focusables = node?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (previouslyFocused ?? trigger)?.focus?.();
    };
  }, [moreOpen]);

  return (
    <>
      {moreOpen && (
        <div
          className="surface-blur fixed inset-0 z-40 bg-overlay lg:hidden"
          onClick={() => setMoreOpen(false)}
          aria-hidden
        />
      )}
      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="flex items-stretch">
          {mainItems.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium"
                >
                  <span
                    className={cn(
                      "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                      active ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                  >
                    <item.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0 flex-1">
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              aria-controls="mobile-more-sheet"
              className="flex w-full flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium"
            >
              <span
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                  moreActive ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <MoreHorizontal className="h-5 w-5" aria-hidden />
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen && (
        <>
          <div
            id="mobile-more-sheet"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="More pages"
            className="fixed inset-x-3 bottom-20 z-50 max-h-[70dvh] overflow-y-auto surface-panel p-2 shadow-pop lg:hidden"
          >
            <div className="flex items-center justify-between px-3 pb-1 pt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">More</p>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMoreOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <ul className="space-y-0.5">
              {[...moreItems, { href: "/settings", label: "Settings", icon: Settings }].map((item) => {
                const active = isNavActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                        active ? "bg-accent text-accent-foreground" : "text-foreground/85 hover:bg-muted",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </>
  );
}

function MobileHeader() {
  const { user } = useAuth();
  const { open: openPalette } = useCommandPalette();
  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase() || "S";
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
      <Brand />
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Search" onClick={openPalette}>
          <Search className="h-4 w-4" aria-hidden />
        </Button>
        <NotificationBell />
        <ThemeModeToggle compact />
        {user && (
          <Link href="/settings" aria-label="Profile settings" className="rounded-full">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </Link>
        )}
      </div>
    </header>
  );
}

function DesktopTopBar() {
  const { open: openPalette } = useCommandPalette();
  // SSR renders before `navigator` exists, so the shortcut label flips after
  // mount instead of guessing during hydration.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  }, []);
  return (
    <header className="sticky top-0 z-20 hidden h-14 shrink-0 items-center justify-end gap-2 border-b border-border bg-background/90 px-6 backdrop-blur lg:flex">
      <Button
        variant="outline"
        size="sm"
        onClick={openPalette}
        aria-label="Search and quick actions"
        className="h-8 gap-2 px-2.5 text-muted-foreground"
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
        <span>Search</span>
        <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] font-medium">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </Button>
      <NotificationBell />
      <ThemeModeToggle compact />
    </header>
  );
}

/**
 * Creates any due reminders once per browser session after sign-in, so the
 * bell and dashboard are populated on the first screen the user lands on.
 */
function NotificationBootstrap() {
  const { status } = useAuth();
  const generate = useGenerateNotifications();
  const started = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || started.current) return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem("notifications:generated") === "1") return;

    started.current = true;
    window.sessionStorage.setItem("notifications:generated", "1");
    generate.mutate();
  }, [status, generate]);

  return null;
}

export function AppShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const workspace = isWorkspaceRoute(pathname ?? "");

  return (
    <CommandPaletteProvider pages={NAV_ITEMS}>
      <div className={cn(workspace ? "h-dvh overflow-hidden" : "min-h-dvh")}>
        {/* 14 persistent nav links sit before <main>, so every page needed this. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-pop"
        >
          Skip to content
        </a>
        <Sidebar />
        <MobileNav />
        <div className={cn("lg:pl-sidebar", workspace && "flex h-full min-h-0 flex-col overflow-hidden")}>
          <DesktopTopBar />
          <MobileHeader />
          <NotificationBootstrap />
          <main
            id="main-content"
            tabIndex={-1}
            // Two mutually exclusive strings rather than one list of overrides:
            // `max-w-content` and `max-w-none` belong to the same Tailwind scale,
            // and `cn` does not collapse an unknown value against a known one —
            // both would reach the DOM and the stylesheet's own ordering would
            // decide the winner. Stating a variant (`lg:py-0`) in an override
            // list has the same problem for a different reason.
            className={cn(
              workspace
                ? "mx-0 flex min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden px-0 py-0 focus:outline-none lg:py-0"
                : "mx-auto w-full max-w-content px-[var(--page-pad)] py-6 focus:outline-none lg:py-8",
              className,
            )}
          >
            {children}
          </main>
          {/* Bottom padding so mobile bottom-nav never covers content. */}
          <div className={cn("h-16 lg:hidden", workspace && "shrink-0")} aria-hidden />
        </div>
      </div>
    </CommandPaletteProvider>
  );
}