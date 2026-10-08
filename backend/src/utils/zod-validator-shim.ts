import type { Request, RequestHandler, Response } from "express";
import { z, type ZodSchema } from "zod";

/** Coerce a plain `{ field: schema }` object into a full Zod object schema. */
function toSchema(schema: ZodSchema<unknown> | Record<string, unknown>): ZodSchema<unknown> {
  return typeof (schema as ZodSchema<unknown>).safeParse === "function"
    ? (schema as ZodSchema<unknown>)
    : z.object(schema as Record<string, z.ZodTypeAny>);
}

/**
 * Validate a request (body/query/params/headers) against a Zod schema.
 *
 * On success the parsed data is written back onto the request so route
 * handlers receive normalized values (defaults applied, unknown keys
 * stripped, coerced types). On failure the raw ZodError is passed to
 * `next()` so the global error handler can respond 400.
 *
 * The write-back must define an own property: Express 5 exposes `req.query`
 * as a getter-only property on the request prototype, and assigning to an
 * accessor with no setter is a *silent no-op* (it does not throw), so the
 * parsed values would be discarded and raw query strings — `limit=5` — would
 * reach Prisma as `take: "51"`.
 */
export function zValidator(
  target: "body" | "query" | "params" | "headers",
  schema: ZodSchema<unknown> | Record<string, unknown>,
): RequestHandler {
  return (req: Request, _res: Response, next: (error?: unknown) => void) => {
    const zodSchema = toSchema(schema);
    const source = (req as unknown as Record<string, unknown>)[target];
    const result = zodSchema.safeParse(source ?? {});
    if (result.success) {
      Object.defineProperty(req, target, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      next();
      return;
    }
    next(result.error);
  };
}