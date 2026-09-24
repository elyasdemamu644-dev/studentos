import { redirect } from "next/navigation";
import { hasSession } from "@/lib/api/auth-session";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Client-only tokens: this runs on the server during SSR where there is no
  // session yet, so it stays on the auth screen until hydration redirects.
  if (typeof window !== "undefined" && hasSession()) {
    redirect("/dashboard");
  }
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-surface px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
          S
        </span>
        <span className="text-xl font-semibold tracking-tight">StudentOS</span>
      </div>
      <div className="w-full max-w-md animate-fade-in">{children}</div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Courses, tasks, notes, study timer, goals and analytics.
      </p>
    </div>
  );
}