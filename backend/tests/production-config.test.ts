import { describe, it, expect } from "vitest";

import {
  MIN_PRODUCTION_SECRET_LENGTH,
  productionConfigErrors,
  validateConfig,
} from "@/config";

const GOOD_SECRET = "x".repeat(43);

const production = {
  nodeEnv: "production",
  databaseUrl: "postgresql://app:password@ep-studentos-pooler.us-east-1.aws.neon.tech/studentos?sslmode=require&connection_limit=5",
  jwtSecret: GOOD_SECRET,
  encryptionKey: GOOD_SECRET,
  aiAllowPrivateEndpoints: false,
  egressProxyUrl: "http://egress-proxy:3128",
  egressAllowedDestinations: ["ep-studentos-pooler.us-east-1.aws.neon.tech:5432", "openrouter.ai:443", "www.googleapis.com:443"],
  aiEnabled: true,
  aiProvider: "openrouter",
  egressDatabaseHost: "ep-studentos-pooler.us-east-1.aws.neon.tech",
  trustProxyExplicit: true,
  trustProxyValid: true,
  trustProxy: 1,
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
      ...production,
      jwtSecret: "changeme",
      encryptionKey: "short",
      corsOriginsExplicit: false,
    });
    expect(errors).toHaveLength(3);
  });

  it("reports missing deployment security configuration without treating absent secrets as placeholders", () => {
    const errors = productionConfigErrors({
        nodeEnv: "production",
        jwtSecret: undefined,
        encryptionKey: undefined,
        corsOriginsExplicit: true,
        corsOrigins: ["https://studentos.example"],
      });
    expect(errors.join(" ")).not.toMatch(/JWT_SECRET|ENCRYPTION_KEY/);
    expect(errors).toContain("EGRESS_PROXY_URL is required in production");
  });

  it("passes for the environment the test suite itself runs in", () => {
    expect(() => validateConfig()).not.toThrow();
  });

  it("requires a mandatory proxy and approved destinations in production", () => {
    expect(productionConfigErrors({ ...production, egressProxyUrl: undefined })).toContain(
      "EGRESS_PROXY_URL is required in production",
    );
    expect(productionConfigErrors({ ...production, egressAllowedDestinations: [] })).toContain(
      "EGRESS_ALLOWED_DESTINATIONS must contain approved hostname:port entries",
    );
  });

  it("fails closed on private endpoint bypass and malformed proxy URLs", () => {
    const errors = productionConfigErrors({
      ...production,
      aiAllowPrivateEndpoints: true,
      egressProxyUrl: "http://user:secret@proxy.example/path",
    });
    expect(errors.join(" ")).toContain("AI_ALLOW_PRIVATE_ENDPOINTS");
    expect(errors.join(" ")).toContain("EGRESS_PROXY_URL");
    expect(errors.join(" ")).not.toContain("secret");
  });

  it("requires the Neon endpoint to match the database URL and use TLS", () => {
    expect(
      productionConfigErrors({
        ...production,
        databaseUrl: "postgresql://app:secret@other.example/db?sslmode=disable",
      }).join(" "),
    ).toMatch(/must match EGRESS_DATABASE_HOST/);
    const errors = productionConfigErrors({
      ...production,
      databaseUrl: "postgresql://app:secret@ep-studentos-pooler.us-east-1.aws.neon.tech/db",
    });
    expect(errors.join(" ")).toContain("must require TLS");
    expect(errors.join(" ")).not.toContain("secret");
  });

  it("rejects insecure CORS origins and invalid reverse-proxy settings", () => {
    const errors = productionConfigErrors({
      ...production,
      corsOrigins: ["*", "http://studentos.example/path"],
      trustProxyValid: false,
      trustProxy: 0,
    });
    expect(errors.join(" ")).toContain("exact HTTPS origins");
    expect(errors.join(" ")).toContain("TRUST_PROXY");
  });

  it("requires TLS for production SMTP", () => {
    const errors = productionConfigErrors({
      ...production,
      emailEnabled: true,
      smtpHost: "smtp.example.test",
      smtpPort: 465,
      smtpSecure: false,
      egressAllowedDestinations: [...production.egressAllowedDestinations, "smtp.example.test:465"],
    });
    expect(errors).toContain("SMTP_SECURE must be true in production to require TLS");
  });
});
