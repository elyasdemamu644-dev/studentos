import { ListSkeleton } from "@/components/feedback";

/**
 * Route-segment loading fallback for the dashboard group. Next.js renders this
 * while a page under `(dashboard)` streams in. It is not a layout: it takes no
 * children. (It previously wrapped `undefined` in a Suspense and an
 * ErrorBoundary — both already provided by `layout.tsx` — so it showed nothing.)
 */
export default function DashboardLoading() {
  return <ListSkeleton rows={3} label="Loading page" />;
}
