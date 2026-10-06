import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactElement } from "react";

import { AppShell, isWorkspaceRoute } from "@/components/layout/app-shell";
import { setTokens } from "@/lib/api/auth-session";
import type { Conversation, DashboardData } from "@/types/api-types";

/**
 * The AI workspace is a row of boxes, not a page. Three things about that are
 * easy to break and impossible to eyeball in a diff:
 *
 *   1. Each box owns exactly one collapse control, the one in its own header,
 *      and the box it controls has to be able to bring itself back. A control
 *      that lives elsewhere is a second source of truth, and a panel that
 *      animates to nothing takes its own control with it.
 *   2. Collapsing one box hands its width to the chat, in any combination of
 *      the three, without leaving a gap, an overlap or an unusable column.
 *   3. The shell has to hand the workspace the viewport. A workspace inside the
 *      default `<main>` gets `min-height` with no definite height, so every
 *      `h-full` and `min-h-0` in the chat resolves against nothing and the
 *      document becomes the scroller again.
 *
 * jsdom computes no layout, so these tests assert the mechanism that produces
 * the geometry — the width handoff, the definite height chain, what is left in
 * the accessibility tree — and leave the pixel result to a real browser.
 */

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/features/auth/auth-provider", () => ({
  useAuth: () => ({ user: null, status: "authenticated", logout: vi.fn() }),
}));
vi.mock("@/features/notifications/hooks", () => ({
  useGenerateNotifications: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/components/domain/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/theme-toggle", () => ({ ThemeModeToggle: () => null }));

const CONVERSATION: Conversation = {
  id: "conversation-1",
  title: "Database exam",
  type: "CHAT",
  createdAt: "2026-09-30T08:00:00.000Z",
  updatedAt: "2026-09-30T09:00:00.000Z",
  preview: null,
};

const DASHBOARD: DashboardData = {
  academicYears: [],
  currentAcademicYear: null,
  currentSemester: null,
  courses: { total: 3, active: 3, completed: 0, recent: [] },
  tasks: { total: 4, byStatus: {}, byPriority: {}, overdue: 2, dueToday: 0 },
  upcomingTasks: [],
  overdueTasks: [],
  exams: { upcoming: [], nextInDays: null },
  events: { today: [], upcoming: [] },
  studySessions: { todayMinutes: 45, todayCount: 1, weekMinutes: 200, recent: [] },
  activeGoals: [],
  recentNotes: [],
  recentGrades: [],
  resources: { total: 0 },
  notifications: { unreadCount: 3, recent: [] },
  activity: [],
};

function envelope(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ success: true, data }),
  } as unknown as Response;
}

