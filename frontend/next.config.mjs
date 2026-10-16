import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────
// Production build guard (Render)
// ─────────────────────────────────────────────
//
// NEXT_PUBLIC_* values are inlined into the client bundle at build time, so a
// missing, mis-pointed or localhost API URL only shows up later as broken
// requests in the browser. Render exposes `RENDER=true` at build time, so the
// build fails here instead of shipping a bundle that calls localhost.
// Local and CI builds (RENDER unset) keep the http://localhost:3001 dev
// default in `lib/api/client.ts`.
if (process.env.RENDER === "true") {
  const raw = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();
  const fail = (reason) => {
    throw new Error(`Refusing to build the web app on Render: ${reason}. Set NEXT_PUBLIC_API_URL to the deployed API origin (https://<api-host>/api/v1).`);
  };

  if (!raw) fail("NEXT_PUBLIC_API_URL is missing");
  if (raw.includes("@")) fail("NEXT_PUBLIC_API_URL must not embed credentials");

  let apiUrl;
  try {
    apiUrl = new URL(raw.replace(/\/$/, ""));
  } catch {
    fail("NEXT_PUBLIC_API_URL is not a valid absolute URL");
  }

  if (apiUrl.protocol !== "https:") fail(`NEXT_PUBLIC_API_URL must use https, got ${apiUrl.protocol}`);
  if (apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1") fail("NEXT_PUBLIC_API_URL points at localhost");
  if (!apiUrl.pathname.replace(/\/$/, "").endsWith("/api/v1")) {
    fail(`NEXT_PUBLIC_API_URL must end in /api/v1, got ${apiUrl.pathname || "/"}`);
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@tutor-walle/shared"],
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  },
};

export default nextConfig;
