/**
 * Small HSL helpers used to derive the long tail of colour tokens from a
 * handful of primitives per theme.
 *
 * Everything stays in HSL because that is the form the token contract requires
 * (`hsl(var(--token))` plus Tailwind alpha modifiers). The only reason we
 * convert to RGB is luminance-based contrast picking for status foregrounds,
 * where "does white text work here?" is a question about perceived light.
 */

export interface Hsl {
  h: number;
  s: number;
  l: number;
  a?: number;
}

const TRIPLET = /^\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+%?))?\s*$/;

/** Parses `"220 25% 98%"` / `"220 25% 98% / 50%"` into a structured value. */
export function parseHsl(value: string): Hsl {
  const match = TRIPLET.exec(value);
  if (!match) {
    throw new Error(
      `Not an HSL triplet: "${value}". Theme colours must be bare HSL triplets such as "220 25% 98%".`,
    );
  }
  const alpha = match[4];
  return {
    h: Number(match[1]),
    s: Number(match[2]),
    l: Number(match[3]),
    a: alpha === undefined ? undefined : Number(alpha.replace("%", "")) / (alpha.endsWith("%") ? 100 : 1),
  };
}

export function formatHsl({ h, s, l, a }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const base = `${round(hue)} ${round(s)}% ${round(l)}%`;
  return a === undefined ? base : `${base} / ${round(a)}`;
}

const round = (n: number): number => Math.round(n * 100) / 100;

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** Linear blend between two triplets, used to nudge lightness rather than guess it. */
export function mix(from: string, to: string, amount: number): string {
  const a = parseHsl(from);
  const b = parseHsl(to);
  const t = clamp(amount, 0, 1);
  // Shorter hue arc so indigo -> amber does not travel through green.
  const dh = ((b.h - a.h + 540) % 360) - 180;
  return formatHsl({
    h: a.h + dh * t,
    s: a.s + (b.s - a.s) * t,
    l: a.l + (b.l - a.l) * t,
  });
}

export function lighten(value: string, amount: number): string {
  const { h, s, l } = parseHsl(value);
  return formatHsl({ h, s: clamp(s - amount * 6, 0, 100), l: clamp(l + amount * 100, 0, 100) });
}

export function darken(value: string, amount: number): string {
  return lighten(value, -amount);
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = lum - c / 2;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

/** WCAG relative luminance of a triplet, used for contrast decisions. */
export function luminance(value: string): number {
  const [r, g, b] = hslToRgb(parseHsl(value)).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Picks the readable foreground for a fill instead of trusting a hand-written guess. */
export function readableOn(background: string, light = "0 0% 100%", dark = "220 30% 8%"): string {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

/**
 * Resolve a readable foreground/background pair, adjusting the background's
 * lightness if neither candidate ink is legible enough.
 *
 * Contrast is the one property of a palette that cannot be eyeballed or left to
 * a per-theme hand-tuned value: it depends on the interaction of many derived
 * tokens. Solving it here means a theme author cannot accidentally ship a
 * button label at 3.7:1 by nudging one brand colour.
 */
export function legiblePair(
  background: string,
  lightInk = "0 0% 100%",
  darkInk = "220 30% 8%",
  minimum = 4.5,
): { background: string; ink: string } {
  const ink = readableOn(background, lightInk, darkInk);
  if (contrastRatio(background, ink) >= minimum) return { background, ink };

  // Push the fill away from the chosen ink until it clears the bar. Saturation
  // is reduced as we go so a nudged brand colour stays recognisable instead of
  // turning into a flat grey.
  const hsl = parseHsl(background);
  const goingDarker = luminance(ink) > 0.5;
  let best = { background, ink };

  for (let step = 1; step <= 40; step += 1) {
    const lightness = clamp(goingDarker ? hsl.l - step : hsl.l + step, 0, 100);
    const candidate = formatHsl({
      h: hsl.h,
      s: clamp(hsl.s - step * 0.4, 0, 100),
      l: lightness,
    });
    const candidateInk = readableOn(candidate, lightInk, darkInk);
    const ratio = contrastRatio(candidate, candidateInk);
    if (ratio >= minimum) return { background: candidate, ink: candidateInk };
    best = { background: candidate, ink: candidateInk };
  }

  return best;
}

/**
 * Nudge a non-text colour (a chart series, a marker) until it separates from
 * the surface it is drawn on by `minimum`.
 *
 * Series are identified by colour across the whole app, so their hue is
 * load-bearing and cannot simply be re-picked. Only lightness moves, in the
 * direction away from the surface, which preserves identity while guaranteeing
 * the series is actually visible.
 */
export function separatedFrom(value: string, surface: string, minimum = 3): string {
  if (contrastRatio(value, surface) >= minimum) return value;

  const hsl = parseHsl(value);
  const awayFromSurface = luminance(surface) > 0.5 ? -1 : 1;
  let candidate = value;

  for (let step = 1; step <= 40; step += 1) {
    candidate = formatHsl({ h: hsl.h, s: hsl.s, l: clamp(hsl.l + awayFromSurface * step * 2, 0, 100) });
    if (contrastRatio(candidate, surface) >= minimum) return candidate;
  }

  return candidate;
}

/** Test helper: does `foreground` stay legible on `background`? */
export function meetsContrast(background: string, foreground: string, minimum = 4.5): boolean {
  return contrastRatio(background, foreground) >= minimum;
}