/** Answers only the reads the workspace makes on first paint. */
function stubWorkspaceApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const base = "http://localhost:3001/api/v1";
    if (url.startsWith(`${base}/ai/conversations?`)) {
      return envelope({ items: [CONVERSATION], hasMore: false, nextCursor: null });
    }
    if (url.includes("/messages")) return envelope([]);
    if (url.includes("/pending-action")) return envelope(null);
    if (url === `${base}/dashboard`) return envelope(DASHBOARD);
    throw new Error(`no mock for ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderWithQuery(node: ReactElement) {
  return render(<QueryClientProvider client={makeClient()}>{node}</QueryClientProvider>);
}

let AiPage: ComponentType;

const history = () => screen.queryByRole("navigation", { name: "Conversation history" });
const context = () => screen.queryByRole("complementary", { name: "StudentOS context" });
const chat = () => screen.queryByRole("region", { name: "AI conversation" });
const composer = () => screen.queryByLabelText("Message StudentOS AI");

/**
 * The two collapsible panels, by the names their own collapse control answers
 * to. `Hide …` and `Show …` are the only two names any of them answers to.
 * The AI chat is absent on purpose: it is permanent and owns no control.
 */
const PANELS = [
  { name: "Chat History", hide: "Hide chat history", show: "Show chat history" },
  {
    name: "StudentOS Context",
    hide: "Hide StudentOS context",
    show: "Show StudentOS context",
  },
] as const;

/** Every control that could be a duplicate of a panel's own. */
function controlsFor(accessibleName: string) {
  return screen.queryAllByRole("button", { name: accessibleName });
}

/** The row of three boxes, i.e. the workspace's last child. */
function panelRow(container: HTMLElement) {
  const workspace = container.firstElementChild as HTMLElement;
  const row = workspace.lastElementChild as HTMLElement;
  return {
    workspace,
    row,
    panels: Array.from(row.children) as HTMLElement[],
  };
}

/** `className` matched by substring lies: "min-h-dvh" contains "h-dvh". */
function hasClass(node: Element, token: string) {
  return node.classList.contains(token);
}

beforeAll(async () => {
  ({ default: AiPage } = await import("@/app/(dashboard)/ai/page"));
});

describe("AI workspace panels", () => {
  beforeEach(() => {
    setTokens("test-access-token", "test-refresh-token");
    stubWorkspaceApi();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens with history, chat and context on screen at once", async () => {
    renderWithQuery(<AiPage />);

    expect(await screen.findByRole("navigation", { name: "Conversation history" })).toBeInTheDocument();
    expect(history()).toBeInTheDocument();
    expect(chat()).toBeInTheDocument();
    expect(context()).toBeInTheDocument();
    expect(composer()).toBeInTheDocument();
  });

  it("renders the three sections as separate boxes of one consistent kind", async () => {
    const { container } = renderWithQuery(<AiPage />);
    await screen.findByRole("navigation", { name: "Conversation history" });

    const { row, panels } = panelRow(container);

    // Three boxes on one row, in the order the product describes them. The chat
    // box is titled "AI Assistant": that is the label its top bar carries, now
    // that the workspace controls live in it instead of in a bar of their own.
    expect(panels).toHaveLength(3);
    expect(panels.map((panel) => panel.querySelector("h2")?.textContent)).toEqual([
      "Chat History",
      "AI Assistant",
      "StudentOS Context",
    ]);

    for (const panel of panels) {
      // One shared surface token, so no panel can drift into its own border,
      // radius or background.
      expect(hasClass(panel, "surface-panel")).toBe(true);
      // A box that could grow without bound would push the row off screen, and
      // one that could shrink without bound would crush its own content.
      expect(hasClass(panel, "min-h-0")).toBe(true);
      expect(hasClass(panel, "min-w-0")).toBe(true);
      // `clip`, not `hidden`: both hide the overflow, but `hidden` is still a
      // scroll container, and a scroll container can end up holding a non-zero
      // offset — which is how a restored panel shows its bottom with its header
      // scrolled out of view. `clip` creates no scroll container at all.
      expect(hasClass(panel, "overflow-clip")).toBe(true);
      expect(hasClass(panel, "overflow-hidden")).toBe(false);
    }

    // One gap token, so the row cannot read as three disconnected areas with a
    // chasm between them.
    expect(hasClass(row, "gap-3")).toBe(true);
    expect(hasClass(row, "min-h-0")).toBe(true);
    expect(hasClass(row, "min-w-0")).toBe(true);
  });

  it("gives each collapsible panel exactly one control, in its own header", async () => {
    renderWithQuery(<AiPage />);
    await screen.findByRole("navigation", { name: "Conversation history" });

    for (const panel of PANELS) {
      expect(controlsFor(panel.hide)).toHaveLength(1);
      expect(controlsFor(panel.show)).toHaveLength(0);

      // The one control belongs to the panel it controls: it sits in that
      // panel's header, not in the workspace toolbar or a sibling's.
      const control = controlsFor(panel.hide)[0];
      const box = control.closest("section")!;
      expect(box.querySelector("h2")?.textContent).toBe(panel.name);
      expect(control.closest("header")).not.toBeNull();
      expect(control).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("carries the workspace controls in the chat box's own top bar", async () => {
    const { container } = renderWithQuery(<AiPage />);
    await screen.findByRole("navigation", { name: "Conversation history" });

    const { workspace, panels } = panelRow(container);
    const chatHeader = panels[1].querySelector("header")!;

    // The controls used to sit in their own block above the row, which cost the
    // conversation a whole strip of height. The row is now the only thing in the
    // workspace — there is no block above it.
    expect(workspace.children).toHaveLength(1);
    expect(workspace.lastElementChild).not.toBeNull();
    expect(workspace.querySelectorAll(":scope > header")).toHaveLength(0);

    // All five survive, and every one of them is inside the chat's header.
    const headerText = chatHeader.textContent ?? "";
    expect(headerText).toContain("AI Assistant");
    for (const name of ["History", "Context", "New chat"]) {
      const control = within(chatHeader).getByRole("button", { name: new RegExp(name, "i") });
      expect(control).toBeInTheDocument();
    }
    expect(within(chatHeader).getByLabelText("Conversation type")).toBeInTheDocument();
  });

  it("gives the conversation header's height back to the transcript", async () => {
    const { container } = renderWithQuery(<AiPage />);
    await screen.findByRole("navigation", { name: "Conversation history" });

    const { panels } = panelRow(container);
    const conversation = panels[1].querySelector('section[aria-label="AI conversation"]')!;

    // The defect this pins: a header inside the chat repeated the conversation
    // title, its type blurb and the date it started — all of which the history
    // column already says — and charged the transcript a strip of height for it.
    expect(conversation.textContent).not.toMatch(/started\s/i);
    expect(conversation.textContent).not.toMatch(/General study questions/i);
    expect(screen.queryByRole("button", { name: "Delete conversation" })).not.toBeInTheDocument();

    // So the transcript is now the first thing in the box's body: nothing sits
    // between the panel header and the messages.
    const body = panels[1].querySelector("header")!.nextElementSibling!;
    expect(body.firstElementChild).toBe(conversation);
    expect(conversation.querySelector("header")).toBeNull();
    expect(conversation.firstElementChild?.contains(screen.getByRole("log"))).toBe(true);
  });

  it("keeps the AI chat permanent: no control, no collapsed state, dominant width", async () => {
    const { container } = renderWithQuery(<AiPage />);
    await screen.findByRole("navigation", { name: "Conversation history" });

    const { panels } = panelRow(container);
    const chatBox = panels[1];

    // The defect this pins: the chat had a minimize button of its own, which
    // made the one panel that cannot be restored look restorable.
    expect(controlsFor("Hide AI chat")).toHaveLength(0);
    expect(controlsFor("Show AI chat")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^\s*(Hide|Show) AI chat\s*$/i })).toBeNull();

    // Its header carries the workspace controls but no collapse control: the
    // header's only disclosure button belongs to a collapsible panel, and the
    // chat is not one.
    const header = chatBox.querySelector("header")!;
    expect(header).not.toBeNull();
    expect(header.querySelector("button[aria-controls]")).toBeNull();
    expect(header.querySelector('button[aria-label^="Hide"], button[aria-label^="Show"]')).toBeNull();

    // No collapsed state, and no rail: it keeps taking the leftover width.
    expect(chatBox.getAttribute("data-collapsed")).toBeNull();
    expect(hasClass(chatBox, "w-12")).toBe(false);
    expect(hasClass(chatBox, "flex-1")).toBe(true);

    // And collapsing both neighbours never touches it.
    await userEvent.click(screen.getByRole("button", { name: "Hide chat history" }));
    await userEvent.click(screen.getByRole("button", { name: "Hide StudentOS context" }));

    expect(chat()).toBeInTheDocument();
    expect(composer()).toBeInTheDocument();
    expect(controlsFor("Hide AI chat")).toHaveLength(0);
    expect(hasClass(chatBox, "flex-1")).toBe(true);
  });

  it("has exactly one StudentOS context control and no stray duplicate", async () => {
    const { container } = renderWithQuery(<AiPage />);
    await screen.findByRole("complementary", { name: "StudentOS context" });

    // The defect this pins: the context panel was disclosed by two controls, one
    // of them in the chat's toolbar, so no single button's state was the panel's
    // state and the two could disagree.
    expect(controlsFor("Hide StudentOS context")).toHaveLength(1);
    expect(controlsFor("Hide context panel")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /context panel/i })).not.toBeInTheDocument();

    // Three boxes, and only the two collapsible ones carry a disclosure control.
// Counted inside the panels, not across the workspace, because Radix's own
// Select trigger in the toolbar also sets `aria-controls`.
const { panels } = panelRow(container);
expect(panels.filter((box) => box.querySelector("button[aria-controls]"))).toHaveLength(2);
expect(panels[1].querySelector("button[aria-controls]")).toBeNull();
  });

  it("hands the chat the width when history collapses, leaving the others alone", async () => {
    renderWithQuery(<AiPage />);
    await screen.findByRole("navigation", { name: "Conversation history" });

    await userEvent.click(screen.getByRole("button", { name: "Hide chat history" }));

    // Gone from the document, so nothing is left focusable inside a panel that
    // no longer has room to show it.
    expect(history()).not.toBeInTheDocument();
    expect(context()).toBeInTheDocument();
    expect(chat()).toBeInTheDocument();
    expect(composer()).toBeInTheDocument();

    // And the panel that took the button is the one that can put it back.
    const show = screen.getByRole("button", { name: "Show chat history" });
    expect(show).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(show);

    expect(history()).toBeInTheDocument();
    expect(context()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide chat history" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps the header as the first child of a panel in both states", async () => {
    // The defect this pins: the header was only rendered when the panel was
    // expanded, so restoring a panel had to re-create its header. Wherever that
    // re-creation landed — or whatever scroll offset the box happened to be
    // left at — the header was not guaranteed to be at the top. Rendering it
    // unconditionally makes the position structural rather than incidental.
    const { container } = renderWithQuery(<AiPage />);
    await screen.findByRole("navigation", { name: "Conversation history" });

    const { panels } = panelRow(container);
    for (const index of [0, 2]) {
      const box = panels[index];

      // Expanded: header first, then the body it labels.
      expect(box.firstElementChild?.tagName).toBe("HEADER");
      expect(box.children).toHaveLength(2);

      const control = box.querySelector("header button")!;
      await userEvent.click(control);

      // Collapsed: the header is still the first child, and the control that
      // reopens the panel is still inside it — not appended below the rail.
      expect(box.firstElementChild?.tagName).toBe("HEADER");
      expect(box.querySelector("header")).toBe(box.firstElementChild);
      expect(box.querySelector("header button")).toBe(control);
      expect(box.children).toHaveLength(2);

      await userEvent.click(control);

      // Restored: top again, and the panel is a normal expanded box.
      expect(box.firstElementChild?.tagName).toBe("HEADER");
      expect(box.querySelector("header")).toBe(box.firstElementChild);
      expect(box.getAttribute("data-collapsed")).toBeNull();
      expect(box.children).toHaveLength(2);
    }
  });

  it("hands the chat the width when context collapses, leaving history alone", async () => {
    renderWithQuery(<AiPage />);
    await screen.findByRole("complementary", { name: "StudentOS context" });

    await userEvent.click(screen.getByRole("button", { name: "Hide StudentOS context" }));

    expect(context()).not.toBeInTheDocument();
    expect(history()).toBeInTheDocument();
    expect(chat()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show StudentOS context" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await userEvent.click(screen.getByRole("button", { name: "Show StudentOS context" }));

    expect(context()).toBeInTheDocument();
    expect(history()).toBeInTheDocument();
  });

  // All four combinations of the two collapsible panels, not just the default.
  // Each has to be reachable, and each has to be reversible from the same two
  // controls — while the chat stays open throughout, because it has no control.
  it.each([
    { history: true, context: true, name: "both expanded" },
    { history: false, context: true, name: "chat history collapsed" },
    { history: true, context: false, name: "StudentOS context collapsed" },
    { history: false, context: false, name: "both collapsed" },
  ])(
    "stays usable with $name",
    async ({ history: historyWanted, context: contextWanted }) => {
      const { container } = renderWithQuery(<AiPage />);
      await screen.findByRole("navigation", { name: "Conversation history" });

      const wanted = [historyWanted, contextWanted];

      for (let i = 0; i < PANELS.length; i += 1) {
        if (!wanted[i]) await userEvent.click(screen.getByRole("button", { name: PANELS[i].hide }));
      }

      // Three boxes either way — a rail is still a box.
      const { panels } = panelRow(container);
      expect(panels).toHaveLength(3);

      expect(Boolean(history())).toBe(historyWanted);
      expect(Boolean(context())).toBe(contextWanted);

      // The chat is untouched in every combination.
      expect(chat()).toBeInTheDocument();
      expect(composer()).toBeInTheDocument();
      expect(controlsFor("Hide AI chat")).toHaveLength(0);
      expect(controlsFor("Show AI chat")).toHaveLength(0);

      // Whatever the combination, each collapsible panel still has its own
      // single control, and a collapsed one is a narrow rail rather than either
      // gone or full width.
      for (let i = 0; i < PANELS.length; i += 1) {
        // `PANELS` skips the permanent chat, so index into the row by position.
        const box = panels[i === 0 ? 0 : 2];
        expect(controlsFor(wanted[i] ? PANELS[i].hide : PANELS[i].show)).toHaveLength(1);
        expect(box.getAttribute("data-collapsed")).toBe(wanted[i] ? null : "true");
        expect(hasClass(box, "w-12")).toBe(!wanted[i]);
        // And the header is still the first child of the box either way.
        expect(box.firstElementChild?.tagName).toBe("HEADER");
      }

      // And every combination has to be reversible from the same two controls.
      for (let i = 0; i < PANELS.length; i += 1) {
        if (!wanted[i]) await userEvent.click(screen.getByRole("button", { name: PANELS[i].show }));
      }

      expect(history()).toBeInTheDocument();
      expect(context()).toBeInTheDocument();
      expect(chat()).toBeInTheDocument();
      expect(composer()).toBeInTheDocument();
    },
  );

  it("gives each collapsed panel a rail and keeps the chat elastic", async () => {
    const { container } = renderWithQuery(<AiPage />);
    await screen.findByRole("navigation", { name: "Conversation history" });

    const { panels } = panelRow(container);
    const [historyBox, chatBox, contextBox] = panels;

    // The chat is the one that absorbs whatever the other two give up; the other
    // two are fixed supporting columns, not equal thirds.
    expect(hasClass(chatBox, "flex-1")).toBe(true);
    expect(hasClass(historyBox, "w-64")).toBe(true);
    expect(hasClass(contextBox, "w-72")).toBe(true);

    // The composer is the one part of the chat the student cannot work around,
    // so the column must not squeeze it.
    expect(composer()!.closest(".surface-blur")!.className).toContain("shrink-0");

    await userEvent.click(screen.getByRole("button", { name: "Hide chat history" }));
    await userEvent.click(screen.getByRole("button", { name: "Hide StudentOS context" }));

    // A rail, not zero: the panel keeps its header, so it keeps its control.
    expect(hasClass(historyBox, "w-12")).toBe(true);
    expect(hasClass(contextBox, "w-12")).toBe(true);
    expect(hasClass(chatBox, "flex-1")).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Show chat history" }));

    expect(hasClass(historyBox, "w-64")).toBe(true);
    expect(hasClass(contextBox, "w-12")).toBe(true);
  });

  it("keeps the drawer routes reachable for the widths with no room for a column", async () => {
    renderWithQuery(<AiPage />);
    await screen.findByRole("navigation", { name: "Conversation history" });

    // The History trigger is deliberately NOT width-gated. It used to carry
    // `lg:hidden`, which hid it exactly where the history column already existed,
    // so the control appeared at some widths and vanished at others. See
    // AiConversationDrawer: the drawer is now simply one more way in at every
    // width, which is what keeps the route reachable for everyone.
    const historyButton = screen.getByRole("button", { name: /^history/i });
    expect(historyButton.className).not.toContain("lg:hidden");

    const contextButton = screen.getByRole("button", { name: "Open StudentOS context" });
    expect(contextButton.className).toContain("min-[1360px]:hidden");

    await userEvent.click(contextButton);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("StudentOS Context")).toBeInTheDocument();

    await userEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // The unconditional trigger still has to open the drawer it promises.
    await userEvent.click(historyButton);
    const historyDrawer = await screen.findByRole("dialog");
    expect(within(historyDrawer).getByText("Conversations")).toBeInTheDocument();
    expect(within(historyDrawer).getByRole("navigation", { name: "Conversation history" })).toBeInTheDocument();

    await userEvent.click(within(historyDrawer).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("makes every scrollable region reachable from the keyboard", async () => {
    renderWithQuery(<AiPage />);
    await screen.findByRole("navigation", { name: "Conversation history" });

    // Each pane scrolls on its own, so each needs a focusable stop of its own.
    // Without these, keyboard users cannot reach overflowing content at all.
    for (const name of [
      "Conversation messages",
      "Conversation history list",
      "StudentOS context details",
    ]) {
      const region = await screen.findByRole(name === "Conversation messages" ? "log" : "region", {
        name,
      });
      expect(region).toHaveAttribute("tabindex", "0");
    }
  });
});

describe("app shell workspace routes", () => {
  afterEach(() => {
    nav.pathname = "/dashboard";
  });

  function renderShell() {
    return render(
      <AppShell>
        <p>page body</p>
      </AppShell>,
    );
  }

  it("leaves ordinary pages to scroll themselves", () => {
    renderShell();

    const main = screen.getByRole("main");
    expect(hasClass(main, "max-w-content")).toBe(true);
    expect(hasClass(main, "py-6")).toBe(true);
    expect(hasClass(main, "overflow-hidden")).toBe(false);

    // `className` cannot be matched by substring here: "min-h-dvh" contains
    // "h-dvh", which would make the workspace assertions pass by accident.
    const root = main.parentElement!.parentElement!;
    expect(hasClass(root, "min-h-dvh")).toBe(true);
    expect(hasClass(root, "h-dvh")).toBe(false);
  });

  it("hands the AI workspace a bounded viewport instead of the document", () => {
    nav.pathname = "/ai";
    renderShell();

    const main = screen.getByRole("main");

    // No content-width cap and no page padding: a reading column squeezed to
    // 62–80rem cannot hold three panes.
    expect(hasClass(main, "max-w-content")).toBe(false);
    expect(hasClass(main, "max-w-none")).toBe(true);
    expect(hasClass(main, "px-[var(--page-pad)]")).toBe(false);
    expect(hasClass(main, "py-6")).toBe(false);
    expect(hasClass(main, "py-0")).toBe(true);
    // The variant has to be restated, or `lg:py-8` re-pads the workspace on
    // exactly the desktop screens that use it.
    expect(hasClass(main, "lg:py-8")).toBe(false);
    expect(hasClass(main, "lg:py-0")).toBe(true);

    // A definite height plus `min-h-0` is what lets the workspace's own
    // percentage heights resolve instead of falling back to content height.
    expect(hasClass(main, "overflow-hidden")).toBe(true);
    expect(hasClass(main, "min-h-0")).toBe(true);
    expect(hasClass(main, "flex-1")).toBe(true);

    const column = main.parentElement!;
    expect(hasClass(column, "h-full")).toBe(true);
    expect(hasClass(column, "min-h-0")).toBe(true);
    expect(hasClass(column, "overflow-hidden")).toBe(true);

    const root = column.parentElement!;
    expect(hasClass(root, "h-dvh")).toBe(true);
    expect(hasClass(root, "overflow-hidden")).toBe(true);
    expect(hasClass(root, "min-h-dvh")).toBe(false);
  });

  it("recognises the workspace route and nothing else", () => {
    expect(isWorkspaceRoute("/ai")).toBe(true);
    expect(isWorkspaceRoute("/ai/something")).toBe(true);
    expect(isWorkspaceRoute("/dashboard")).toBe(false);
    expect(isWorkspaceRoute("/analytics")).toBe(false);
    expect(isWorkspaceRoute("/")).toBe(false);
  });
});