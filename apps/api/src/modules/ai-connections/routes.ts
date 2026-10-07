import { Router } from "express";
import { zValidator } from "@/lib/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/modules/auth/routes";
import * as aiConnectionsService from "./service";
import {
  type AiConnectionResponse,
  type TestConnectionResult,
  AiConnectionResponseSchema,
  AiConnectionPageSchema,
  TestConnectionResultSchema,
  isCredentialFreeProvider,
} from "./schema";
import { z } from "zod";
import { NotFoundError } from "@/config/errors";

const router = Router();

// All routes require authentication
router.use(authenticate);

const idParam = { id: z.string().min(1) };

/**
 * Query validator for `GET /`. `limit` is coerced (query strings are always
 * strings) and bounded so a client cannot ask for an unbounded page.
 */
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(64).optional(),
});

const providerEnum = z.enum(["openai","gemini","anthropic","openrouter","ollama","custom"]);

/**
 * Body validator for `POST /` and `POST /test`.
 *
 * `credentials` is optional at the shape level and required by `superRefine`
 * for every provider that actually uses a key — only credential-free providers
 * (ollama) may omit it. This mirrors `CreateAiConnectionSchema` /
 * `TestConnectionInputSchema` so a request is rejected at the edge with the
 * same 400 shape either way.
 */
const createBodySchema = z.object({
  provider: providerEnum,
  model: z.string().trim().max(256).optional().nullable(),
  endpoint: z.string().trim().max(512).url().optional().nullable(),
  credentials: z.string().min(1).max(2000).optional(),
}).superRefine((data, ctx) => {
  if ((data.provider === "ollama" || data.provider === "custom") && !data.endpoint) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoint"],
      message: "Endpoint is required for ollama and custom providers",
    });
  }
  if (!isCredentialFreeProvider(data.provider) && !data.credentials) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["credentials"],
      message: `Credentials are required for the ${data.provider} provider`,
    });
  }
});

// ── Create ─────────────────────────────────────────────────────────────────────

router.post(
  "/",
  zValidator("body", createBodySchema),
  async (req: AuthRequest, res, next) => {
    try {
      const conn = await aiConnectionsService.createConnection(
        req.currentUser.id,
        req.body
      );
      res.status(201).json({ success: true, data: conn });
    } catch (error) {
      next(error);
    }
  }
);

// ── List ───────────────────────────────────────────────────────────────────────

router.get(
  "/",
  zValidator("query", listQuerySchema),
  async (req: AuthRequest, res, next) => {
    try {
      const { limit, cursor } = req.query as unknown as z.infer<typeof listQuerySchema>;
      const page = await aiConnectionsService.listConnections(
        req.currentUser.id,
        limit,
        cursor
      );
      res.json({ success: true, data: page });
    } catch (error) {
      next(error);
    }
  }
);

// ── Get active ────────────────────────────────────────────────────────────────
// NOTE: must be registered before "/:id" or Express will match the literal
// path "/active" as an :id and 404 it.

router.get(
  "/active",
  async (req: AuthRequest, res, next) => {
    try {
      const conn = await aiConnectionsService.getActiveConnection(
        req.currentUser.id
      );
      if (!conn) {
        throw new NotFoundError("No active AI connection");
      }
      res.json({ success: true, data: conn });
    } catch (error) {
      next(error);
    }
  }
);

// ── Get single ────────────────────────────────────────────────────────────────

router.get(
  "/:id",
  zValidator("params", idParam),
  async (req: AuthRequest, res, next) => {
    try {
      const conn = await aiConnectionsService.getConnection(
        (req.params as { id: string }).id,
        req.currentUser.id
      );
      res.json({ success: true, data: conn });
    } catch (error) {
      next(error);
    }
  }
);

// ── Update ─────────────────────────────────────────────────────────────────────

router.patch(
  "/:id",
  zValidator("params", idParam),
  zValidator("body", z.object({
    provider: z.enum(["openai","gemini","anthropic","openrouter","ollama","custom"]).optional(),
    model: z.string().trim().max(256).optional().nullable(),
    endpoint: z.string().trim().max(512).url().optional().nullable(),
    credentials: z.string().min(1).max(2000).optional(),
    enabled: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }).refine((o) => Object.keys(o).length > 0, { message: "At least one field must be provided" })),
  async (req: AuthRequest, res, next) => {
    try {
      const conn = await aiConnectionsService.updateConnection(
        (req.params as { id: string }).id,
        req.currentUser.id,
        req.body
      );
      res.json({ success: true, data: conn });
    } catch (error) {
      next(error);
    }
  }
);

// ── Delete ─────────────────────────────────────────────────────────────────────

router.delete(
  "/:id",
  zValidator("params", idParam),
  async (req: AuthRequest, res, next) => {
    try {
      await aiConnectionsService.deleteConnection(
        (req.params as { id: string }).id,
        req.currentUser.id
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// ── Test (external) ────────────────────────────────────────────────────────────

router.post(
  "/test",
  zValidator("body", createBodySchema),
  async (req: AuthRequest, res, next) => {
    try {
      const result = await aiConnectionsService.testConnection(
        req.currentUser.id,
        req.body
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ── Test existing connection ──────────────────────────────────────────────────

router.post(
  "/:id/test",
  zValidator("params", idParam),
  zValidator("body", z.object({
    provider: z.enum(["openai","gemini","anthropic","openrouter","ollama","custom"]).optional(),
    model: z.string().trim().max(256).optional().nullable(),
    endpoint: z.string().trim().max(512).url().optional().nullable(),
    credentials: z.string().min(1).max(2000).optional(),
  })),
  async (req: AuthRequest, res, next) => {
    try {
      const result = await aiConnectionsService.testConnection(
        req.currentUser.id,
        req.body,
        (req.params as { id: string }).id
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ── Set active ────────────────────────────────────────────────────────────────

router.post(
  "/:id/activate",
  zValidator("params", idParam),
  async (req: AuthRequest, res, next) => {
    try {
      const conn = await aiConnectionsService.setActiveConnection(
        (req.params as { id: string }).id,
        req.currentUser.id
      );
      res.json({ success: true, data: conn });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
