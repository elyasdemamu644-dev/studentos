import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Every colour, radius, shadow, duration and layout width below is a CSS custom
 * property produced by `src/lib/theme/css.ts` from the theme definitions.
 *
 * Two rules make this file work:
 *
 *  1. Colours are declared with `<alpha-value>` so `bg-card/60`, `border-border/40`
 *     and friends keep working. That requires tokens to be bare HSL triplets,
 *     which is why `token-contract.ts` mandates that shape.
 *  2. Nothing here hard-codes a value a theme might want to change. If a
 *     property is missing here, no theme can reach it.
 */

/**
 * A colour token, in the form that keeps Tailwind's alpha modifiers working.
 *
 * The generated theme CSS defines every token on `:root`, so a fallback is
 * never actually used. Note that a fallback naming its own property
 * (`var(--x, hsl(var(--x)))`) is a reference cycle — it happens to be harmless
 * while the property is defined, but it would resolve to nothing if the token
 * ever went missing. Use `aliased` when one token is genuinely a synonym for
 * another, which is a different and honest thing to express.
 */
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

/** A utility whose token is a synonym for another token (e.g. destructive -> danger). */
const aliased = (name: string, target: string) => `hsl(var(--${name}, var(--${target})) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "var(--page-pad)",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // `border-border` stays the hairline; `border-border-strong` is the
        // heavier rule a theme uses where separation must actually read
        // (table heads, active dividers, high-contrast layouts like Focus).
        border: {
          DEFAULT: token("border"),
          strong: token("border-strong"),
        },
        input: token("input"),
        ring: token("ring"),
        background: token("background"),
        foreground: token("foreground"),
        primary: {
          DEFAULT: token("primary"),
          foreground: token("primary-foreground"),
        },
        secondary: {
          DEFAULT: token("secondary"),
          foreground: token("secondary-foreground"),
        },
        destructive: {
          DEFAULT: aliased("destructive", "danger"),
          foreground: aliased("destructive-foreground", "danger-foreground"),
        },
        muted: {
          DEFAULT: token("muted"),
          foreground: token("muted-foreground"),
        },
        accent: {
          DEFAULT: token("accent"),
          foreground: token("accent-foreground"),
        },
        popover: {
          DEFAULT: token("popover"),
          foreground: token("popover-foreground"),
        },
        card: {
          DEFAULT: token("card"),
          foreground: token("card-foreground"),
        },
        success: {
          DEFAULT: token("success"),
          foreground: token("success-foreground"),
        },
        warning: {
          DEFAULT: token("warning"),
          foreground: token("warning-foreground"),
        },
        danger: {
          DEFAULT: token("danger"),
          foreground: token("danger-foreground"),
        },
        sidebar: {
          DEFAULT: token("sidebar"),
          foreground: token("sidebar-foreground"),
          accent: token("sidebar-accent"),
          "accent-foreground": token("sidebar-accent-foreground"),
          border: token("sidebar-border"),
        },
        surface: {
          raised: token("surface-raised"),
          sunken: token("surface-sunken"),
          hover: token("surface-hover"),
        },
        // `--overlay` carries its own alpha, so it cannot take `<alpha-value>`.
        overlay: "hsl(var(--overlay))",
        // The AI workspace follows the theme's card/muted/border tokens, so
        // `bg-ai/60` and friends work exactly like any other colour utility.
        ai: {
          DEFAULT: token("card"),
          muted: token("muted"),
        },
        chart: {
          1: token("chart-1"),
          2: token("chart-2"),
          3: token("chart-3"),
          4: token("chart-4"),
          5: token("chart-5"),
          grid: token("chart-grid"),
          axis: token("chart-axis"),
          surface: token("chart-surface"),
          "surface-border": token("chart-surface-border"),
        },
      },
      borderRadius: {
        none: "0",
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "calc(var(--radius-xl) + 6px)",
        badge: "var(--badge-radius)",
        nav: "var(--nav-radius)",
        ai: "var(--ai-radius)",
        full: "9999px",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)", "var(--font-sans)"],
        mono: ["var(--font-mono)"],
        ai: ["var(--ai-font)", "var(--font-sans)"],
      },
      spacing: {
        sidebar: "var(--sidebar-width)",
        "content-max": "var(--content-width)",
        "control": "var(--control-h)",
        "control-sm": "var(--control-h-sm)",
        "control-lg": "var(--control-h-lg)",
        "control-px": "var(--control-px)",
      },
      boxShadow: {
        // Depth is a theme decision, not a component decision.
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
        inset: "var(--shadow-inset)",
        ai: "var(--ai-glow)",
      },
      maxWidth: {
        content: "var(--content-width)",
      },
      transitionDuration: {
        DEFAULT: "var(--motion-fast)",
      },
      transitionTimingFunction: {
        theme: "var(--motion-ease)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in var(--motion-base) var(--motion-ease) both",
        "scale-in": "scale-in calc(var(--motion-fast) + 30ms) var(--motion-ease) both",
      },
    },
  },
  plugins: [animate],
};

export default config;