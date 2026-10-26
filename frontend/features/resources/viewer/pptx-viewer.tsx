"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ViewerProps } from "./types";

interface PptxInstance {
  preview(data: ArrayBuffer): Promise<unknown>;
  renderSingleSlide(index: number): void;
  destroy(): void;
  readonly slideCount: number;
  currentIndex: number;
}

export function PptxViewer({ blob, fileName, progress, jumpTarget, onLocationChange }: ViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState(1);
  const [slideCount, setSlideCount] = useState(0);
  const [slideInput, setSlideInput] = useState("1");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fullscreen, setFullscreen] = useState(false);

  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<PptxInstance | null>(null);
  const slideRef = useRef(1);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const available = stage.clientWidth - 32;
      if (available <= 0) return;
      const width = Math.min(1120, Math.max(280, available));
      setSize((previous) =>
        previous.width === width ? previous : { width, height: Math.round(width * 0.5625) },
      );
    };
    update();
    const observer = new ResizeObserver(() => {
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(update, 180);
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const container = mountRef.current;
    if (!container || size.width === 0) return;
    container.replaceChildren();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const { init } = await import("pptx-preview");
        if (cancelled) return;
        const instance = init(container, {
          width: size.width,
          height: size.height,
          mode: "slide",
          renderer: "html",
        }) as unknown as PptxInstance;
        instanceRef.current = instance;
        await instance.preview(await blob.arrayBuffer());
        if (cancelled) {
          instance.destroy();
          return;
        }
        const count = instance.slideCount ?? 0;
        setSlideCount(count);
        const target = Math.min(
          Math.max(slideRef.current || progress.slide || 1, 1),
          Math.max(count, 1),
        );
        if (target !== 1 && count > 0) {
          instance.renderSingleSlide(target - 1);
        }
        slideRef.current = target;
        setSlide(target);
        setSlideInput(String(target));
        setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "This presentation could not be rendered. It may use unsupported PowerPoint features.",
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
      container.replaceChildren();
    };
    // `size` changes re-lay-out the deck; `progress` is only the initial resume
    // point. Re-running on every progress save would reload the presentation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, size.width, size.height]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const goToSlide = (value: number) => {
    const instance = instanceRef.current;
    if (!instance || slideCount === 0) return;
    const target = Math.min(Math.max(Math.round(value), 1), slideCount);
    instance.renderSingleSlide(target - 1);
    slideRef.current = target;
    setSlide(target);
    setSlideInput(String(target));
    onLocationChange({
      slide: target,
      percent: Math.round((target / slideCount) * 100),
      label: `Slide ${target} of ${slideCount}`,
      ...(target === slideCount && slideCount > 1 ? { completed: true } : {}),
    });
  };

  useEffect(() => {
    if (jumpTarget?.slide == null) return;
    goToSlide(jumpTarget.slide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget?.nonce, jumpTarget?.slide]);

  useEffect(() => {
    if (!slideCount) return;
    onLocationChange({
      slide,
      percent: Math.round((slide / slideCount) * 100),
      label: `Slide ${slide} of ${slideCount}`,
    });
  }, [slide, slideCount, onLocationChange]);

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
            aria-label="Previous slide"
            disabled={slide <= 1}
            onClick={() => goToSlide(slide - 1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <form
            className="flex items-center gap-1 px-1 text-xs"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(slideInput);
              if (Number.isFinite(value)) goToSlide(value);
            }}
          >
            <input
              value={slideInput}
              onChange={(event) => setSlideInput(event.target.value)}
              className="w-10 rounded border border-border bg-background px-1 py-0.5 text-center"
              aria-label="Slide number"
              inputMode="numeric"
            />
            <span className="text-muted-foreground">/ {slideCount || "–"}</span>
          </form>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next slide"
            disabled={slideCount === 0 || slide >= slideCount}
            onClick={() => goToSlide(slide + 1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
        >
          <Expand className="h-4 w-4" aria-hidden />
        </Button>
        <span className="ml-auto hidden max-w-[45%] truncate text-xs text-muted-foreground sm:block" title={fileName}>
          {fileName}
        </span>
      </div>

      <div className="pptx-stage relative min-h-0 flex-1 overflow-auto p-4">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/30 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Rendering presentation…
          </div>
        )}
        {error && (
          <div className="mx-auto mb-3 max-w-md rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {error}
          </div>
        )}
        <div ref={mountRef} className="mx-auto w-fit" aria-label="Presentation slides" />
      </div>
    </div>
  );
}
