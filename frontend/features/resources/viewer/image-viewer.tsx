"use client";

import { useEffect, useState } from "react";
import { Expand, ImageOff, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ViewerProps } from "./types";

export function ImageViewer({ blob, fileName, onLocationChange }: ViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    setFailed(false);
    setZoom(1);
    setRotation(0);
    onLocationChange({ percent: 100, label: "Image" });
    return () => URL.revokeObjectURL(objectUrl);
    // The blob identity is the image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/95 px-2 py-1.5">
        <div className="flex items-center rounded-md border border-border">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => setZoom((value) => Math.max(0.25, value - 0.15))}
          >
            <ZoomOut className="h-4 w-4" aria-hidden />
          </Button>
          <span className="min-w-11 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => setZoom((value) => Math.min(5, value + 0.15))}
          >
            <ZoomIn className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRotation((value) => (value + 90) % 360)}
        >
          <RotateCw className="mr-1 h-4 w-4" aria-hidden /> Rotate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setZoom(1);
            setRotation(0);
          }}
        >
          Reset
        </Button>
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

      <div className="viewer-checkerboard relative min-h-0 flex-1 overflow-auto p-6">
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <ImageOff className="mb-2 h-8 w-8" aria-hidden />
            <p className="text-sm">This image could not be displayed. Download it to open it locally.</p>
          </div>
        ) : url ? (
          <div className="flex min-h-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={fileName}
              onError={() => setFailed(true)}
              className={cn(
                "max-w-none rounded bg-white shadow-pop transition-transform",
                zoom <= 1 && "max-h-[calc(100dvh-12rem)] max-w-full object-contain",
              )}
              style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
