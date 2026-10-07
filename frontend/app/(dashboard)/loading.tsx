"use client";

import { Suspense } from "react";

import { ErrorBoundary } from "@/components/states";
import { ListSkeleton } from "@/components/feedback";

export const dynamic = "force-dynamic";

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<ListSkeleton rows={3} label="Loading page" />}>{children}</Suspense>
    </ErrorBoundary>
  );
}