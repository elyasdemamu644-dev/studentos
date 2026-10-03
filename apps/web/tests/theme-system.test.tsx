import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ThemeProvider, useTheme } from "@/lib/theme/theme-provider";
import { ThemeModeToggle } from "@/components/theme-toggle";
import { ThemeSelector } from "@/components/theme/selector";
import { THEME_IDS, THEME_SUMMARIES } from "@/lib/theme/themes";

/**
 * The theme system has two jobs that are easy to break independently: the
 * tokens must actually differ per theme, and switching must reach the DOM
 * without a reload. These tests drive the real provider, so a token that stops
 * being applied or a preview that stops rendering fails here rather than only
 * being noticed by eye.
 */

function Probe() {
  const { themeId, mode, resolvedMode, setThemeId, setMode, reset } = useTheme();
  return (
    <div>
      <output data-testid="state">{`${themeId}|${mode}|${resolvedMode}`}</output>
      <button type="button" onClick={() => setThemeId("paper")}>
        pick paper
      </button>
      <button type="button" onClick={() => setThemeId("neon")}>
        pick neon
      </button>
      <button type="button" onClick={() => setMode("dark")}>
        go dark
      </button>
      <button type="button" onClick={() => setMode("system")}>
        follow system
      </button>
      <button type="button" onClick={reset}>
        reset
      </button>
    </div>
  );
}

const renderWithTheme = (ui: React.ReactNode) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

const root = () => document.documentElement;

describe("applying a visual theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("writes identity and appearance to the document, not inline colour", async () => {
    const user = userEvent.setup();
    renderWithTheme(<Probe />);

    await user.click(screen.getByRole("button", { name: "pick neon" }));

    expect(root().dataset.theme).toBe("neon");
    // Appearance is a separate axis and must be untouched by a theme change.
    expect(root().dataset.appearance).toBe("system");
    expect(root().style.getPropertyValue("--primary")).toBe("");
  });

  it("changes appearance without disturbing the chosen theme", async () => {
    const user = userEvent.setup();
    renderWithTheme(<Probe />);

    await user.click(screen.getByRole("button", { name: "pick paper" }));
    await user.click(screen.getByRole("button", { name: "go dark" }));

    expect(root().dataset.theme).toBe("paper");
    expect(root().dataset.appearance).toBe("dark");
    expect(root().classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("state").textContent).toBe("paper|dark|dark");
  });

  it("survives repeated switching without losing the final selection", async () => {
    const user = userEvent.setup();
    renderWithTheme(<Probe />);

    for (let i = 0; i < 6; i += 1) {
      await user.click(screen.getByRole("button", { name: "pick paper" }));
      await user.click(screen.getByRole("button", { name: "pick neon" }));
    }

    expect(root().dataset.theme).toBe("neon");

    await user.click(screen.getByRole("button", { name: "reset" }));
    expect(root().dataset.theme).toBe("default");
    expect(root().dataset.appearance).toBe("system");
  });
});

describe("appearance control", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("cycles all three modes so System stays reachable from the chrome", async () => {
    const user = userEvent.setup();
    renderWithTheme(<ThemeModeToggle compact />);

    const button = screen.getByRole("button", { name: /Change appearance/ });
    expect(button).toHaveAccessibleName(/Appearance: system/);

    await user.click(button);
    expect(button).toHaveAccessibleName(/Appearance: light/);
    await user.click(button);
    expect(button).toHaveAccessibleName(/Appearance: dark/);
    await user.click(button);
    expect(button).toHaveAccessibleName(/Appearance: system/);
  });

  it("persists appearance separately from theme identity", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <>
        <Probe />
        <ThemeModeToggle compact />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "pick neon" }));
    await user.click(screen.getByRole("button", { name: /Change appearance/ }));

    expect(window.localStorage.getItem("studentos.theme.id")).toBe("neon");
    expect(window.localStorage.getItem("studentos.appearance")).toBe("light");
  });
});

describe("theme selector", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("offers every theme with a rendered preview, not a coloured dot", async () => {
    renderWithTheme(<ThemeSelector />);

    const group = screen.getByRole("group", { name: "Visual theme" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(THEME_IDS.length);

    for (const summary of THEME_SUMMARIES) {
      expect(
        within(group).getByRole("button", { name: new RegExp(summary.name, "i") }),
        summary.id,
      ).toBeInTheDocument();
    }

    // Each preview injects the theme's own tokens, so a theme that loses its
    // radius or shadow in the picker fails here.
    expect(document.querySelectorAll(".theme-preview")).toHaveLength(THEME_IDS.length);
  });

  it("applies the selection immediately and marks only one as pressed", async () => {
    const user = userEvent.setup();
    renderWithTheme(<ThemeSelector />);

    const group = screen.getByRole("group", { name: "Visual theme" });
    const target = within(group).getByRole("button", { name: /Aurora/i });

    expect(target).toHaveAttribute("aria-pressed", "false");
    await user.click(target);

    expect(target).toHaveAttribute("aria-pressed", "true");
    expect(root().dataset.theme).toBe("aurora");

    const pressed = within(group).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("names the appearance control separately from the theme grid", () => {
    renderWithTheme(
      <>
        <ThemeSelector />
        <ThemeModeToggle />
      </>,
    );

    expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Visual theme" })).toBeInTheDocument();
  });
});