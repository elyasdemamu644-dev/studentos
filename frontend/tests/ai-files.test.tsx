import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AiFilesDrawer, AiFilesPanel } from "@/components/domain/ai-files-panel";
import { artifactsKey } from "@/features/ai/hooks";
import { setTokens } from "@/lib/api/auth-session";
import type { AiArtifact, AiMessage } from "@/types/api-types";

/**
 * The conversation Files surface folds two sources into one list: uploaded
 * attachments (carried by the messages) and generated artifacts (listed by the
 * artifacts endpoint). These tests pin the parts that are easy to get wrong —
 * telling the two apart, not double-counting a file, and fetching each kind's
 * bytes through its own authenticated endpoint.
 */

const CONVERSATION_ID = "conversation-1";
const OTHER_CONVERSATION_ID = "conversation-2";

const ARTIFACT: AiArtifact = {
  id: "artifact-1",
  conversationId: CONVERSATION_ID,
  messageId: "reply-1",
  resourceId: "resource-artifact",
  name: "Chapter 9 study guide",
  description: null,
  mimeType: "text/plain",
  size: 2048,
  createdAt: "2026-09-30T08:00:02.000Z",
};

function userMessage(overrides: Partial<AiMessage> = {}): AiMessage {
  return {
    id: "message-1",
    conversationId: CONVERSATION_ID,
    role: "USER",
    content: "Here is my lecture recording.",
    createdAt: "2026-09-30T08:00:01.000Z",
    attachments: [
      {
        id: "attachment-1",
        resourceId: "resource-upload",
        fileName: "lecture-recording.mp4",
        mimeType: "video/mp4",
        fileSize: 5 * 1024 * 1024,
        resourceType: "VIDEO",
      },
    ],
    ...overrides,
  };
}

function json(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ success: status < 300, data }),
  } as unknown as Response;
}

function fileResponse(blob: Blob, fileName?: string) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(
      fileName ? { "content-disposition": `attachment; filename="${fileName}"` } : {},
    ),
    blob: async () => blob,
  } as unknown as Response;
}

interface RouteOptions {
  messages?: unknown;
  artifacts?: unknown;
  messagesError?: boolean;
  artifactsError?: boolean;
}

