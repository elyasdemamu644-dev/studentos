"use client";

import { TriangleAlert, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ErrorBoundary from "./error-boundary";

export function formatApiError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Something went wrong";
}

/**
 * A failed request.
 *
 * `cn` rather than a template literal: the old version concatenated
 * `className` onto the end, so a caller passing e.g. `p-4` could not override
 * the base `p-6`.
 */
export function ErrorAlert({
  error,
  retry,
  className,
  title = "Something went wrong",
  retryLabel = "Try again",
}: {
  error: unknown;
  retry?: () => void;
  className?: string;
  title?: string;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-danger/30 bg-danger/5 px-6 py-8 text-center",
        className,
      )}
    >
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-danger/10 text-danger">
        <TriangleAlert className="h-5 w-5" aria-hidden />
      </span>
      <p className="font-medium text-danger">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{formatApiError(error)}</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry} className="mt-4">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export function ErrorState({
  error,
  retry,
  title,
  className,
}: {
  error: unknown;
  retry?: () => void;
  title?: string;
  className?: string;
}) {
  return <ErrorAlert error={error} retry={retry} title={title} className={className} />;
}

export { ErrorBoundary };