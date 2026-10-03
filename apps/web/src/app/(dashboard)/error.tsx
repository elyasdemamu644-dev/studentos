"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="mt-4 text-xl font-semibold">Something went wrong on this page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The page couldn’t be loaded. You can try again, or head back to the last working view.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => reset()}>
          <ArrowRight className="mr-1.5 h-4 w-4 rotate-180" aria-hidden /> Try again
        </Button>
        <Button variant="outline" onClick={() => router.push("/dashboard")}>
          Go to dashboard
        </Button>
        <Button variant="ghost" onClick={() => router.replace(pathname)}>
          Reload this page
        </Button>
      </div>
    </div>
  );
}