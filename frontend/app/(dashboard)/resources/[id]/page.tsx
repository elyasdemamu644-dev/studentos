"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Sparkles,
} from "lucide-react";

import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { formatBytes } from "@/lib/format";
import { classifyResourceViewer } from "@tutor-walle/shared/schemas/resource-viewer";
import {
  useDownloadResource,
  useResource,
  useResourceContent,
  useResourceProgress,
  useSaveResourceProgress,
} from "@/features/resources/hooks";
import { ResourceViewer } from "@/features/resources/viewer/resource-viewer";
import { StudyPanel } from "@/features/resources/viewer/study-panel";
import {
  EMPTY_PROGRESS,
  saveBlob,
  type JumpTarget,
  type ViewerLocation,
  type ViewerProgressUpdate,
} from "@/features/resources/viewer/types";
import type { ResourceBookmark, ResourceProgress } from "@/types/api-types";

const SAVE_DELAY_MS = 900;

function toProgressPayload(location: ViewerLocation): Partial<Omit<ResourceProgress, "updatedAt">> {
  const payload: Partial<Omit<ResourceProgress, "updatedAt">> = {};
  if (location.page !== undefined) payload.page = location.page;
  if (location.slide !== undefined) payload.slide = location.slide;
  if (location.positionSeconds !== undefined) payload.positionSeconds = location.positionSeconds;
  if (location.percent !== undefined) payload.percent = location.percent;
  if (location.completed) payload.completed = true;
  return payload;
}

function metaProgress(progress: ResourceProgress): string | null {
  if (progress.completed) return "Completed";
  if (progress.page != null) return `Page ${progress.page}`;
  if (progress.slide != null) return `Slide ${progress.slide}`;
  if (progress.percent != null) return `${progress.percent}% read`;
  return null;
}

