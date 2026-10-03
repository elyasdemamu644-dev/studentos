import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps, type ReactElement } from "react";

import { AgentRunReport } from "@/components/domain/agent-run-report";
import { AiConversationSidebar, AiConversationDrawer } from "@/components/domain/ai-conversation-sidebar";
import {
  ChatComposer,
  ChatEmptyState,
  GeneratingIndicator,
  MessageError,
  MessageList,
} from "@/components/domain/ai-chat";
import { messagesKey, useLastAgentRun, useSendMessage } from "@/features/ai/hooks";
import { setTokens } from "@/lib/api/auth-session";
import type { AiAgentRun, AiMessage, Conversation } from "@/types/api-types";

/**
 * The regression this file exists for: the student's message used to vanish
 * between pressing Enter and the reply arriving, because the cached transcript
 * was only patched in the mutation's `onSuccess`. These tests drive the real
 * hook and the real components against a stubbed transport.
 */

const CONVERSATION: Conversation = {
  id: "conversation-1",
  title: "New conversation",
  type: "CHAT",
  createdAt: "2026-09-30T08:00:00.000Z",
  updatedAt: "2026-09-30T08:00:00.000Z",
  preview: null,
};

function message(overrides: Partial<AiMessage> = {}): AiMessage {
  return {
    id: "message-1",
    conversationId: CONVERSATION.id,
    role: "ASSISTANT",
    content: "Here is your plan.",
    createdAt: "2026-09-30T08:00:00.000Z",
    ...overrides,
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderWithQuery(node: ReactElement, client: QueryClient = makeClient()) {
  return {
    client,
    ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>),
  };
}

/** Resolves only when the test says so, so the in-flight window is observable. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A fetch stand-in carrying just the envelope fields the api client reads. */
function stubResponse(data: unknown, status = 201) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as unknown as Response;
}

// ── The run report ─────────────

describe("agent run report", () => {
  const base: AiAgentRun = {
    provider: "openai",
    model: "gpt-4o-mini",
    usedTools: true,
    toolSupport: true,
    finish: "answered",
    rounds: 2,
  };

  it("says which provider and model answered, once expanded", async () => {
    render(<AgentRunReport run={base} />);

    // The collapsed row is the outcome, not a wall of telemetry.
    expect(screen.getByRole("button", { expanded: false })).toHaveTextContent("Answered");

    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    // Also shown in the collapsed row, hence `getAllByText`.
    expect(screen.getAllByText("gpt-4o-mini").length).toBeGreaterThan(0);
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });

  it("states plainly when the provider has no tool calling", async () => {
    render(
      <AgentRunReport
        run={{ ...base, toolSupport: false, usedTools: false, finish: "no_tool_support" }}
      />,
    );

    expect(screen.getByRole("button", { expanded: false })).toHaveTextContent(
      "No tool calling on this provider",
    );

    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(
      screen.getByText(/could not read or change your data/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not support tool calling/i)).toBeInTheDocument();
  });

  it("flags a turn that ran out of tool calls", async () => {
    render(<AgentRunReport run={{ ...base, finish: "tool_limit", rounds: 5 }} />);

    expect(screen.getByRole("button", { expanded: false })).toHaveTextContent(
      "Hit the tool limit",
    );
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/may have stopped before finishing/i)).toBeInTheDocument();
  });

  it("tells the user a prepared change is still waiting on them", async () => {
    render(<AgentRunReport run={{ ...base, finish: "confirmation_pending" }} />);

    expect(screen.getByRole("button", { expanded: false })).toHaveTextContent("Waiting for you");
  });
});

// ── The optimistic message flow ─────────────

const QUESTION = "Prepare me for my Database exam.";

function SendProbe({ onSettled }: { onSettled: (error: unknown) => void }) {
  const send = useSendMessage();

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void send
            .mutateAsync({ conversationId: CONVERSATION.id, content: QUESTION })
            .then(() => onSettled(null))
            .catch((error: unknown) => onSettled(error));
        }}
      >
        send
      </button>
      <span data-testid="status">{send.isPending ? "pending" : "idle"}</span>
    </div>
  );
}

