"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Check,
  Copy,
  Globe2,
  Loader2,
  Link2,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useResourceLinkPreview } from "../hooks";
import type { ViewerProps } from "./types";

export function LinkViewer({ resourceId, fileName }: ViewerProps) {
  const preview = useResourceLinkPreview(resourceId);
  const [copied, setCopied] = useState(false);
  const data = preview.data;

  const copy = async () => {
    if (!data?.url) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied; the link itself is still selectable.
    }
  };

  if (preview.isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/30 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Fetching link preview…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-muted/30 p-4 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <div className="surface-panel overflow-hidden">
          <div className="border-b border-border bg-primary/5 p-5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Globe2 className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {data?.siteName ?? "Saved web link"}
            </p>
            <h2 className="mt-1 text-xl font-semibold leading-snug">
              {data?.title || fileName}
            </h2>
            {data?.url && (
              <p className="mt-1 break-all text-xs text-muted-foreground">{data.url}</p>
            )}
          </div>

          <div className="space-y-4 p-5">
            {preview.isError ? (
              <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                The preview could not be loaded. You can still open the link in a new tab.
              </div>
            ) : data && !data.available ? (
              <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-medium">No preview available</p>
                  <p className="mt-0.5 text-xs">{data.reason ?? "This page could not be read."}</p>
                </div>
              </div>
            ) : data?.description ? (
              <p className="text-sm leading-relaxed text-muted-foreground">{data.description}</p>
            ) : null}

            {data?.excerpt && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Page excerpt
                </p>
                <p className="line-clamp-6 text-xs leading-relaxed text-muted-foreground">
                  {data.excerpt}
                  {data.truncated ? "…" : ""}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {data?.url && (
                <Button asChild size="sm">
                  <a href={data.url} target="_blank" rel="noopener noreferrer">
                    Open link
                    <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                  </a>
                </Button>
              )}
              {data?.url && (
                <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                  {copied ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy link"}
                </Button>
              )}
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/ai?resourceId=${resourceId}&prompt=${encodeURIComponent(
                    "Read this saved link and give me a concise overview with the key points, then suggest three questions to test my understanding.",
                  )}`}
                >
                  <Bot className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Study with AI
                </Link>
              </Button>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
              <p>
                Tutor Walle does not embed third-party pages. The preview is plain extracted text,
                and the site opens in a new tab. When you attach this link in the AI Assistant, its
                readable text is fetched for that conversation.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" aria-hidden />
          Saved link
        </div>
      </div>
    </div>
  );
}