export default function ResourceViewerPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const resourceQuery = useResource(id);
  const resource = resourceQuery.data;
  const classification = useMemo(
    () =>
      resource
        ? classifyResourceViewer({
            storageType: resource.storageType,
            mimeType: resource.mimeType,
            fileName: resource.fileName,
            resourceType: resource.resourceType,
            url: resource.url,
          })
        : null,
    [resource],
  );
  const needsBlob =
    Boolean(classification) &&
    classification!.kind !== "link" &&
    classification!.kind !== "unsupported";
  const content = useResourceContent(id, needsBlob);
  const progressQuery = useResourceProgress(id);
  const progress = progressQuery.data ?? EMPTY_PROGRESS;
  const saveProgress = useSaveResourceProgress(id);
  const { mutate: mutateProgress } = saveProgress;
  const download = useDownloadResource();

  const [location, setLocation] = useState<ViewerLocation | null>(null);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const [studyOpen, setStudyOpen] = useState(false);

  const pendingRef = useRef<ViewerProgressUpdate | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueuedRef = useRef("");

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const payload = pendingRef.current;
    if (!payload) return;
    const key = JSON.stringify(payload);
    if (key === lastQueuedRef.current) return;
    lastQueuedRef.current = key;
    mutateProgress(payload, {
      onError: () => {
        if (lastQueuedRef.current === key) lastQueuedRef.current = "";
      },
    });
  }, [mutateProgress]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    setLocation(null);
    setJumpTarget(null);
    setStudyOpen(false);
    pendingRef.current = null;
    lastQueuedRef.current = "";
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      flushRef.current();
    };
  }, [id]);

  const onLocationChange = useCallback((next: ViewerLocation) => {
    setLocation(next);
    const update = toProgressPayload(next);
    if (Object.keys(update).length === 0) return;
    const previous = pendingRef.current;
    pendingRef.current = previous?.completed
      ? { ...previous, ...update, completed: true }
      : { ...previous, ...update };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
  }, []);

  const onJump = useCallback(
    (bookmark: Pick<ResourceBookmark, "page" | "slide" | "positionSeconds">) => {
      setJumpTarget({
        page: bookmark.page,
        slide: bookmark.slide,
        positionSeconds: bookmark.positionSeconds,
        nonce: Date.now(),
      });
    },
    [],
  );

  const onDownload = useCallback(() => {
    if (!resource) return;
    void download
      .mutateAsync(resource)
      .then(({ blob, fileName }) => {
        saveBlob(blob, fileName ?? resource.fileName ?? resource.title);
      })
      .catch(() => {
        // The hook already surfaced a toast.
      });
  }, [download, resource]);

  const markComplete = useCallback(() => {
    if (!location) return;
    const payload = { ...toProgressPayload(location), completed: true };
    mutateProgress(payload);
  }, [location, mutateProgress]);

  if (resourceQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Opening resource…
      </div>
    );
  }

  if (resourceQuery.isError || !resource || !classification) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <ErrorState
          error={resourceQuery.error}
          title="Resource could not be opened"
          retry={() => void resourceQuery.refetch()}
        />
        <div className="mt-4 text-center">
          <Button asChild variant="outline" size="sm">
            <Link href="/resources">
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Back to resources
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const progressWaiting = progressQuery.isPending;
  const contentWaiting = needsBlob && content.isPending;
  const contentFailed = needsBlob && content.isError;
  const meta = [
    resource.course?.name,
    resource.fileSize != null ? formatBytes(resource.fileSize) : null,
    metaProgress(progress),
  ].filter(Boolean);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/95 px-2 py-2 sm:px-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to resources">
          <Link href="/resources">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold" title={resource.title}>
              {resource.title}
            </h1>
            <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
              {classification.label}
            </Badge>
            {progress.completed && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                <CheckCircle2 className="h-3 w-3" aria-hidden /> Completed
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {meta.length > 0 ? meta.join(" · ") : classification.label}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {resource.storageType === "UPLOAD" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDownload}
              disabled={download.isPending}
            >
              {download.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              <span className="hidden sm:inline">Download</span>
            </Button>
          )}
          {resource.url && (
            <Button asChild variant="ghost" size="sm">
              <a href={resource.url} target="_blank" rel="noopener noreferrer">
                Open
                <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden />
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="xl:hidden"
            onClick={() => setStudyOpen(true)}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Study
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-hidden" aria-label="Resource viewer">
          {progressWaiting ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Restoring your place…
            </div>
          ) : contentWaiting ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading file…
            </div>
          ) : contentFailed ? (
            <div className="h-full overflow-y-auto p-6">
              <ErrorState
                error={content.error}
                title="The file could not be loaded"
                retry={() => void content.refetch()}
              />
              {resource.storageType === "UPLOAD" && (
                <div className="mt-4 text-center">
                  <Button size="sm" onClick={onDownload} disabled={download.isPending}>
                    <Download className="mr-1.5 h-4 w-4" aria-hidden /> Download instead
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <ResourceViewer
              key={resource.id}
              resource={resource}
              classification={classification}
              blob={content.data?.blob ?? null}
              progress={progress}
              jumpTarget={jumpTarget}
              onLocationChange={onLocationChange}
              onDownload={onDownload}
              downloading={download.isPending}
            />
          )}
        </main>

        <aside className="hidden w-[360px] shrink-0 border-l border-border xl:flex">
          <StudyPanel
            resource={resource}
            progress={progress}
            location={location}
            onJump={onJump}
            onMarkComplete={markComplete}
            completing={saveProgress.isPending}
          />
        </aside>
      </div>

      <Drawer
        open={studyOpen}
        onOpenChange={setStudyOpen}
        side="right"
        title="Study tools"
        description={resource.title}
      >
        <StudyPanel
          resource={resource}
          progress={progress}
          location={location}
          onJump={onJump}
          onMarkComplete={markComplete}
          completing={saveProgress.isPending}
          showHeader={false}
        />
      </Drawer>
    </div>
  );
}
