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
  });
});