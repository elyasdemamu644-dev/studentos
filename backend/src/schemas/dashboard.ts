import { z } from "zod";

/**
 * Dashboard aggregation query schema.
 *
 * No request body — this is a GET endpoint.
 * Optional query parameters control the time window for "today" and
 * "upcoming" items.
 */

export const dashboardQuerySchema = z.object({
  // Whether to include course summary in the response.
  includeCourses: z
    .enum(["true", "false"])
    .optional()
    .default("true"),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