/** Seeds a transcript so a retry has a failed message to reuse. */
function RetryProbe({ retryOf }: { retryOf: string }) {
  const send = useSendMessage();

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void send
            .mutateAsync({ conversationId: CONVERSATION.id, content: QUESTION, retryOf })
            .catch(() => {});
        }}
      >
        retry
      </button>
      <span data-testid="status">{send.isPending ? "pending" : "idle"}</span>
    </div>
  );
}

/** Reads the run telemetry the mutation recorded for a conversation. */
function RunProbe({ conversationId }: { conversationId: string }) {
  const run = useLastAgentRun(conversationId);
  return <span data-testid="run">{run.data ? JSON.stringify(run.data) : "none"}</span>;
}

describe("sending a message", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    setTokens("test-access-token", "test-refresh-token");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const replyBody = stubResponse({
    success: true,
    data: {
      message: {
        id: "stored-user",
        conversationId: CONVERSATION.id,
        role: "USER",
        content: QUESTION,
        createdAt: "2026-09-30T08:00:01.000Z",
      },
      reply: {
        id: "stored-reply",
        conversationId: CONVERSATION.id,
        role: "ASSISTANT",
        content: "Three revision sessions.",
        createdAt: "2026-09-30T08:00:02.000Z",
      },
      toolActivity: [],
      pendingAction: null,
    },
  });

  /**
   * `AiAgentRun` is the only honest source for "what did the assistant
   * actually do", so the mutation has to keep it. These cover that the run
   * survives into the cache, and that its `finish` reason — the thing that
   * tells the user the assistant could not do something — is not lost.
   */
  const runBody = (agent: AiAgentRun | null) =>
    stubResponse({
      success: true,
      data: {
        message: {
          id: "stored-user",
          conversationId: CONVERSATION.id,
          role: "USER",
          content: QUESTION,
          createdAt: "2026-09-30T08:00:01.000Z",
        },
        reply: {
          id: "stored-reply",
          conversationId: CONVERSATION.id,
          role: "ASSISTANT",
          content: "Three revision sessions.",
          createdAt: "2026-09-30T08:00:02.000Z",
        },
        toolActivity: [],
        pendingAction: null,
        agent,
      },
    });

  const answeredRun: AiAgentRun = {
    provider: "openai",
    model: "gpt-4o-mini",
    usedTools: true,
    toolSupport: true,
    finish: "answered",
    rounds: 2,
  };

  it("records the agent run the API reported", async () => {
    fetchMock.mockReturnValue(runBody(answeredRun));

    const { client } = renderWithQuery(
      <>
        <SendProbe onSettled={() => {}} />
        <RunProbe conversationId={CONVERSATION.id} />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => {
      expect(client.getQueryData<AiAgentRun>(["ai", "agent-runs", CONVERSATION.id])).toEqual(
        answeredRun,
      );
    });
    expect(screen.getByTestId("run")).toHaveTextContent('"finish":"answered"');
  });

  it.each([["no_tool_support"], ["tool_limit"]] as const)(
    "keeps a %s turn distinguishable from a normal one",
    async (finish) => {
    fetchMock.mockReturnValue(
      runBody({
        ...answeredRun,
        finish,
        toolSupport: finish !== "no_tool_support",
        usedTools: finish !== "no_tool_support",
      }),
    );

    renderWithQuery(
      <>
        <SendProbe onSettled={() => {}} />
        <RunProbe conversationId={CONVERSATION.id} />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => {
      expect(screen.getByTestId("run")).toHaveTextContent(`"finish":"${finish}"`);
    });
  },
  );

  it("reports no run when the API returned none", async () => {
    fetchMock.mockReturnValue(runBody(null));

    renderWithQuery(
      <>
        <SendProbe onSettled={() => {}} />
        <RunProbe conversationId={CONVERSATION.id} />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });
    // Nothing is invented for a turn the server did not describe.
    expect(screen.getByTestId("run")).toHaveTextContent("none");
  });

  it("puts the user's message in the transcript before the request resolves", async () => {
    const inFlight = deferred<Response>();
    fetchMock.mockReturnValue(inFlight.promise);

    const { client } = renderWithQuery(<SendProbe onSettled={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("pending");
    });

    const cached = client.getQueryData<AiMessage[]>(messagesKey(CONVERSATION.id));
    // The whole point: the message is in the transcript while the request is
    // still open, not only once the reply arrives.
    expect(cached).toHaveLength(1);
    expect(cached?.[0]).toMatchObject({ role: "USER", content: QUESTION, optimistic: true });

    inFlight.resolve(replyBody);
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });
  });

  it("replaces the optimistic copy with the stored message and the reply", async () => {
    fetchMock.mockResolvedValue(replyBody);

    const { client } = renderWithQuery(<SendProbe onSettled={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });

    const cached = client.getQueryData<AiMessage[]>(messagesKey(CONVERSATION.id));
    expect(cached?.map((item) => item.id)).toEqual(["stored-user", "stored-reply"]);
    expect(cached?.every((item) => item.optimistic !== true)).toBe(true);
  });

  it("keeps the message on screen and marks it failed when generation errors", async () => {
    fetchMock.mockResolvedValue(
      stubResponse(
        { success: false, error: { code: "AI_PROVIDER_ERROR", message: "The provider is unavailable" } },
        502,
      ),
    );

    const settled: unknown[] = [];
    const { client } = renderWithQuery(
      <SendProbe onSettled={(error) => settled.push(error)} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });

    expect(settled).toHaveLength(1);
    const cached = client.getQueryData<AiMessage[]>(messagesKey(CONVERSATION.id));
    // Never silently removed: the student can see what failed and retry it.
    expect(cached).toHaveLength(1);
    expect(cached?.[0]).toMatchObject({ content: QUESTION, failed: true });
  });

  it("reuses the failed message's slot on retry instead of duplicating it", async () => {
    fetchMock.mockResolvedValue(replyBody);

    const client = makeClient();
    // The state a failed send leaves behind.
    client.setQueryData<AiMessage[]>(messagesKey(CONVERSATION.id), [
      message({
        id: "failed-1",
        role: "USER",
        content: QUESTION,
        createdAt: "2026-09-30T08:00:00.000Z",
        failed: true,
      }),
    ]);

    renderWithQuery(<RetryProbe retryOf="failed-1" />, client);
    await userEvent.click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });

    // The bug this pins: a retry used to POST the text as a new message while the
    // failed bubble stayed on screen, so the student saw their question twice.
    const cached = client.getQueryData<AiMessage[]>(messagesKey(CONVERSATION.id));
    expect(cached?.filter((item) => item.role === "USER")).toHaveLength(1);
    expect(cached?.map((item) => item.id)).toEqual(["stored-user", "stored-reply"]);
  });

  it("marks the retried message failed again if the retry also fails", async () => {
    fetchMock.mockResolvedValue(
      stubResponse(
        { success: false, error: { code: "AI_PROVIDER_ERROR", message: "The provider is unavailable" } },
        502,
      ),
    );

    const client = makeClient();
    client.setQueryData<AiMessage[]>(messagesKey(CONVERSATION.id), [
      message({
        id: "failed-1",
        role: "USER",
        content: QUESTION,
        createdAt: "2026-09-30T08:00:00.000Z",
        failed: true,
      }),
    ]);

    renderWithQuery(<RetryProbe retryOf="failed-1" />, client);
    await userEvent.click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() => {
      const cached = client.getQueryData<AiMessage[]>(messagesKey(CONVERSATION.id));
      expect(cached).toHaveLength(1);
      expect(cached?.[0]).toMatchObject({ id: "failed-1", failed: true, optimistic: false });
    });
  });

  it("appends when the retried message is no longer in the transcript", async () => {
    fetchMock.mockResolvedValue(replyBody);

    const client = makeClient();
    // Nothing cached under that id — the refetch dropped it.
    renderWithQuery(<RetryProbe retryOf="vanished" />, client);
    await userEvent.click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });

    const cached = client.getQueryData<AiMessage[]>(messagesKey(CONVERSATION.id));
    expect(cached?.map((item) => item.id)).toEqual(["stored-user", "stored-reply"]);
  });
});

