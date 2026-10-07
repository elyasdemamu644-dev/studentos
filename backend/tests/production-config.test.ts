import { describe, it, expect } from "vitest";

import {
  MIN_PRODUCTION_SECRET_LENGTH,
  productionConfigErrors,
  validateConfig,
} from "@/config";

const GOOD_SECRET = "x".repeat(48);

const production = {
  nodeEnv: "production",
  jwtSecret: GOOD_SECRET,
  encryptionKey: GOOD_SECRET,
  corsOriginsExplicit: true,
  corsOrigins: ["https://studentos.example"],
};

describe("production configuration validation", () => {
  it("accepts a well-formed production configuration", () => {
    expect(productionConfigErrors({ ...production })).toEqual([]);
  });

  it("is a no-op outside production", () => {
    const base = { ...production, nodeEnv: "development" };
    expect(productionConfigErrors({ ...base, jwtSecret: "short" })).toEqual([]);
    expect(
      productionConfigErrors({ ...base, corsOriginsExplicit: false, jwtSecret: "short" }),
    ).toEqual([]);
  });

  it("rejects the placeholder secret that ships in .env.example", () => {
    const errors = productionConfigErrors({
      ...production,
      jwtSecret: "dev-only-secret-change-in-production",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("JWT_SECRET");
    expect(errors[0]).toContain("placeholder");
  });

  it("rejects secrets shorter than the production minimum", () => {
    const short = "a".repeat(MIN_PRODUCTION_SECRET_LENGTH - 1);
    const errors = productionConfigErrors({ ...production, encryptionKey: short });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ENCRYPTION_KEY");
    expect(errors[0]).toContain(String(MIN_PRODUCTION_SECRET_LENGTH));
  });

  it("rejects an unset CORS allowlist, which would leave the localhost default", () => {
    const errors = productionConfigErrors({ ...production, corsOriginsExplicit: false });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("CORS_ORIGINS");
  });

  it("rejects an explicitly empty CORS allowlist", () => {
    const errors = productionConfigErrors({ ...production, corsOrigins: [] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("at least one origin");
  });

  it("reports every problem at once", () => {
    const errors = productionConfigErrors({
      nodeEnv: "production",
      jwtSecret: "changeme",
      encryptionKey: "short",
      corsOriginsExplicit: false,
      corsOrigins: [],
    });
    expect(errors).toHaveLength(3);
  });

  it("leaves absence to the missing-variable check, not the quality check", () => {
    expect(
      productionConfigErrors({
        nodeEnv: "production",
        jwtSecret: undefined,
        encryptionKey: undefined,
        corsOriginsExplicit: true,
        corsOrigins: ["https://studentos.example"],
      }),
    ).toEqual([]);
  });

  it("passes for the environment the test suite itself runs in", () => {
    expect(() => validateConfig()).not.toThrow();
  });
});
