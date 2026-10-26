import { describe, it, expect } from "vitest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1";

describe("Settings Module", () => {
  let token: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("settings@test.com", "Pass123!");
    token = auth.token;
  });

  describe("GET /settings", () => {
    it("should return an empty map for a fresh user", async () => {
      const res = await authRequestJson("get", `${BASE}/settings`, token);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({});
    });
  });

  describe("PATCH /settings", () => {
    it("should upsert multiple settings", async () => {
      const res = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: {
          study_reminders_enabled: "true",
          dark_mode: "false",
          default_view: "week",
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        study_reminders_enabled: "true",
        default_view: "week",
      });
    });

    it("should delete a setting when value is null", async () => {
      await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { dark_mode: "true" },
      });

      const res = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { dark_mode: null },
      });

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty("dark_mode");
    });

    it("should reject empty keys", async () => {
      const res = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { "": "value" },
      });

      expect(res.status).toBe(400);
    });

    it("only accepts supported AI provider modes", async () => {
      const res = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { "ai.providerMode": "third-party" },
      });
      expect(res.status).toBe(400);
    });

    it("persists Tutor Walle Default AI mode", async () => {
      const res = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { "ai.providerMode": "default" },
      });
      expect(res.status).toBe(200);
      expect(res.body.data["ai.providerMode"]).toBe("default");
    });

    it("accepts a known AI mode and rejects an unknown one", async () => {
      const ok = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { "ai.mode": "STUDY" },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.data["ai.mode"]).toBe("STUDY");

      const bad = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { "ai.mode": "TURBO" },
      });
      expect(bad.status).toBe(400);
    });

    it("accepts a model id and rejects a blank one", async () => {
      const ok = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { "ai.model": "gpt-4o-mini" },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.data["ai.model"]).toBe("gpt-4o-mini");

      const blank = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { "ai.model": "   " },
      });
      expect(blank.status).toBe(400);
    });

    it("accepts the saved-memory switch as 'true' or 'false' and rejects anything else", async () => {
      const off = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { "ai.memoryEnabled": "false" },
      });
      expect(off.status).toBe(200);
      expect(off.body.data["ai.memoryEnabled"]).toBe("false");

      const on = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { "ai.memoryEnabled": "true" },
      });
      expect(on.status).toBe(200);
      expect(on.body.data["ai.memoryEnabled"]).toBe("true");

      const invalid = await authRequestJson("patch", `${BASE}/settings`, token, {
        settings: { "ai.memoryEnabled": "yes" },
      });
      expect(invalid.status).toBe(400);
    });
  });
});