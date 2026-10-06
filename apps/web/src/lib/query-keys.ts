import type { QueryClient } from "@tanstack/react-query";

/**
 * Rollups that aggregate records owned by other modules.
 *
 * `dashboard` is the cross-system command center and `course-summary` is the
 * per-course rollup. Any mutation that can change a record visible in either
 * rollup must invalidate them, otherwise the aggregate keeps rendering stale
 * counts until a hard reload.
 *
 * React Query only refetches *active* queries by default, so invalidating a
 * rollup that is not currently mounted costs nothing.
 */
export const ROLLUP_QUERY_KEYS = ["dashboard", "course-summary"] as const;

/** Invalidates every cross-system rollup. */
export function invalidateRollups(qc: QueryClient) {
  for (const rollupKey of ROLLUP_QUERY_KEYS) {
    qc.invalidateQueries({ queryKey: [rollupKey] });
  }
}

/**
 * Invalidates a module's own list/detail cache plus every rollup that can
 * include its records. Use this instead of invalidating a single module key so
 * a mutation cannot silently leave the dashboard or course hub stale.
 */
export function invalidateModule(qc: QueryClient, moduleKey: string) {
  qc.invalidateQueries({ queryKey: [moduleKey] });
  invalidateRollups(qc);
}
