import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";

// UPLOAD_DIR must never depend on the module's own location. This source file
// is bundled into dist/server.js by esbuild, so a `__dirname`-relative default
// escapes the app directory in production and uploads fail with 503
// STORAGE_ERROR (observed against the real bundled container image). The
// default is anchored to the working directory instead, and deployments set
// UPLOAD_DIR explicitly (Dockerfile ENV, render.yaml).
describe("UPLOAD_DIR resolution", () => {
  const original = process.env.UPLOAD_DIR;

  afterEach(() => {
    if (original === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = original;
    vi.resetModules();
  });

  it("defaults to <cwd>/uploads when the variable is unset", async () => {
    delete process.env.UPLOAD_DIR;
    vi.resetModules();
    const { config } = await import("@/config");
    expect(config.uploadDir).toBe(path.resolve(process.cwd(), "uploads"));
    expect(path.isAbsolute(config.uploadDir)).toBe(true);
  });

  it("honours an explicit UPLOAD_DIR verbatim", async () => {
    const custom = path.join(os.tmpdir(), "tutor-walle-custom-uploads");
    process.env.UPLOAD_DIR = custom;
    vi.resetModules();
    const { config } = await import("@/config");
    expect(config.uploadDir).toBe(custom);
  });
});
