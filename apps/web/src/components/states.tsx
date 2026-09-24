"use client";

import ErrorBoundary from "./error-boundary";

export function formatApiError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Something went wrong";
}

export function ErrorAlert({ error, retry, className }: { error: unknown; retry?: () => void; className?: string }) {
  const message = formatApiError(error);
  return (
    <div
      role="alert"
      className={`rounded-xl border border-danger/30 bg-danger/5 p-6 text-center ${className ?? ""}`}
    >
      <p className="font-medium text-danger">{message}</p>
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="mt-3 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-danger/90"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return <ErrorAlert error={error} retry={retry} />;
}

export { ErrorBoundary };