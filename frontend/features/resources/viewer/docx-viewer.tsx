"use client";

import { useEffect, useRef, useState } from "react";
import { Expand, Loader2, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ViewerProps } from "./types";

export function DocxViewer({ blob, fileName, progress, onLocationChange }: ViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(progress.completed);
  const lastReportRef = useRef(0);
  const resumePercentRef = useRef(progress.percent ?? 0);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        await renderAsync(blob, container, undefined, {
          className: "docx",
          inWrapper: false,
          breakPages: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
        });
        if (cancelled) return;
        setLoading(false);

        // Resume at the last scroll position. `renderAsync` inserts content in
        // the same tick, so one frame is enough for the scroll height to exist.
        requestAnimationFrame(() => {
          const scroll = scrollRef.current;
          if (!scroll) return;
          const max = scroll.scrollHeight - scroll.clientHeight;
          if (max > 0 && resumePercentRef.current > 0) {
            scroll.scrollTop = (resumePercentRef.current / 100) * max;
          }
        });
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "This Word document could not be rendered.",
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blob]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const reportScroll = () => {
    const scroll = scrollRef.current;
    if (!scroll || loading) return;
    const now = Date.now();
    if (now - lastReportRef.current < 450) return;
    lastReportRef.current = now;
    const max = scroll.scrollHeight - scroll.clientHeight;
    const percent = max > 0 ? Math.min(100, Math.round(((scroll.scrollTop + scroll.clientHeight) / scroll.scrollHeight) * 100)) : 0;
    const completed = !completedRef.current && max > 0 && percent >= 95;
    if (completed) completedRef.current = true;
    onLocationChange({
      percent,
      ...(completed ? { completed: true } : {}),
      label: max > 0 ? `${percent}% read` : "Document",
    });
  };

  const toggleFullscreen = () => {
    if (!stageRef.current) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current.requestFullscreen?.();
  };

  return (
    <div ref={stageRef} className="flex h-full min-h-0 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/95 px-2 py-1.5">
        <div className="flex items-center rounded-md border border-border">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => setScale((value) => Math.max(0.5, value - 0.1))}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </Button>
          <span className="min-w-11 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => setScale((value) => Math.min(2, value + 0.1))}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setScale(1)}>
          Reset zoom
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
        >
          <Expand className="h-4 w-4" aria-hidden />
        </Button>
        <span className="ml-auto hidden max-w-[40%] truncate text-xs text-muted-foreground sm:block" title={fileName}>
          {fileName}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto p-4"
        onScroll={reportScroll}
        aria-label="Word document"
      >
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Rendering document…
          </div>
        )}
        {error && (
          <div className="mx-auto max-w-md rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {error}
          </div>
        )}
        <div
          ref={containerRef}
          className="docx-reader mx-auto max-w-[860px] bg-white shadow-pop"
          style={{ zoom: scale } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