function makeFetch(options: RouteOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/messages")) {
      if (options.messagesError) return json("boom", 500);
      return json(options.messages ?? []);
    }
    if (url.endsWith("/artifacts")) {
      if (options.artifactsError) return json("boom", 500);
      return json({ artifacts: options.artifacts ?? [] });
    }
    if (url.includes("/ai/artifacts/") && url.endsWith("/download")) {
      return fileResponse(new Blob(["generated"], { type: "text/plain" }), "study-guide.md");
    }
    if (url.includes("/resources/") && url.endsWith("/download")) {
      return fileResponse(new Blob(["uploaded"], { type: "video/mp4" }), "lecture-recording.mp4");
    }
    throw new Error(`no mock for ${url}`);
  });
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(node: React.ReactElement, client: QueryClient = makeClient()) {
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("conversation files panel", () => {
  beforeEach(() => {
    setTokens("test-access-token", "test-refresh-token");
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists uploaded attachments and generated artifacts, telling them apart", async () => {
    vi.stubGlobal("fetch", makeFetch({ messages: [userMessage()], artifacts: [ARTIFACT] }));

    renderWithQuery(
      <AiFilesPanel conversationId={CONVERSATION_ID} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    expect(await screen.findByText("lecture-recording.mp4")).toBeInTheDocument();
    expect(screen.getByText(/Uploaded file/)).toBeInTheDocument();
    expect(screen.getByText("Chapter 9 study guide")).toBeInTheDocument();
    expect(screen.getByText(/Generated file/)).toBeInTheDocument();
  });

  it("does not double-count an artifact that is also linked to a message", async () => {
    // The reply carries the artifact, and the conversation endpoint lists it
    // too. Reading `message.artifacts` would show it twice; the panel must not.
    const reply = userMessage({
      id: "reply-1",
      role: "ASSISTANT",
      content: "Saved it.",
      attachments: [],
      artifacts: [ARTIFACT],
    });
    vi.stubGlobal("fetch", makeFetch({ messages: [reply], artifacts: [ARTIFACT] }));

    renderWithQuery(
      <AiFilesPanel conversationId={CONVERSATION_ID} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    expect(await screen.findByText("Chapter 9 study guide")).toBeInTheDocument();
    expect(screen.getAllByText("Chapter 9 study guide")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Chapter 9 study guide/ })).toHaveLength(1);
  });

  it("shows an empty state when the conversation holds no files", async () => {
    vi.stubGlobal("fetch", makeFetch({ messages: [], artifacts: [] }));

    renderWithQuery(
      <AiFilesPanel conversationId={CONVERSATION_ID} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    expect(await screen.findByText(/No files yet/)).toBeInTheDocument();
  });

  it("asks for a conversation before showing files", async () => {
    vi.stubGlobal("fetch", makeFetch());

    renderWithQuery(
      <AiFilesPanel conversationId={null} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    expect(
      screen.getByText(/Open a conversation to see the files/i),
    ).toBeInTheDocument();
  });

  it("shows a loading state while the files are fetched", async () => {
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/artifacts") ? pending : json([]),
      ),
    );

    renderWithQuery(
      <AiFilesPanel conversationId={CONVERSATION_ID} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    expect(await screen.findByRole("status")).toBeInTheDocument();

    release(json({ artifacts: [ARTIFACT] }));
    expect(await screen.findByText("Chapter 9 study guide")).toBeInTheDocument();
  });

  it("shows an error with a working retry when the files fail to load", async () => {
    const fetchMock = makeFetch({ messages: [], artifactsError: true });
    vi.stubGlobal("fetch", fetchMock);

    renderWithQuery(
      <AiFilesPanel conversationId={CONVERSATION_ID} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    expect(await screen.findByText("Unable to load files")).toBeInTheDocument();

    const before = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/artifacts")).length;
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      const after = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/artifacts")).length;
      expect(after).toBeGreaterThan(before);
    });
  });

  it("downloads a generated artifact through the authenticated artifact endpoint", async () => {
    const blob = new Blob(["# Chapter 9"], { type: "text/plain" });
    const fetchMock = makeFetch({ messages: [], artifacts: [ARTIFACT] });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ai/artifacts/artifact-1/download")) {
        return fileResponse(blob, "Chapter-9-study-guide.md");
      }
      if (url.endsWith("/artifacts")) return json({ artifacts: [ARTIFACT] });
      if (url.endsWith("/messages")) return json([]);
      throw new Error(`no mock for ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const createObjectURL = vi.fn(() => "blob:mock-artifact");
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithQuery(
      <AiFilesPanel conversationId={CONVERSATION_ID} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    await userEvent.click(await screen.findByRole("button", { name: /Download Chapter 9 study guide/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/ai/artifacts/artifact-1/download"))).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/ai/artifacts/artifact-1/download"),
    ) as unknown as [string, RequestInit] | undefined;
    expect(call).toBeTruthy();
    expect(new Headers(call![1].headers).get("Authorization")).toBe("Bearer test-access-token");
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(blob));
  });

  it("downloads an uploaded attachment through the resource endpoint", async () => {
    const blob = new Blob(["video"], { type: "video/mp4" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/resources/resource-upload/download")) return fileResponse(blob);
      if (url.endsWith("/artifacts")) return json({ artifacts: [] });
      if (url.endsWith("/messages")) return json([userMessage()]);
      throw new Error(`no mock for ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const createObjectURL = vi.fn(() => "blob:mock-resource");
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithQuery(
      <AiFilesPanel conversationId={CONVERSATION_ID} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /Download lecture-recording.mp4/ }),
    );

    const call = (await waitFor(() => {
      const found = fetchMock.mock.calls.find(([input]) =>
        String(input).includes("/resources/resource-upload/download"),
      );
      expect(found).toBeTruthy();
      return found;
    })) as unknown as [string, RequestInit];
    expect(new Headers(call[1].headers).get("Authorization")).toBe("Bearer test-access-token");
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(blob));
  });

  it("refetches and shows a file added after the list was loaded", async () => {
    const fetchMock = makeFetch({ messages: [], artifacts: [] });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderWithQuery(<AiFilesPanel conversationId={CONVERSATION_ID} />, client);
    expect(await screen.findByText(/No files yet/)).toBeInTheDocument();

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/artifacts")) return json({ artifacts: [ARTIFACT] });
      if (url.endsWith("/messages")) return json([]);
      throw new Error(`no mock for ${url}`);
    });

    await client.invalidateQueries({ queryKey: artifactsKey(CONVERSATION_ID) });

    expect(await screen.findByText("Chapter 9 study guide")).toBeInTheDocument();
  });

  it("keeps each conversation's files separate when the selection changes", async () => {
    const otherArtifact: AiArtifact = {
      ...ARTIFACT,
      id: "artifact-2",
      conversationId: OTHER_CONVERSATION_ID,
      name: "Beta revision sheet",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/conversations/${CONVERSATION_ID}/`)) return url.endsWith("/artifacts") ? json({ artifacts: [ARTIFACT] }) : json([]);
      if (url.includes(`/conversations/${OTHER_CONVERSATION_ID}/`)) return url.endsWith("/artifacts") ? json({ artifacts: [otherArtifact] }) : json([]);
      throw new Error(`no mock for ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = renderWithQuery(
      <AiFilesPanel conversationId={CONVERSATION_ID} />,
      client,
    );

    expect(await screen.findByText("Chapter 9 study guide")).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={client}>
        <AiFilesPanel conversationId={OTHER_CONVERSATION_ID} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Beta revision sheet")).toBeInTheDocument();
    expect(screen.queryByText("Chapter 9 study guide")).not.toBeInTheDocument();
  });
});

describe("conversation files drawer", () => {
  beforeEach(() => {
    setTokens("test-access-token", "test-refresh-token");
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens a labelled dialog from an accessible trigger", async () => {
    vi.stubGlobal("fetch", makeFetch({ messages: [], artifacts: [] }));

    renderWithQuery(
      <AiFilesDrawer conversationId={CONVERSATION_ID} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    const trigger = screen.getByRole("button", { name: "Open conversation files" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(screen.getByText("Conversation Files")).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });
});
