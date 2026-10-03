import Link from "next/link";
import { Compass, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <SearchX className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        We couldn’t find that page. It may have been renamed or removed.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Button asChild>
          <Link href="/dashboard">
            <Compass className="mr-1.5 h-4 w-4" aria-hidden /> Back to dashboard
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/ai">Ask the AI assistant</Link>
        </Button>
      </div>
    </div>
  );
}