import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  deletePlan: vi.fn(),
  updateEntry: vi.fn(),
  extract: vi.fn(),
  resetExtraction: vi.fn(),
}));

vi.mock("@/features/courses/hooks", () => ({
  useCourses: () => ({ data: [{ id: "course-1", name: "Biology 101" }] }),
}));

vi.mock("@/features/ai/hooks", () => ({
  useStudyPlans: () => ({ isPending: false, isError: false, data: { items: [] } }),
  useCreateStudyPlan: () => ({ mutateAsync: mocks.createPlan, isPending: false }),
  useUpdateStudyPlan: () => ({ mutateAsync: mocks.updatePlan, isPending: false }),
  useDeleteStudyPlan: () => ({ mutateAsync: mocks.deletePlan, isPending: false }),
  useUpdateStudyPlanEntry: () => ({ mutate: mocks.updateEntry, mutateAsync: mocks.updateEntry, isPending: false }),
  useStructuredExtraction: () => ({ mutate: mocks.extract, isPending: false, isError: false, error: null, data: null, reset: mocks.resetExtraction }),
}));

import { StudyPlans } from "@/features/ai/study-plans";
import { StructuredExtractionDialog } from "@/features/ai/structured-extraction";

afterEach(() => {
  vi.clearAllMocks();
});

describe("missing backend workflow interfaces", () => {
  it("creates a persistent study plan with its initial steps", async () => {
    const user = userEvent.setup();
    mocks.createPlan.mockResolvedValue({});
    render(<StudyPlans />);

    await user.click(screen.getByRole("button", { name: "New plan" }));
    await user.type(screen.getByLabelText("Plan title"), "Biology exam");
    await user.type(screen.getByLabelText("Step", { selector: "input" }), "Review cell structure");
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(mocks.createPlan).toHaveBeenCalledWith(expect.objectContaining({
      title: "Biology exam",
      entries: [expect.objectContaining({ dayNumber: 1, title: "Review cell structure", durationMinutes: 30 })],
    })));
  });

  it("submits a grounded structured extraction request using the selected output schema", async () => {
    const user = userEvent.setup();
    render(<StructuredExtractionDialog />);

    await user.click(screen.getByRole("button", { name: "Open structured study extraction" }));
    await user.type(screen.getByLabelText("What should it organize?"), "Summarize my biology exam topics");
    await user.click(screen.getByRole("button", { name: /^Extract$/ }));

    await waitFor(() => expect(mocks.extract).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Summarize my biology exam topics",
      ground: true,
      schema: expect.objectContaining({ type: "object", required: ["summary", "keyPoints", "reviewQuestions"] }),
    })));
  });
});