// ── The presentational pieces ───────────────

describe("generation state", () => {
  it("says it is generating without inventing tool activity", () => {
    render(<GeneratingIndicator activity={[]} />);
    expect(screen.getByText(/StudentOS AI is generating/i)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Assistant activity" })).not.toBeInTheDocument();
  });

  it("shows only the tool events the backend actually returned", () => {
    render(
      <GeneratingIndicator
        activity={[{ tool: "read_courses", label: "Reviewed your courses", status: "success", summary: "6 courses" }]}
      />,
    );
    const feed = screen.getByRole("list", { name: "Assistant activity" });
    expect(within(feed).getByText(/Reviewed your courses/)).toBeInTheDocument();
  });
});

describe("generation errors", () => {
  it("reports the failure and offers a retry", async () => {
    const onRetry = vi.fn();
    render(
      <MessageError
        error={{ code: "AI_PROVIDER_ERROR", message: "The provider is unavailable" }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/Something went wrong while generating/i);
    expect(screen.getByText("The provider is unavailable")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("has a neutral fallback when the failure carries no message", () => {
    render(<MessageError error={undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Something went wrong/i);
  });
});

describe("empty state", () => {
  it("sends the suggestion's real prompt rather than a decorative no-op", async () => {
    const onPrompt = vi.fn();
    render(<ChatEmptyState onPrompt={onPrompt} busy={false} />);

    await userEvent.click(screen.getByRole("button", { name: /Prepare for an exam/i }));
    expect(onPrompt).toHaveBeenCalledWith("Prepare me for my next exam.");
  });

  it("disables every suggestion while a generation is running", () => {
    render(<ChatEmptyState onPrompt={() => {}} busy />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});

describe("composer", () => {
  function Harness({ onSend, busy = false }: { onSend: () => void; busy?: boolean }) {
    const [draft, setDraft] = useState("");
    return (
      <ChatComposer
        draft={draft}
        onDraftChange={setDraft}
        onSend={onSend}
        onStop={() => {}}
        busy={busy}
        placeholder="Ask…"
      />
    );
  }

  it("sends on Enter", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const input = screen.getByLabelText("Message StudentOS AI");

    await userEvent.type(input, "hello{Enter}");
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("does not send on Shift+Enter", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const input = screen.getByLabelText("Message StudentOS AI");

    await userEvent.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");
  });

  it("keeps send disabled for an empty draft", () => {
    render(<Harness onSend={() => {}} />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("offers stop instead of send while generating", async () => {
    render(<Harness onSend={() => {}} busy />);
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
  });
});

describe("transcript", () => {
  it("shows the empty state only when there is nothing to show", () => {
    const { rerender } = render(
      <MessageList
        messages={[]}
        isLoading={false}
        isError={false}
        error={null}
        onRetryLoad={() => {}}
        generating={false}
        liveActivity={[]}
        activityRun={null}
        onRetryMessage={() => {}}
        empty={<p>empty here</p>}
      />,
    );
    expect(screen.getByText("empty here")).toBeInTheDocument();

    rerender(
      <MessageList
        messages={[message({ id: "m1", content: "Answered" })]}
        isLoading={false}
        isError={false}
        error={null}
        onRetryLoad={() => {}}
        generating={false}
        liveActivity={[]}
        activityRun={null}
        onRetryMessage={() => {}}
        empty={<p>empty here</p>}
      />,
    );
    expect(screen.queryByText("empty here")).not.toBeInTheDocument();
    expect(screen.getByText("Answered")).toBeInTheDocument();
  });

  it("renders an assistant reply as markdown rather than raw text", () => {
    render(
      <MessageList
        messages={[message({ content: "**Due Friday**\n\n- Read notes\n- Past paper" })]}
        isLoading={false}
        isError={false}
        error={null}
        onRetryLoad={() => {}}
        generating={false}
        liveActivity={[]}
        activityRun={null}
        onRetryMessage={() => {}}
        empty={<p>empty</p>}
      />,
    );

    // Bold is an element, not literal asterisks in the text.
    expect(screen.getByText("Due Friday").closest("strong")).not.toBeNull();
    expect(screen.queryByText(/\*\*Due Friday\*\*/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Read notes",
      "Past paper",
    ]);
  });

  it("attaches tool activity to the reply that produced it", () => {
    render(
      <MessageList
        messages={[message({ id: "reply-1" })]}
        isLoading={false}
        isError={false}
        error={null}
        onRetryLoad={() => {}}
        generating={false}
        liveActivity={[]}
        activityRun={{
          replyId: "reply-1",
          activity: [{ tool: "list_tasks", label: "Checked your tasks", status: "success", summary: "4 open" }],
        }}
        onRetryMessage={() => {}}
        empty={<p>empty</p>}
      />,
    );
    expect(screen.getByRole("list", { name: "Assistant activity" })).toHaveTextContent(
      "Checked your tasks",
    );
  });

  it("offers a retry on a failed message without removing it", async () => {
    const onRetryMessage = vi.fn();
    render(
      <MessageList
        messages={[message({ id: "m1", role: "USER", content: "Ask me anything", failed: true })]}
        isLoading={false}
        isError={false}
        error={null}
        onRetryLoad={() => {}}
        generating={false}
        liveActivity={[]}
        activityRun={null}
        onRetryMessage={onRetryMessage}
        empty={<p>empty</p>}
      />,
    );

    expect(screen.getByText("Ask me anything")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetryMessage).toHaveBeenCalledWith(expect.objectContaining({ content: "Ask me anything" }));
  });
});

// ── Sidebar ─────────────────────────────────

describe("conversation history", () => {
  function conversations(overrides: Partial<Conversation>[] = []): Conversation[] {
    return [
      { ...CONVERSATION, id: "today", updatedAt: new Date().toISOString(), ...(overrides[0] ?? {}) },
      {
        ...CONVERSATION,
        id: "older",
        title: "Academic progress",
        updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
        preview: { content: "Your average is up 4%.", role: "ASSISTANT", createdAt: "2026-09-10T08:00:00.000Z" },
        ...(overrides[1] ?? {}),
      },
    ];
  }

  function renderSidebar(extra: Partial<ComponentProps<typeof AiConversationSidebar>> = {}) {
    const props: ComponentProps<typeof AiConversationSidebar> = {
      conversations: conversations(),
      isPending: false,
      isError: false,
      error: null,
      onRetry: () => {},
      selectedId: "today",
      onSelect: () => {},
      onDelete: () => {},
      onRename: () => {},
      onNewChat: () => {},
      ...extra,
    };
    render(<AiConversationSidebar {...props} />);
    return props;
  }

  it("groups conversations by recency", () => {
    renderSidebar();
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Older" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Yesterday" })).not.toBeInTheDocument();
  });

  it("shows a meaningful title and the newest message as a preview", () => {
    renderSidebar();
    expect(screen.getByText("Academic progress")).toBeInTheDocument();
    expect(screen.getByText("Your average is up 4%.")).toBeInTheDocument();
  });

  it("prefers a locally derived title over the generic stored one", () => {
    renderSidebar({ derivedTitles: { today: "Database exam preparation" } });
    expect(screen.getByText("Database exam preparation")).toBeInTheDocument();
    expect(screen.getByText("Academic progress")).toBeInTheDocument();
  });

  it("marks the active conversation", () => {
    const { container } = render(
      <AiConversationSidebar
        conversations={conversations()}
        isPending={false}
        isError={false}
        error={null}
        onRetry={() => {}}
        selectedId="older"
        onSelect={() => {}}
        onDelete={() => {}}
        onRename={() => {}}
        onNewChat={() => {}}
      />,
    );

    const active = container.querySelector('[aria-current="true"]');
    expect(active?.textContent).toContain("Academic progress");
  });

  it("reports a rename instead of mutating the row silently", async () => {
    const onRename = vi.fn();
    renderSidebar({ onRename });

    await userEvent.click(screen.getByRole("button", { name: "Rename Academic progress" }));
    const input = screen.getByLabelText("Conversation title");
    await userEvent.clear(input);
    await userEvent.type(input, "GPA review{Enter}");

    expect(onRename).toHaveBeenCalledWith("older", "GPA review");
  });

  it("creates a new chat from the sidebar", async () => {
    const onNewChat = vi.fn();
    renderSidebar({ onNewChat });
    await userEvent.click(screen.getByRole("button", { name: /new chat/i }));
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it("offers the history in a drawer below the desktop breakpoint", async () => {
    const onSelect = vi.fn();
    render(
      <AiConversationDrawer
        conversations={conversations()}
        isPending={false}
        isError={false}
        error={null}
        onRetry={() => {}}
        selectedId={null}
        onSelect={onSelect}
        onDelete={() => {}}
        onRename={() => {}}
        onNewChat={() => {}}
      />,
    );

    // Closed by default: the chat keeps the full width.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Choosing a conversation closes the drawer behind it.
    await userEvent.click(screen.getByText("Academic progress"));
    expect(onSelect).toHaveBeenCalledWith("older");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ── The brand-new account path ─────────────
// A fresh account has zero conversations, so the first prompt must create one
// and then send into it instead of silently doing nothing.

describe("first prompt with no existing conversations", () => {
  const fetchMock = vi.fn();
  const NEW_ID = "conversation-new";
  const REPLY = "First response.";
  const sendReply = deferred<Response>();
  // What the server "has stored": the messages GET must agree with the POST
  // once it lands, or the post-send refetch would wipe the transcript.
  let serverMessages: unknown[] = [];

  function env(data: unknown, success = true, status = 200) {
    const json = success ? { success: true, data } : { success: false, error: { code: "ERROR", message: String(data) } };
    return { ok: success, status, json: async () => json } as unknown as Response;
  }

  const newConversation = {
    id: NEW_ID,
    title: "New conversation",
    type: "CHAT",
    createdAt: "2026-09-30T08:00:00.000Z",
    updatedAt: "2026-09-30T08:00:00.000Z",
    preview: null,
  };

  beforeEach(() => {
    serverMessages = [];
    setTokens("test-access-token", "test-refresh-token");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const base = "http://localhost:3001/api/v1";
      if (url === `${base}/ai/conversations?limit=100`) {
        return env({ items: [], hasMore: false, nextCursor: null });
      }
      if (url === `${base}/ai/conversations` && method === "POST") {
        return env(newConversation, true, 201);
      }
      if (url.includes(`/ai/conversations/${NEW_ID}/messages`)) {
        if (method === "POST") return sendReply.promise;
        return env(serverMessages);
      }
      if (url === `${base}/ai/conversations/${NEW_ID}` && method === "PATCH") {
        return env(newConversation);
      }
      throw new Error("no mock for " + method + " " + url);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("creates a conversation and sends the queued prompt from the empty state", async () => {
    const { default: AiPage } = await import("@/app/(dashboard)/ai/page");
    renderWithQuery(<AiPage />);

    // A fresh account lands on the empty state, not a dead composer.
    await waitFor(() => {
      expect(screen.getByText("What can StudentOS help you accomplish?")).toBeInTheDocument();
    });
    const suggestion = screen.getByRole("button", { name: /Prepare for an exam/i });
    await userEvent.click(suggestion);

    // The prompt created a conversation, put its user bubble on screen, and is
    // reporting generation in flight — all while the POST is still open.
    await waitFor(() => {
      expect(screen.getByText(/Prepare me for my next exam\./)).toBeInTheDocument();
      expect(screen.getByText("StudentOS AI is generating")).toBeInTheDocument();
    });

    sendReply.resolve(
      env(
        {
          message: {
            id: "stored-user",
            conversationId: NEW_ID,
            role: "USER",
            content: "Prepare me for my next exam.",
            createdAt: "2026-09-30T08:00:01.000Z",
          },
          reply: {
            id: "stored-reply",
            conversationId: NEW_ID,
            role: "ASSISTANT",
            content: REPLY,
            createdAt: "2026-09-30T08:00:02.000Z",
          },
          toolActivity: [],
          pendingAction: null,
        },
        true,
        201,
      ),
    );
    serverMessages.push(
      {
        id: "stored-user",
        conversationId: NEW_ID,
        role: "USER",
        content: "Prepare me for my next exam.",
        createdAt: "2026-09-30T08:00:01.000Z",
      },
      {
        id: "stored-reply",
        conversationId: NEW_ID,
        role: "ASSISTANT",
        content: REPLY,
        createdAt: "2026-09-30T08:00:02.000Z",
      },
    );

    await waitFor(() => {
      expect(screen.getByText(REPLY)).toBeInTheDocument();
      expect(screen.queryByText("StudentOS AI is generating")).not.toBeInTheDocument();
    });

    // Exactly one send happened: the queue drained once, not per re-render.
    const sends = fetchMock.mock.calls.filter(([input, init]) => {
      const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
      return method === "POST" && String(input).includes("/messages");
    });
    expect(sends).toHaveLength(1);
  });
});
