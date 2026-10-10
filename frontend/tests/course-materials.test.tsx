import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ResourceRecord } from "@/types/api-types";

/**
 * The course Materials section is the first place the web app uploads and
 * downloads real files. These tests pin the behaviours that are easy to break
 * silently: the right action per storage type, the authenticated download,
 * course-scoped uploads, and the loading/empty/error states.
 */

const mock = vi.hoisted(() => ({
  useResources: vi.fn(),
  useDeleteResource: vi.fn(),
  useDownloadResource: vi.fn(),
  useUploadResource: vi.fn(),
  useCreateResource: vi.fn(),
  useUpdateResource: vi.fn(),
}));

vi.mock("@/features/resources/hooks", () => ({
  useResources: (params: unknown) => mock.useResources(params),
  useDeleteResource: () => mock.useDeleteResource(),
  useDownloadResource: () => mock.useDownloadResource(),
  useUploadResource: () => mock.useUploadResource(),
  useCreateResource: () => mock.useCreateResource(),
  useUpdateResource: () => mock.useUpdateResource(),
}));

vi.mock("@/features/courses/hooks", () => ({
  useCourses: () => ({ data: [], isPending: false }),
}));

// The panel's "Library" link is the only next/link; a plain anchor avoids
// pulling the app-router runtime into the test.
vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

import { CourseMaterialsPanel } from "@/features/resources/course-materials";

const uploadResource: ResourceRecord = {
  id: "r1",
  courseId: "c1",
  title: "Lecture notes",
  description: null,
  url: null,
  storageType: "UPLOAD",
  fileKey: "resources/u/a.pdf",
  fileName: "a.pdf",
  fileSize: 2048,
  mimeType: "application/pdf",
  resourceType: "PDF",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  course: null,
};

const linkResource: ResourceRecord = {
  id: "r2",
  courseId: "c1",
  title: "Course website",
  description: "Readings",
  url: "https://example.org/docs",
  storageType: "URL",
  fileKey: null,
  fileName: null,
  fileSize: null,
  mimeType: null,
  resourceType: "LINK",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  course: null,
};

function state(overrides: Record<string, unknown> = {}) {
  return {
    data: { items: [] as ResourceRecord[], hasMore: false, nextCursor: null },
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPanel() {
  return render(<CourseMaterialsPanel courseId="c1" />);
}

let deleteMutate: ReturnType<typeof vi.fn>;
let downloadMutate: ReturnType<typeof vi.fn>;
let uploadMutate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  deleteMutate = vi.fn().mockResolvedValue({ deleted: true });
  downloadMutate = vi.fn().mockResolvedValue({ blob: new Blob(["hi"]), fileName: "a.pdf" });
  uploadMutate = vi.fn().mockResolvedValue({ id: "new" });

  mock.useResources.mockImplementation(() => state());
  mock.useDeleteResource.mockReturnValue({ mutateAsync: deleteMutate, isPending: false });
  mock.useDownloadResource.mockReturnValue({ mutateAsync: downloadMutate, isPending: false });
  mock.useUploadResource.mockReturnValue({
    mutateAsync: uploadMutate,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  });
  mock.useCreateResource.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  mock.useUpdateResource.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
});

describe("CourseMaterialsPanel", () => {
  it("lists uploaded files and links with the right action each", () => {
    mock.useResources.mockReturnValue(
      state({ data: { items: [uploadResource, linkResource], hasMore: false, nextCursor: null } }),
    );

    renderPanel();

    expect(screen.getByText("Lecture notes")).toBeInTheDocument();
    expect(screen.getByText("Course website")).toBeInTheDocument();
    // A file downloads through the API…
    expect(screen.getByRole("button", { name: "Download Lecture notes" })).toBeInTheDocument();
    // …a link opens in a new tab.
    expect(screen.getByRole("link", { name: "Open Course website in a new tab" })).toHaveAttribute(
      "href",
      "https://example.org/docs",
    );
    expect(screen.getByText(/2\s*KB/)).toBeInTheDocument();
  });

  it("shows an empty state with upload and link actions", () => {
    renderPanel();

    expect(screen.getByText("No materials yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload a file/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add a link/ })).toBeInTheDocument();
  });

  it("shows a loading skeleton while the list is pending", () => {
    mock.useResources.mockReturnValue(state({ isPending: true, data: undefined }));

    renderPanel();

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an error state and retries", async () => {
    const refetch = vi.fn();
    mock.useResources.mockReturnValue(
      state({ isError: true, error: new Error("boom"), refetch, data: undefined }),
    );

    renderPanel();

    expect(screen.getByText("boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("confirms before deleting a material", async () => {
    mock.useResources.mockReturnValue(
      state({ data: { items: [uploadResource], hasMore: false, nextCursor: null } }),
    );

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Delete Lecture notes" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete material")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith("r1"));
  });

  it("downloads an uploaded file through the authenticated API and saves it", async () => {
    mock.useResources.mockReturnValue(
      state({ data: { items: [uploadResource], hasMore: false, nextCursor: null } }),
    );
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Download Lecture notes" }));

    await waitFor(() => expect(downloadMutate).toHaveBeenCalledWith(uploadResource));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");

    clickSpy.mockRestore();
  });

  it("uploads the selected file, scoped to the course", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: /Upload a file/ }));
    const dialog = await screen.findByRole("dialog");

    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    fireEvent.change(within(dialog).getByLabelText("File"), { target: { files: [file] } });
    await userEvent.type(within(dialog).getByLabelText("Title"), "My notes");
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(uploadMutate).toHaveBeenCalledTimes(1));
    expect(uploadMutate.mock.calls[0][0]).toMatchObject({
      file,
      title: "My notes",
      courseId: "c1",
    });
    expect(uploadMutate.mock.calls[0][0].resourceType).toBeUndefined();
  });

  it("refuses to submit without a file", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: /Upload a file/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Title"), "No file");
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    expect(await within(dialog).findByText("Choose a file to upload")).toBeInTheDocument();
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it("pages in more materials on demand", async () => {
    mock.useResources.mockReturnValue(
      state({ data: { items: [uploadResource], hasMore: true, nextCursor: "next" } }),
    );

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: /Load more/i }));

    await waitFor(() => {
      const lastCall = mock.useResources.mock.calls.at(-1);
      expect(lastCall?.[0]).toMatchObject({ courseId: "c1", limit: 40 });
    });
  });
});
