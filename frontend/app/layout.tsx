import type { Metadata } from "next";
import { THEME_BOOTSTRAP_SCRIPT, buildThemeCss } from "@/lib/theme/themes";
import { THEMES } from "@/lib/theme/definitions";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "StudentOS — Study smarter, stay organized",
    template: "%s · StudentOS",
  },
  description:
    "Courses, tasks, notes, study timer, goals and analytics for students — all in one sprint-ready workspace.",
};

/**
 * All theme tokens, rendered on the server.
 *
 * This is the reason there is no flash of the wrong theme and no client-side
 * colour work: the stylesheet is complete in the first HTML response, and the
 * bootstrap script only has to set `data-theme` and the `dark` class to select
 * the right block within it.
 */
const themeCss = buildThemeCss(THEMES);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style
          id="studentos-theme-tokens"
          // Static, build-time output from our own theme definitions — there is
          // no user input anywhere in this string.
          dangerouslySetInnerHTML={{ __html: themeCss }}
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}