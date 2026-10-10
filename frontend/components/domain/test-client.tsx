"use client";

import { Sparkles } from "lucide-react";

export function TestClientComponent() {
  return (
    <section className="surface-panel relative flex-1 overflow-hidden p-5">
      <div className="relative">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
        </div>
      </div>
    </section>
  );
}