"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  List,
  Loader2,
  Minus,
  PanelLeft,
  Plus,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ViewerProps } from "./types";

interface PdfOutlineItem {
  title: string;
  page: number | null;
  items: PdfOutlineItem[];
}

interface SearchHit {
  page: number;
  snippet: string;
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;

export function PdfViewer({
  blob,
  fileName,
  progress,
  jumpTarget,
  onLocationChange,
}: ViewerProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.1);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseWidth, setBaseWidth] = useState(612);
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false);
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pageInput, setPageInput] = useState("1");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const resumedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let documentProxy: PDFDocumentProxy | null = null;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const data = new Uint8Array(await blob.arrayBuffer());
        const task = pdfjs.getDocument({ data });
        documentProxy = await task.promise;
        if (cancelled) {
          void documentProxy.destroy();
          return;
        }
        setPdf(documentProxy);
        setPageCount(documentProxy.numPages);
        const start = Math.min(Math.max(progress.page ?? 1, 1), documentProxy.numPages);
        setPageNumber(start);
        setPageInput(String(start));
        resumedRef.current = true;

        try {
          const raw = await documentProxy.getOutline();
          if (!cancelled && raw) {
            setOutline(await resolveOutline(documentProxy, raw));
          }
        } catch {
          // An outline is optional; a malformed one must not block the reader.
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "This PDF could not be opened. It may be password-protected or damaged.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (documentProxy) void documentProxy.destroy();
    };
    // The blob identity is the document. Progress is only the initial resume
    // point, read once on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let textLayer: { cancel: () => void } | null = null;

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;

        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const task = page.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        renderTask = task;
        await task.promise;
        if (cancelled) return;

        setPageSize({ width: viewport.width, height: viewport.height });
        setBaseWidth(page.getViewport({ scale: 1 }).width);

        const textContent = await page.getTextContent();
        if (cancelled) return;
        const container = textLayerRef.current;
        if (container) {
          container.replaceChildren();
          container.style.width = `${viewport.width}px`;
          container.style.height = `${viewport.height}px`;
          container.style.setProperty("--scale-factor", String(viewport.scale));
          const pdfjs = await import("pdfjs-dist");
          const layer = new pdfjs.TextLayer({
            textContentSource: textContent,
            container,
            viewport,
          });
          textLayer = layer;
          await layer.render();
        }
      } catch (cause) {
        if (!cancelled) {
          const name = (cause as { name?: string })?.name;
          if (name !== "RenderingCancelledException") {
            setError("This page could not be rendered.");
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, pageNumber, scale]);

  useEffect(() => {
    if (!pdf || pageCount === 0) return;
    const percent = Math.round((pageNumber / pageCount) * 100);
    onLocationChange({
      page: pageNumber,
      percent,
      label: `Page ${pageNumber} of ${pageCount}`,
    });
    setPageInput(String(pageNumber));
  }, [pdf, pageNumber, pageCount, onLocationChange]);

  useEffect(() => {
    if (jumpTarget?.page == null || !pdf) return;
    const target = Math.min(Math.max(jumpTarget.page, 1), pdf.numPages);
    setPageNumber(target);
  }, [jumpTarget?.nonce, jumpTarget?.page, pdf]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const goToPage = useCallback(
    (value: number) => {
      if (!pdf) return;
      setPageNumber(Math.min(Math.max(Math.round(value), 1), pdf.numPages));
    },
    [pdf],
  );

  const fitWidth = useCallback(() => {
    const available = (scrollRef.current?.clientWidth ?? 900) - 64;
    if (available <= 0) return;
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, available / baseWidth)));
  }, [baseWidth]);

  const runSearch = useCallback(async () => {
    const term = query.trim().toLowerCase();
    if (!pdf || !term) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const hits: SearchHit[] = [];
      const maxPages = Math.min(pdf.numPages, 250);
      for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
        const page = await pdf.getPage(pageIndex);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : " "))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const at = text.toLowerCase().indexOf(term);
        if (at >= 0) {
          const start = Math.max(0, at - 55);
          hits.push({
            page: pageIndex,
            snippet: `${start > 0 ? "…" : ""}${text.slice(start, at + term.length + 80)}${
              at + term.length + 80 < text.length ? "…" : ""
            }`,
          });
        }
        if (hits.length >= 40) break;
      }
      setResults(hits);
    } finally {
      setSearching(false);
    }
  }, [pdf, query]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      goToPage(pageNumber + 1);
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      goToPage(pageNumber - 1);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setScale((value) => Math.min(MAX_SCALE, value + 0.15));
    } else if (event.key === "-") {
      event.preventDefault();
      setScale((value) => Math.max(MIN_SCALE, value - 0.15));
    }
  };

  const toggleFullscreen = () => {
    if (!stageRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stageRef.current.requestFullscreen?.();
    }
  };

  return (
    <div ref={stageRef} className="flex h-full min-h-0 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/95 px-2 py-1.5">
        <Button
          variant={thumbnailsOpen ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label="Toggle page thumbnails"
          aria-pressed={thumbnailsOpen}
          onClick={() => setThumbnailsOpen((value) => !value)}
        >
          <PanelLeft className="h-4 w-4" aria-hidden />
        </Button>

        <div className="flex items-center rounded-md border border-border">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={pageNumber <= 1}
            onClick={() => goToPage(pageNumber - 1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <form
            className="flex items-center gap-1 px-1 text-xs"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(pageInput);
              if (Number.isFinite(value)) goToPage(value);
            }}
          >
            <input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              className="w-10 rounded border border-border bg-background px-1 py-0.5 text-center"
              aria-label="Page number"
              inputMode="numeric"
            />
            <span className="text-muted-foreground">/ {pageCount || "–"}</span>
          </form>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={pageCount === 0 || pageNumber >= pageCount}
            onClick={() => goToPage(pageNumber + 1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="flex items-center rounded-md border border-border">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => setScale((value) => Math.max(MIN_SCALE, value - 0.15))}
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
            onClick={() => setScale((value) => Math.min(MAX_SCALE, value + 0.15))}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <Button variant="ghost" size="sm" onClick={fitWidth}>
          Fit width
        </Button>
        <Button
          variant={outlineOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setOutlineOpen((value) => !value)}
          disabled={outline.length === 0}
        >
          <List className="mr-1 h-4 w-4" aria-hidden /> Outline
        </Button>
        <Button
          variant={searchOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSearchOpen((value) => !value)}
        >
          <Search className="mr-1 h-4 w-4" aria-hidden /> Find
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
        >
          <Expand className="h-4 w-4" aria-hidden />
        </Button>
        <span className="ml-auto hidden max-w-[28%] truncate text-xs text-muted-foreground sm:block" title={fileName}>
          {fileName}
        </span>
      </div>

      {searchOpen && (
        <div className="border-b border-border bg-background px-3 py-2">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this PDF…"
              className="h-8 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm"
              aria-label="Search this PDF"
            />
            <Button type="submit" size="sm" disabled={searching || !query.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Search"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setResults([]);
              }}
            >
              Clear
            </Button>
          </form>
          {results.length > 0 && (
            <ul className="mt-2 max-h-36 space-y-1 overflow-auto" aria-label="Search results">
              {results.map((hit) => (
                <li key={hit.page}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
                    onClick={() => goToPage(hit.page)}
                  >
                    <span className="font-medium text-primary">Page {hit.page}</span>{" "}
                    <span className="text-muted-foreground">{hit.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!searching && query.trim() && results.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">No matches on the first 250 pages.</p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {thumbnailsOpen && (
          <aside className="hidden w-32 shrink-0 overflow-y-auto border-r border-border bg-background p-2 sm:block" aria-label="Page thumbnails">
            {pdf &&
              Array.from({ length: Math.min(pageCount, 120) }, (_, index) => (
                <PdfThumbnail
                  key={index + 1}
                  pdf={pdf}
                  pageNumber={index + 1}
                  active={pageNumber === index + 1}
                  onClick={() => goToPage(index + 1)}
                />
              ))}
            {pageCount > 120 && (
              <p className="p-1 text-[10px] text-muted-foreground">Thumbnails limited to the first 120 pages.</p>
            )}
          </aside>
        )}

        {outlineOpen && outline.length > 0 && (
          <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-background p-2 md:block" aria-label="Document outline">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outline</span>
              <button type="button" onClick={() => setOutlineOpen(false)} aria-label="Close outline">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <OutlineList items={outline} onSelect={goToPage} />
          </aside>
        )}

        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-auto p-4 focus:outline-none"
          onKeyDown={onKeyDown}
          tabIndex={0}
          aria-label="PDF document"
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Opening PDF…
            </div>
          ) : error ? (
            <div className="mx-auto max-w-md rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
              {error}
            </div>
          ) : (
            <div className="mx-auto w-fit">
              <div
                className="relative bg-white shadow-pop"
                style={{
                  width: pageSize?.width ?? undefined,
                  height: pageSize?.height ?? undefined,
                }}
              >
                <canvas ref={canvasRef} className="block" aria-label={`Page ${pageNumber}`} />
                <div ref={textLayerRef} className="pdf-text-layer" />
              </div>
            </div>
          )}

          {progress.completed && (
            <span className="pointer-events-none absolute right-4 top-3 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
              Completed
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function PdfThumbnail({
  pdf,
  pageNumber,
  active,
  onClick,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 0.18 });
        const canvas = ref.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const rendering = page.render({ canvasContext: context, viewport });
        task = rendering;
        await rendering.promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mb-2 block w-full rounded border p-1 transition-colors",
        active ? "border-primary bg-primary/5" : "border-transparent hover:border-border",
      )}
      aria-label={`Go to page ${pageNumber}`}
      aria-current={active ? "page" : undefined}
    >
      {failed ? (
        <span className="flex h-28 items-center justify-center text-[10px] text-muted-foreground">
          Page {pageNumber}
        </span>
      ) : (
        <canvas ref={ref} className="mx-auto block max-w-full bg-white" />
      )}
      <span className="mt-1 block text-center text-[10px] text-muted-foreground">{pageNumber}</span>
    </button>
  );
}

function OutlineList({
  items,
  onSelect,
  depth = 0,
}: {
  items: PdfOutlineItem[];
  onSelect: (page: number) => void;
  depth?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`}>
          <button
            type="button"
            className="w-full rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
            style={{ paddingLeft: 6 + depth * 10 }}
            onClick={() => item.page != null && onSelect(item.page)}
            disabled={item.page == null}
          >
            {item.title}
          </button>
          {item.items.length > 0 && <OutlineList items={item.items} onSelect={onSelect} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

interface RawOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items?: RawOutlineItem[];
}

async function resolveOutline(
  pdf: PDFDocumentProxy,
  raw: RawOutlineItem[],
): Promise<PdfOutlineItem[]> {
  const resolved: PdfOutlineItem[] = [];
  for (const item of raw) {
    let page: number | null = null;
    try {
      const destination =
        typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      if (Array.isArray(destination) && destination.length > 0) {
        const reference = destination[0] as Parameters<PDFDocumentProxy["getPageIndex"]>[0];
        page = (await pdf.getPageIndex(reference)) + 1;
      }
    } catch {
      page = null;
    }
    resolved.push({
      title: item.title,
      page,
      items: item.items ? await resolveOutline(pdf, item.items) : [],
    });
  }
  return resolved;
}
