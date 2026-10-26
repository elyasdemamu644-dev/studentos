"use client";

import { useEffect, useMemo, useState } from "react";
import type JSZip from "jszip";
import {
  ChevronRight,
  Download,
  FileArchive,
  FileText,
  Folder,
  Loader2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveBlob, type ViewerProps } from "./types";

const TEXT_ENTRY = /\.(txt|md|markdown|csv|json|xml|html|css|js|ts|tsx|jsx|py|java|c|cpp|h|log|yml|yaml)$/i;
const MAX_TEXT_ENTRY = 200_000;

interface ArchiveEntry {
  object: JSZip.JSZipObject;
  name: string;
  directory: boolean;
  date: Date | null;
}

export function ArchiveViewer({ blob, fileName }: ViewerProps) {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; text: string; truncated: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries([]);
    setPreview(null);
    void (async () => {
      try {
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        if (cancelled) return;
        const loaded: ArchiveEntry[] = [];
        zip.forEach((relativePath, object) => {
          loaded.push({
            object,
            name: relativePath,
            directory: object.dir,
            date: object.date instanceof Date ? object.date : null,
          });
        });
        loaded.sort((a, b) => {
          if (a.directory !== b.directory) return a.directory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(loaded);
        setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : "";
          setError(
            /encrypt/i.test(message)
              ? "This ZIP is password-protected and cannot be opened here. Download it and open it with an archive tool."
              : "This ZIP could not be read. It may be damaged or use an unsupported compression method.",
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  const fileCount = useMemo(() => entries.filter((entry) => !entry.directory).length, [entries]);

  const openEntry = async (entry: ArchiveEntry) => {
    if (entry.directory) return;
    setPreviewing(true);
    try {
      const text = await entry.object.async("string");
      setPreview({
        name: entry.name,
        text: text.slice(0, MAX_TEXT_ENTRY),
        truncated: text.length > MAX_TEXT_ENTRY,
      });
    } catch {
      setPreview({
        name: entry.name,
        text: "This entry could not be read as text. Download the archive to open the file.",
        truncated: false,
      });
    } finally {
      setPreviewing(false);
    }
  };

  const downloadEntry = async (entry: ArchiveEntry) => {
    const buffer = await entry.object.async("arraybuffer");
    saveBlob(new Blob([buffer]), entry.name.split("/").pop() || entry.name);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5">
        <FileArchive className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">
          {loading ? "Reading archive…" : `${fileCount} file${fileCount === 1 ? "" : "s"}`}
        </span>
        <span className="ml-auto hidden max-w-[45%] truncate text-xs text-muted-foreground sm:block" title={fileName}>
          {fileName}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Reading archive…
            </div>
          ) : error ? (
            <div className="m-3 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">This archive is empty.</p>
          ) : (
            <ul className="space-y-0.5" aria-label="Archive contents">
              {entries.map((entry) => {
                const selectable = !entry.directory && TEXT_ENTRY.test(entry.name);
                return (
                  <li key={entry.name}>
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                        selectable ? "hover:bg-muted" : "",
                      )}
                    >
                      {entry.directory ? (
                        <Folder className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <button
                        type="button"
                        className={cn(
                          "min-w-0 flex-1 truncate text-left",
                          selectable ? "hover:text-primary" : "cursor-default text-muted-foreground",
                        )}
                        onClick={() => selectable && void openEntry(entry)}
                        disabled={!selectable}
                        title={entry.name}
                      >
                        {entry.name}
                      </button>
                      {!entry.directory && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Extract ${entry.name}`}
                          onClick={() => void downloadEntry(entry)}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      )}
                      {selectable && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {(preview || previewing) && (
          <aside className="flex w-1/2 min-w-0 max-w-xl shrink-0 flex-col border-l border-border bg-background">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-xs font-medium" title={preview?.name}>
                {previewing ? "Opening…" : preview?.name}
              </p>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close preview"
                onClick={() => setPreview(null)}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            {previewing ? (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Reading entry…
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                  {preview?.text}
                </pre>
                {preview?.truncated && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Preview truncated. Extract the file to see the whole entry.
                  </p>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
