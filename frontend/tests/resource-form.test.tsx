import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ResourceRecord } from "@/types/api-types";

/**
 * The Resources page dialog is the entry point the user sees. These tests pin
 * the two visible modes (Upload file / Add link), that an upload goes through
 * the multipart hook with the chosen file, that a link goes through the JSON
 * create hook, and that submitting an upload with no file is refused.
 */

const mock = vi.hoisted(() => ({
  useCreateResource: vi.fn(),
  useUpdateResource: vi.fn(),
  useUploadResource: vi.fn(),
}));

vi.mock("@/features/resources/hooks", () => ({
  useCreateResource: () => mock.useCreateResource(),
  useUpdateResource: () => mock.useUpdateResource(),
  useUploadResource: () => mock.useUploadResource(),
}));

vi.mock("@/features/courses/hooks", () => ({
  useCourses: () => ({ data: [], isPending: false }),
}));

import { ResourceFormDialog } from "@/features/resources/resource-form";

const linkResource: ResourceRecord = {
  id: "r2",
  courseId: null,
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

let createMutate: ReturnType<typeof vi.fn>;
let updateMutate: ReturnType<typeof vi.fn>;
let uploadMutate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  createMutate = vi.fn().mockResolvedValue({ id: "new" });
  updateMutate = vi.fn().mockResolvedValue({ id: "r2" });
  uploadMutate = vi.fn().mockResolvedValue({ id: "new-upload" });

  mock.useCreateResource.mockReturnValue({ mutateAsync: createMutate, isPending: false });
  mock.useUpdateResource.mockReturnValue({ mutateAsync: updateMutate, isPending: false });
  mock.useUploadResource.mockReturnValue({
    mutateAsync: uploadMutate,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  });
});

function renderDialog() {
  return render(<ResourceFormDialog open onOpenChange={vi.fn()} />);
}

describe("ResourceFormDialog", () => {
  it("offers both 'Upload file' and 'Add link' modes up front", () => {
    renderDialog();

    expect(screen.getByRole("tab", { name: "Upload file" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Add link" })).toBeInTheDocument();
  });

  it("uploads the selected file with the entered title", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    fireEvent.change(within(dialog).getByLabelText("File"), { target: { files: [file] } });
    await userEvent.type(within(dialog).getByLabelText("Title"), "My notes");
    await userEvent.click(within(dialog).getByRole("button", { name: /Upload resource/ }));

    await waitFor(() => expect(uploadMutate).toHaveBeenCalledTimes(1));
    expect(uploadMutate.mock.calls[0][0]).toMatchObject({ file, title: "My notes" });
    // Auto-detect leaves the type to the server.
    expect(uploadMutate.mock.calls[0][0].resourceType).toBeUndefined();
  });

  it("refuses an upload with no file chosen", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Title"), "No file");
    await userEvent.click(within(dialog).getByRole("button", { name: /Upload resource/ }));

    expect(await within(dialog).findByText("Choose a file to upload")).toBeInTheDocument();
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it("creates a link resource from the 'Add link' mode", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("tab", { name: "Add link" }));
    await userEvent.type(within(dialog).getByLabelText("Title"), "Slides");
    await userEvent.type(
      within(dialog).getByLabelText("Link"),
      "https://example.com/slides",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: /Add resource/ }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0][0]).toMatchObject({
      title: "Slides",
      url: "https://example.com/slides",
      resourceType: "LINK",
    });
  });

  it("shows a link's current values when editing it", () => {
    render(
      <ResourceFormDialog open onOpenChange={vi.fn()} resource={linkResource} />,
    );

    // Editing hides the mode switch and prefills the link.
    expect(screen.queryByRole("tab", { name: "Upload file" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Link")).toHaveValue("https://example.org/docs");
    expect(screen.getByRole("button", { name: /Save changes/ })).toBeInTheDocument();
  });
});
