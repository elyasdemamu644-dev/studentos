"use client";

import { useEffect, useMemo, useState } from "react";
import { Expand, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ViewerProps } from "./types";

interface SheetData {
  name: string;
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

const MAX_ROWS = 2000;
const MAX_COLUMNS = 40;
const INITIAL_ROWS = 200;

export function SpreadsheetViewer({
  blob,
  fileName,
  progress,
  jumpTarget,
  onLocationChange,
}: ViewerProps) {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [active, setActive] = useState(0);
  const [visibleRows, setVisibleRows] = useState(INITIAL_ROWS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
        const parsed: SheetData[] = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name];
          if (!sheet) return { name, rows: [], totalRows: 0, truncated: false };
          const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            blankrows: false,
            defval: "",
            raw: false,
          });
          const rows = values
            .slice(0, MAX_ROWS)
            .map((row) =>
              (Array.isArray(row) ? row : [row])
                .slice(0, MAX_COLUMNS)
                .map((cell) => (cell == null ? "" : String(cell))),
            );
          return {
            name,
            rows,
            totalRows: values.length,
            truncated: values.length > MAX_ROWS || values.some((row) => Array.isArray(row) && row.length > MAX_COLUMNS),
          };
        });
        if (cancelled) return;
        setSheets(parsed);
        const initial = Math.min(Math.max(progress.page ?? 1, 1), Math.max(parsed.length, 1)) - 1;
        setActive(initial);
        setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "This spreadsheet could not be read. It may be corrupted or password-protected.",
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Progress only supplies the initial sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (jumpTarget?.page == null || sheets.length === 0) return;
    setActive(Math.min(Math.max(jumpTarget.page, 1), sheets.length) - 1);
    setVisibleRows(INITIAL_ROWS);
  }, [jumpTarget?.nonce, jumpTarget?.page, sheets.length]);

  useEffect(() => {
    if (sheets.length === 0) return;
    onLocationChange({
      page: active + 1,
      percent: Math.round(((active + 1) / sheets.length) * 100),
      label: `Sheet ${active + 1} of ${sheets.length}: ${sheets[active]?.name ?? ""}`,
    });
  }, [active, sheets, onLocationChange]);

  const sheet = sheets[active];
  const rows = useMemo(() => sheet?.rows ?? [], [sheet]);
  const header = rows[0] ?? [];
  const columnCount = Math.max(1, ...rows.slice(0, visibleRows).map((row) => row.length));
  const visible = rows.slice(0, visibleRows);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/95 px-2 py-1.5">
        {sheets.length > 1 && (
          <div className="flex items-center gap-1 overflow-x-auto">
            {sheets.map((item, index) => (
              <button
                key={item.name}
                type="button"
                onClick={() => {
                  setActive(index);
                  setVisibleRows(INITIAL_ROWS);
                }}
                className={cn(
                  "whitespace-nowrap rounded px-2 py-1 text-xs",
                  index === active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
                aria-pressed={index === active}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
        <span className="ml-1 text-xs text-muted-foreground">
          {sheet ? `${Math.min(visibleRows, sheet.totalRows)} of ${sheet.totalRows} rows` : "No sheet"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
        >
          <Expand className="h-4 w-4" aria-hidden />
        </Button>
        <span className="hidden max-w-[35%] truncate text-xs text-muted-foreground sm:block" title={fileName}>
          {fileName}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Reading spreadsheet…
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {error}
          </div>
        ) : !sheet || rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            This sheet is empty.
          </div>
        ) : (
          <div className="p-3">
            <table
              className="min-w-full border-collapse bg-white text-xs text-slate-900 shadow-sm"
              aria-label={`Sheet ${sheet.name}`}
            >
              {header.length > 0 && (
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    {Array.from({ length: columnCount }, (_, index) => (
                      <th
                        key={index}
                        scope="col"
                        className="max-w-[260px] truncate border border-border px-2 py-1 text-left font-semibold"
                      >
                        {header[index] || ""}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {visible.slice(header.length > 0 ? 1 : 0).map((row, rowIndex) => (
                  <tr key={rowIndex} className="odd:bg-muted/20">
                    {Array.from({ length: columnCount }, (_, columnIndex) => (
                      <td
                        key={columnIndex}
                        className="max-w-[260px] whitespace-pre-wrap break-words border border-border px-2 py-1 align-top"
                      >
                        {row[columnIndex] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {visibleRows < rows.length && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleRows((value) => Math.min(value + 300, rows.length))}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Show more rows
                </Button>
              )}
              {sheet.truncated && (
                <p className="text-xs text-muted-foreground">
                  Large sheet: showing up to {MAX_ROWS} rows and {MAX_COLUMNS} columns. Download the file for the
                  full workbook.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
