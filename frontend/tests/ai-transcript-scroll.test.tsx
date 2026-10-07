import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MessageList } from "@/components/domain/ai-chat";
import type { AiMessage } from "@/types/api-types";

/**
 * The transcript's scrolling is the part of the chat nobody can work around: if
 * it does not follow the bottom, a reply arrives off-screen; if it follows too
 * eagerly, re-reading an earlier message is impossible.
 *
 * jsdom performs no layout, so `scrollHeight` and `clientHeight` are always 0
 * and assigning `scrollTop` goes nowhere. These tests therefore install a small
 * fake viewport on `Element.prototype` — a real scroll position that clamps
 * like a browser's — because otherwise "did it follow?" has nothing to observe.
 */

const VIEWPORT_HEIGHT = 400;
const CONTENT_HEIGHT = 1000;

function message(id: string, content = `message ${id}`): AiMessage {
  return {
    id,
    conversationId: "conversation-1",
    role: "ASSISTANT",
    content,
    createdAt: "2026-09-30T08:00:00.000Z",
  };
}

const BASE_PROPS = {
  isLoading: false,
  isError: false,
  error: null,
  onRetryLoad: () => {},
  generating: false,
  liveActivity: [],
  activityRun: null,
  onRetryMessage: () => {},
  empty: <p>empty here</p>,
};

interface FakeViewport {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

let viewport: FakeViewport;
let restore: () => void;

/** A `ResizeObserver` whose callback a test can fire on demand. */
class ControllableResizeObserver {
  static instances: ControllableResizeObserver[] = [];

  private readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    ControllableResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  /** Stands in for the browser noticing the content box changed size. */
  trigger() {
    this.callback();
  }
}

function installFakeViewport() {
  viewport = { scrollHeight: CONTENT_HEIGHT, clientHeight: VIEWPORT_HEIGHT, scrollTop: 0 };

  const originals = (["scrollHeight", "clientHeight", "scrollTop"] as const).map((name) => [
    name,
    Object.getOwnPropertyDescriptor(Element.prototype, name),
  ] as const);

  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get: () => viewport.scrollHeight,
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get: () => viewport.clientHeight,
  });
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get: () => viewport.scrollTop,
    // Browsers clamp to the scrollable range; without this the fake would let
    // the transcript "scroll" past the end and the assertions would mean nothing.
    set: (value: number) => {
      const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      viewport.scrollTop = Math.min(Math.max(Number(value), 0), max);
    },
  });

  restore = () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
      else Reflect.deleteProperty(Element.prototype, name);
    }
  };
}

/** The transcript is parked at the newest content. */
function expectAtBottom() {
  expect(viewport.scrollTop).toBe(viewport.scrollHeight - viewport.clientHeight);
}

function transcript() {
  return screen.getByTestId("transcript");
}

function jumpToLatest() {
  return screen.queryByRole("button", { name: /jump to latest/i });
}

beforeEach(() => {
  installFakeViewport();
  ControllableResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", ControllableResizeObserver);
});

