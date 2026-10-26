import { Router } from "express";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { z } from "zod";
import {
  updateRoutingPolicySchema,
  upsertModelPreferencesSchema,
  upsertCapabilityOverridesSchema,
  conversationModelOverrideSchema,
  usageQuerySchema,
  healthQuerySchema,
} from "@/schemas/ai-routing";
import {
  getPolicy,
  upsertPolicy,
  listPreferences,
  replacePreferences,
  clearConversationPreferences,
  listCapabilityOverrides,
  replaceCapabilityOverrides,
} from "@/services/ai/routing/policy-repository";
import { getUsageSummary, getLatestHealth } from "@/services/ai/routing/telemetry";
import { describeEffectiveCatalog } from "@/services/ai/routing/catalog-view";

const router = Router();

// Every routing endpoint is owner-scoped: the user id always comes from the
// authenticated session, never from the request body or params, so one student
// can never read or change another's routing config.
router.use(authenticate);

const conversationParam = { id: z.string().min(1).max(64) };

// ── Effective policy ─────────────────────────────────────────────────────────

/**
 * GET /ai/routing — the user's effective routing policy. A user who has never
 * saved one gets the transient defaults (AUTO strategy, no ceiling), so the UI
 * always renders a coherent state.
 */
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const policy = await getPolicy(req.currentUser!.id);
    return res.status(200).json({ success: true, data: policy });
  } catch (error) {
    next(error);
  }
});

/** PATCH /ai/routing — update the policy. Only provided fields are written. */
router.patch(
  "/",
  zValidator("body", updateRoutingPolicySchema),
  async (req: AuthRequest, res, next) => {
    try {
      const policy = await upsertPolicy(
        req.currentUser!.id,
        req.body as z.infer<typeof updateRoutingPolicySchema>,
      );
      return res.status(200).json({ success: true, data: policy });
    } catch (error) {
      next(error);
    }
  },
);

// ── Capability catalog (for the settings UI) ─────────────────────────────────

/** GET /ai/routing/catalog — providers/models with evidence-aware capabilities. */
router.get("/catalog", async (req: AuthRequest, res, next) => {
  try {
    const catalog = await describeEffectiveCatalog(req.currentUser!.id);
    return res.status(200).json({ success: true, data: catalog });
  } catch (error) {
    next(error);
  }
});

// ── Global model preferences ─────────────────────────────────────────────────

/** GET /ai/routing/preferences — the user's global allow/deny/priority rows. */
router.get("/preferences", async (req: AuthRequest, res, next) => {
  try {
    const preferences = await listPreferences(req.currentUser!.id);
    return res.status(200).json({ success: true, data: preferences });
  } catch (error) {
    next(error);
  }
});

/** PUT /ai/routing/preferences — replace the global preference set. */
router.put(
  "/preferences",
  zValidator("body", upsertModelPreferencesSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof upsertModelPreferencesSchema>;
      const preferences = await replacePreferences(
        req.currentUser!.id,
        "GLOBAL",
        null,
        body.preferences.map((pref) => ({ ...pref, scope: "GLOBAL" as const, conversationId: null })),
      );
      return res.status(200).json({ success: true, data: preferences });
    } catch (error) {
      next(error);
    }
  },
);

// ── Capability overrides ─────────────────────────────────────────────────────

/** GET /ai/routing/capabilities — the user's saved capability assertions. */
router.get("/capabilities", async (req: AuthRequest, res, next) => {
  try {
    const overrides = await listCapabilityOverrides(req.currentUser!.id);
    return res.status(200).json({ success: true, data: overrides });
  } catch (error) {
    next(error);
  }
});

/** PUT /ai/routing/capabilities — replace the user's capability assertions. */
router.put(
  "/capabilities",
  zValidator("body", upsertCapabilityOverridesSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof upsertCapabilityOverridesSchema>;
      const overrides = await replaceCapabilityOverrides(
        req.currentUser!.id,
        body.overrides.map((o) => ({
          provider: o.provider,
          model: o.model,
          kind: o.kind,
          evidence: o.evidence,
          note: o.note ?? null,
          connectionId: o.connectionId ?? null,
        })),
      );
      return res.status(200).json({ success: true, data: overrides });
    } catch (error) {
      next(error);
    }
  },
);

// ── Per-conversation override ────────────────────────────────────────────────

/** GET /ai/routing/conversations/:id/preference — the conversation's override. */
router.get(
  "/conversations/:id/preference",
  zValidator("params", conversationParam),
  async (req: AuthRequest, res, next) => {
    try {
      const prefs = await listPreferences(req.currentUser!.id, String(req.params.id));
      return res.status(200).json({ success: true, data: prefs[0] ?? null });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PUT /ai/routing/conversations/:id/preference — pin a model for one
 * conversation, or clear it by sending a null provider/model.
 */
router.put(
  "/conversations/:id/preference",
  zValidator("params", conversationParam),
  zValidator("body", conversationModelOverrideSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const userId = req.currentUser!.id;
      const conversationId = String(req.params.id);
      const body = req.body as z.infer<typeof conversationModelOverrideSchema>;
      if (!body.provider || !body.model) {
        await clearConversationPreferences(userId, conversationId);
        return res.status(200).json({ success: true, data: null });
      }
      const preferences = await replacePreferences(userId, "CONVERSATION", conversationId, [
        {
          scope: "CONVERSATION",
          conversationId,
          provider: body.provider,
          model: body.model,
          connectionId: body.connectionId ?? null,
          priority: 0,
          allowed: true,
        },
      ]);
      return res.status(200).json({ success: true, data: preferences[0] ?? null });
    } catch (error) {
      next(error);
    }
  },
);

// ── Usage + health ───────────────────────────────────────────────────────────

/** GET /ai/routing/usage — rolling-window usage/cost summary. */
router.get(
  "/usage",
  zValidator("query", usageQuerySchema),
  async (req: AuthRequest, res, next) => {
    try {
      const { days } = req.query as unknown as z.infer<typeof usageQuerySchema>;
      const summary = await getUsageSummary(req.currentUser!.id, days);
      return res.status(200).json({ success: true, data: summary });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /ai/routing/health — latest health per connection. */
router.get(
  "/health",
  zValidator("query", healthQuerySchema),
  async (req: AuthRequest, res, next) => {
    try {
      const { limit } = req.query as unknown as z.infer<typeof healthQuerySchema>;
      const health = await getLatestHealth(req.currentUser!.id, limit);
      return res.status(200).json({ success: true, data: health });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
