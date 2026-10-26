"use client";

import { Download, FileWarning, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";

export interface UnsupportedResourceViewerProps {
  label: string;
  reason: string | null;
  fileName: string;
  fileSize?: number | null;
  downloading?: boolean;
  onDownload?: () => void;
}

export function UnsupportedResourceViewer({
  label,
  reason,
  fileName,
  fileSize,
  downloading,
  onDownload,
}: UnsupportedResourceViewerProps) {
  return (
    <div className="flex h-full items-center justify-center bg-muted/30 p-6">
      <div className="surface-panel w-full max-w-lg p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
          <FileWarning className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-lg font-semibold">Preview not available</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {reason ?? "Tutor Walle cannot display this file type in the browser yet."}
        </p>
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-left text-xs">
          <p className="truncate font-medium" title={fileName}>
            {fileName}
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {label}
            {fileSize != null ? ` · ${formatBytes(fileSize)}` : ""}
          </p>
        </div>
        {onDownload && (
          <Button className="mt-4" size="sm" onClick={onDownload} disabled={downloading}>
            {downloading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
            )}
            Download file
          </Button>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          The file stays private to your account. Downloading keeps its original format.
        </p>
      </div>
    </div>
  );
}