afterEach(() => {
  restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("transcript scrolling", () => {
  it("opens a conversation at its latest message", () => {
    render(
      <MessageList
        {...BASE_PROPS}
        conversationId="conversation-1"
        messages={[message("m1"), message("m2")]}
      />,
    );

    expectAtBottom();
  });

  it("offers no jump control while the student is already at the bottom", () => {
    render(
      <MessageList {...BASE_PROPS} conversationId="c1" messages={[message("m1"), message("m2")]} />,
    );

    expect(jumpToLatest()).not.toBeInTheDocument();
  });

  it("keeps following new messages while the student is at the bottom", () => {
    const { rerender } = render(
      <MessageList {...BASE_PROPS} conversationId="c1" messages={[message("m1")]} />,
    );
    expectAtBottom();

    viewport.scrollHeight = 1400;
    rerender(
      <MessageList
        {...BASE_PROPS}
        conversationId="c1"
        messages={[message("m1"), message("m2")]}
      />,
    );

    expectAtBottom();
  });

  it("stops following and offers a way back once the student scrolls up", async () => {
    const { rerender } = render(
      <MessageList
        {...BASE_PROPS}
        conversationId="c1"
        messages={[message("m1"), message("m2")]}
      />,
    );

    viewport.scrollTop = 0;
    fireEvent.scroll(transcript());

    expect(jumpToLatest()).toBeInTheDocument();

    // A reply landing now must not move the transcript out from under them.
    viewport.scrollHeight = 1600;
    rerender(
      <MessageList
        {...BASE_PROPS}
        conversationId="c1"
        messages={[message("m1"), message("m2"), message("m3")]}
      />,
    );

    expect(viewport.scrollTop).toBe(0);
    expect(jumpToLatest()).toBeInTheDocument();
  });

  it("returns to the bottom from the jump control and follows again afterwards", async () => {
    const { rerender } = render(
      <MessageList
        {...BASE_PROPS}
        conversationId="c1"
        messages={[message("m1"), message("m2")]}
      />,
    );

    viewport.scrollTop = 0;
    fireEvent.scroll(transcript());
    await userEvent.click(jumpToLatest()!);

    expectAtBottom();
    expect(jumpToLatest()).not.toBeInTheDocument();

    viewport.scrollHeight = 2000;
    rerender(
      <MessageList
        {...BASE_PROPS}
        conversationId="c1"
        messages={[message("m1"), message("m2"), message("m3")]}
      />,
    );

    // Following was genuinely restored, not just the scroll position.
    expectAtBottom();
  });

  it("opens the next conversation at the bottom even when it has the same number of messages", () => {
    // Two conversations with two messages each: keying the reset on the message
    // count would leave the second one exactly where the first was left.
    const { rerender } = render(
      <MessageList
        {...BASE_PROPS}
        conversationId="c1"
        messages={[message("a1"), message("a2")]}
      />,
    );

    viewport.scrollTop = 0;
    fireEvent.scroll(transcript());
    expect(jumpToLatest()).toBeInTheDocument();

    rerender(
      <MessageList
        {...BASE_PROPS}
        conversationId="c2"
        messages={[message("b1"), message("b2")]}
      />,
    );

    expectAtBottom();
    expect(jumpToLatest()).not.toBeInTheDocument();
    expect(screen.getByText("message b2")).toBeInTheDocument();
  });

  it("keeps following content that grows without adding a message", () => {
    // Streaming text is the case no prop change announces: the reply's height
    // grows while the message count and every other input stay identical.
    render(
      <MessageList {...BASE_PROPS} conversationId="c1" messages={[message("m1")]} />,
    );
    expectAtBottom();

    viewport.scrollHeight = 2400;
    act(() => {
      ControllableResizeObserver.instances.at(-1)!.trigger();
    });

    expectAtBottom();
  });

  it("leaves the transcript alone when content grows while the student has scrolled up", () => {
    render(
      <MessageList {...BASE_PROPS} conversationId="c1" messages={[message("m1")]} />,
    );

    viewport.scrollTop = 0;
    fireEvent.scroll(transcript());

    viewport.scrollHeight = 2400;
    act(() => {
      ControllableResizeObserver.instances.at(-1)!.trigger();
    });

    expect(viewport.scrollTop).toBe(0);
  });

  it("lands on the latest message again when the transcript is remounted", () => {
    // A fresh transcript has no scroll position of its own, so mounting it has
    // to resolve the way opening a conversation does — bottom, following — and
    // not like a transcript the student deliberately scrolled away from. This is
    // the path a remount takes: returning to the workspace, or the panel's
    // contents being rebuilt, with nothing to carry an offset across.
    const { unmount } = render(
      <MessageList {...BASE_PROPS} conversationId="c1" messages={[message("m1"), message("m2")]} />,
    );

    expectAtBottom();
    expect(jumpToLatest()).not.toBeInTheDocument();

    unmount();
    render(
      <MessageList {...BASE_PROPS} conversationId="c1" messages={[message("m1"), message("m2")]} />,
    );

    expectAtBottom();
    expect(jumpToLatest()).not.toBeInTheDocument();
  });

  it("scopes every scroll to its own container", async () => {
    // `scrollIntoView` walks up to the nearest scrollable ancestor, which in a
    // workspace whose page is deliberately not scrollable means dragging the
    // whole document. Nothing in the transcript may call it.
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      const { rerender } = render(
        <MessageList
          {...BASE_PROPS}
          conversationId="c1"
          messages={[message("m1"), message("m2")]}
        />,
      );

      viewport.scrollHeight = 1800;
      rerender(
        <MessageList
          {...BASE_PROPS}
          conversationId="c1"
          messages={[message("m1"), message("m2"), message("m3")]}
        />,
      );

      viewport.scrollTop = 0;
      fireEvent.scroll(transcript());
      await userEvent.click(jumpToLatest()!);

      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("is reachable and described for assistive technology", () => {
    render(
      <MessageList {...BASE_PROPS} conversationId="c1" messages={[message("m1")]} />,
    );

    // A scrollable region has to be focusable and named, or keyboard and screen
    // reader users have no way to reach the conversation.
    expect(transcript()).toHaveAttribute("role", "log");
    expect(transcript()).toHaveAccessibleName("Conversation messages");
    expect(transcript()).toHaveAttribute("tabindex", "0");
  });
});