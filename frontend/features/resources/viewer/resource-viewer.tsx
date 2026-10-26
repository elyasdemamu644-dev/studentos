"use client";

import type { ResourceClassification } from "@tutor-walle/shared/schemas/resource-viewer";
import type { ResourceProgress, ResourceRecord } from "@/types/api-types";
import { ArchiveViewer } from "./archive-viewer";
import { DocxViewer } from "./docx-viewer";
import { ImageViewer } from "./image-viewer";
import { LinkViewer } from "./link-viewer";
import { MediaViewer } from "./media-viewer";
import { PdfViewer } from "./pdf-viewer";
import { PptxViewer } from "./pptx-viewer";
import { SpreadsheetViewer } from "./spreadsheet-viewer";
import { TextViewer } from "./text-viewer";
import { UnsupportedResourceViewer } from "./unsupported-viewer";
import type { JumpTarget, ViewerLocation } from "./types";

export interface ResourceViewerProps {
  resource: ResourceRecord;
  classification: ResourceClassification;
  blob: Blob | null;
  progress: ResourceProgress;
  jumpTarget: JumpTarget | null;
  onLocationChange: (location: ViewerLocation) => void;
  onDownload?: () => void;
  downloading?: boolean;
}

export function ResourceViewer({
  resource,
  classification,
  blob,
  progress,
  jumpTarget,
  onLocationChange,
  onDownload,
  downloading,
}: ResourceViewerProps) {
  const fileName = resource.fileName ?? resource.title;

  if (classification.kind === "link") {
    return (
      <LinkViewer
        resourceId={resource.id}
        fileName={fileName}
        blob={blob ?? new Blob()}
        progress={progress}
        jumpTarget={jumpTarget}
        onLocationChange={onLocationChange}
      />
    );
  }

  if (classification.kind === "unsupported") {
    return (
      <UnsupportedResourceViewer
        label={classification.label}
        reason={classification.reason}
        fileName={fileName}
        fileSize={resource.fileSize}
        onDownload={onDownload}
        downloading={downloading}
      />
    );
  }

  if (!blob) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/30 text-sm text-muted-foreground">
        Loading file…
      </div>
    );
  }

  const shared = {
    resourceId: resource.id,
    fileName,
    blob,
    progress,
    jumpTarget,
    onLocationChange,
  };

  switch (classification.kind) {
    case "pdf":
      return <PdfViewer {...shared} />;
    case "docx":
      return <DocxViewer {...shared} />;
    case "pptx":
      return <PptxViewer {...shared} />;
    case "spreadsheet":
      return <SpreadsheetViewer {...shared} />;
    case "image":
      return <ImageViewer {...shared} />;
    case "audio":
    case "video":
      return <MediaViewer {...shared} />;
    case "markdown":
    case "text":
      return <TextViewer {...shared} />;
    case "archive":
      return <ArchiveViewer {...shared} />;
  }

  return null;
}
