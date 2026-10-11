"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bot,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Paperclip,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import { Panel } from "@/components/panel";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDeleteResource, useDownloadResource, useResources } from "./hooks";
import { MaterialUploadDialog } from "./material-upload";
import { ResourceFormDialog } from "./resource-form";
import type { ResourceRecord, ResourceType } from "@/types/api-types";
import { RESOURCE_TYPE_LABELS } from "@/lib/labels";
import { formatBytes, relativeTime } from "@/lib/format";

const EXTRACTABLE_TYPES: ResourceType[] = ["PDF", "DOCUMENT", "OTHER"]; // OTHER could be TXT/MD

const PAGE_SIZE = 20;

function isExtractable(resource: ResourceRecord): boolean {
  return resource.storageType === "UPLOAD" && EXTRACTABLE_TYPES.includes(resource.resourceType);
}
const TYPE_TONE: Record<ResourceType, string> = {
  LINK: "bg-primary/10 text-primary",
  PDF: "bg-danger/10 text-danger",
  SLIDES: "bg-warning/15 text-warning",
  VIDEO: "bg-success/10 text-success",
  AUDIO: "bg-primary/10 text-primary",
  DOCUMENT: "bg-muted text-muted-foreground",
  OTHER: "bg-muted text-muted-foreground",
};

/** Trigger a browser download for an in-memory blob. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * The course's own materials section: everything linked to this course, with
 * inline upload and authenticated download. Scoped to `courseId` on every
 * request, so a row can never belong to another course.
 */
export function CourseMaterialsPanel({ courseId }: { courseId: string }) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const resources = useResources({ courseId, limit });
  const deleteResource = useDeleteResource();
  const download = useDownloadResource();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [deleting, setDeleting] = useState<ResourceRecord | null>(null);

  const items = resources.data?.items ?? [];
  const hasMore = resources.data?.hasMore ?? false;

  const onDownload = (resource: ResourceRecord) => {
    void download
      .mutateAsync(resource)
      .then(({ blob, fileName }) => {
        saveBlob(blob, fileName ?? resource.fileName ?? resource.title);
      })
      .catch(() => {
        // The hook already raised a toast; nothing else to do here.
      });
  };

  const addActions = (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
        <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Add link
      </Button>
      <Button size="sm" onClick={() => setUploadOpen(true)}>
        <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Upload
      </Button>
    </div>
  );

  return (
    <>
      <Panel
        title="Course materials"
        icon={Paperclip}
        tone="primary"
        href={`/resources?course=${courseId}`}
        linkLabel="Library"
        collapsible={false}
        actions={addActions}
      >
        {resources.isPending ? (
          <ListSkeleton rows={3} />
        ) : resources.isError ? (
          <ErrorState error={resources.error} retry={() => resources.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Paperclip}
            title="No materials yet"
            description="Upload lecture slides, readings or past papers for this course, or save a link."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" onClick={() => setUploadOpen(true)}>
                  <Upload className="mr-1.5 h-4 w-4" aria-hidden /> Upload a file
                </Button>
                <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
                  <Link2 className="mr-1.5 h-4 w-4" aria-hidden /> Add a link
                </Button>
              </div>
            }
          />
        ) : (
          <>
            <ul className="space-y-2.5" aria-label="Course materials">
              {items.map((resource) => {
                const isUpload = resource.storageType === "UPLOAD" && Boolean(resource.fileKey);
                const sizeHint = isUpload
                  ? resource.fileSize != null
                    ? formatBytes(resource.fileSize)
                    : "Uploaded file"
                  : "Link";
                return (
                  <li
                    key={resource.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-background p-3"
                  >
                    <span
                      className={
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
                        (TYPE_TONE[resource.resourceType] ?? "bg-muted text-muted-foreground")
                      }
                      aria-hidden
                    >
                      {isUpload ? (
                        <FileText className="h-4 w-4" />
                      ) : (
                        <Link2 className="h-4 w-4" />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">{resource.title}</p>
                        <Badge variant="secondary" className="shrink-0">
                          {RESOURCE_TYPE_LABELS[resource.resourceType] ?? resource.resourceType}
                        </Badge>
                      </div>
                      {resource.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {resource.description}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {sizeHint} · {relativeTime(resource.createdAt)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {isUpload ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Download ${resource.title}`}
                            onClick={() => onDownload(resource)}
                          >
                            <Download className="h-4 w-4" aria-hidden />
                          </Button>
                          {isExtractable(resource) && (
                            <Link
                              href={`/ai?prompt=Analyze this material: ${encodeURIComponent(resource.title)}&resourceId=${resource.id}`}
                              className="text-primary hover:text-primary/80"
                              title="Ask AI about this material"
                            >
                              <Button variant="ghost" size="icon-sm" aria-label={`Ask AI about ${resource.title}`}>
                                <Bot className="h-4 w-4" aria-hidden />
                              </Button>
                            </Link>
                          )}
                        </>
                      ) : resource.url ? (
                        <Button asChild variant="ghost" size="icon-sm">
                          <a
                            href={resource.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${resource.title} in a new tab`}
                          >
                            <ExternalLink className="h-4 w-4" aria-hidden />
                          </a>
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${resource.title}`}
                        className="text-danger hover:text-danger"
                        onClick={() => setDeleting(resource)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {hasMore && (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLimit((value) => value + PAGE_SIZE)}
                  disabled={resources.isFetching}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Load more
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>

      <MaterialUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} courseId={courseId} />
      <ResourceFormDialog open={linkOpen} onOpenChange={setLinkOpen} defaultCourseId={courseId} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete material"
        description={
          deleting
            ? `"${deleting.title}" will be removed. ${
                deleting.storageType === "UPLOAD" ? "The stored file is deleted too. " : ""
              }This cannot be undone.`
            : undefined
        }
        busy={deleteResource.isPending}
        onConfirm={() => {
          if (!deleting) return;
          void deleteResource.mutateAsync(deleting.id).then(() => setDeleting(null));
        }}
      />
    </>
  );
}

export default CourseMaterialsPanel;
