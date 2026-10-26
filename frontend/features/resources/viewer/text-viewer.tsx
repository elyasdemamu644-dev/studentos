"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, FileCode2, Loader2, Minus, Plus, WrapText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ViewerProps } from "./types";

const MAX_RENDER_CHARS = 2_000_000;

export function TextViewer({
  blob,
  fileName,
  progress,
  onLocationChange,
}: ViewerProps) {
  const isMarkdown = /\.(md|markdown)$/i.test(fileName) || blob.type.includes("markdown");
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(isMarkdown);
  const [html, setHtml] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(15);
  const [wrap, setWrap] = useState(true);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastReportRef = useRef(0);
  const completedRef = useRef(progress.completed);
  const resumedRef = useRef(false);
  const resumePercentRef = useRef(progress.percent ?? 0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setText(null);
    setHtml(null);
    void (async () => {
      try {
        const content = await blob.text();
        if (cancelled) return;
        if (content.length > MAX_RENDER_CHARS) {
          setText(content.slice(0, MAX_RENDER_CHARS));
          setError(
            `This file is very large, so only the first ${MAX_RENDER_CHARS.toLocaleString()} characters are shown. Download it to read the rest.`,
          );
        } else {
          setText(content);
        }
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("This file could not be read as text.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  useEffect(() => {
    if (!isMarkdown || !rendered || text == null) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [{ marked }, { default: DOMPurify }] = await Promise.all([
          import("marked"),
          import("dompurify"),
        ]);
        const parsed = await Promise.resolve(marked.parse(text, { gfm: true, breaks: true }));
        if (!cancelled) setHtml(DOMPurify.sanitize(parsed, { USE_PROFILES: { html: true } }));
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMarkdown, rendered, text]);

  const lineCount = useMemo(() => (text ? text.split(/\r\n|\r|\n/).length : 0), [text]);

  const reportScroll = (force = false) => {
    const scroll = scrollRef.current;
    if (!scroll || loading) return;
    const now = Date.now();
    if (!force && now - lastReportRef.current < 450) return;
    lastReportRef.current = now;
    const max = scroll.scrollHeight - scroll.clientHeight;
    const percent =
      max > 0
        ? Math.min(100, Math.round(((scroll.scrollTop + scroll.clientHeight) / scroll.scrollHeight) * 100))
        : 100;
    const complete = !completedRef.current && max > 0 && percent >= 95;
    if (complete) completedRef.current = true;
    onLocationChange({
      percent,
      label: max > 0 ? `${percent}% read` : "Document",
      ...(complete ? { completed: true } : {}),
    });
  };

  useEffect(() => {
    const contentReady = text != null && (!isMarkdown || !rendered || html != null);
    if (loading || !contentReady || resumedRef.current) return;
    resumedRef.current = true;
    requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const max = scroll.scrollHeight - scroll.clientHeight;
      if (max > 0 && resumePercentRef.current > 0) {
        scroll.scrollTop = (resumePercentRef.current / 100) * max;
      }
      reportScroll(true);
    });
    // Initial resume only; progress is not a controlled value here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, text, html, isMarkdown, rendered]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/95 px-2 py-1.5">
        {isMarkdown && (
          <Button
            variant={rendered ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setRendered((value) => !value)}
            aria-pressed={rendered}
          >
            {rendered ? <Eye className="mr-1 h-4 w-4" aria-hidden /> : <FileCode2 className="mr-1 h-4 w-4" aria-hidden />}
            {rendered ? "Rendered" : "Source"}
          </Button>
        )}
        <div className="flex items-center rounded-md border border-border">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Decrease font size"
            onClick={() => setFontSize((value) => Math.max(11, value - 1))}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </Button>
          <span className="min-w-10 text-center text-xs tabular-nums text-muted-foreground">
            {fontSize}px
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Increase font size"
            onClick={() => setFontSize((value) => Math.min(24, value + 1))}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <Button
          variant={wrap ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setWrap((value) => !value)}
          aria-pressed={wrap}
        >
          <WrapText className="mr-1 h-4 w-4" aria-hidden /> Wrap
        </Button>
        <span className="ml-auto hidden max-w-[35%] truncate text-xs text-muted-foreground sm:block" title={fileName}>
          {fileName}
        </span>
        {lineCount > 0 && (
          <span className="text-xs text-muted-foreground">{lineCount.toLocaleString()} lines</span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={() => reportScroll()}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Reading file…
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl p-5 sm:p-8">
            {error && (
              <p className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                {error}
              </p>
            )}
            {text == null ? null : isMarkdown && rendered && html ? (
              <article
                className="resource-markdown"
                style={{ fontSize }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <pre
                className={cn(
                  "whitespace-pre font-mono leading-relaxed text-foreground",
                  wrap && "whitespace-pre-wrap break-words",
                )}
                style={{ fontSize }}
              >
                {text}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
