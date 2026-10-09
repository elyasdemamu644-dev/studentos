"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ExternalLink,
  FileText,
  FolderOpen,
  Link2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Chip } from "@/components/panel";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterBar, SearchField, SelectFilter } from "@/components/ui/filter-bar";
import { Surface } from "@/components/ui/surface";
import { useCourses } from "@/features/courses/hooks";
import { useDeleteResource, useResource, useResources } from "@/features/resources/hooks";
import { ResourceFormDialog } from "@/features/resources/resource-form";
import type { ResourceRecord, ResourceType } from "@/types/api-types";
import { RESOURCE_TYPE_LABELS } from "@/lib/labels";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_FILTERS: Array<ResourceType | ""> = [
  "",
  "LINK",
  "PDF",
  "SLIDES",
  "VIDEO",
  "AUDIO",
  "DOCUMENT",
  "OTHER",
];

/** Static tone classes per resource type so the icon chip reads as a type badge. */
const TYPE_TONE: Record<ResourceType, string> = {
  LINK: "bg-primary/10 text-primary",
  PDF: "bg-danger/10 text-danger",
  SLIDES: "bg-warning/15 text-warning",
  VIDEO: "bg-success/10 text-success",
  AUDIO: "bg-primary/10 text-primary",
  DOCUMENT: "bg-muted text-muted-foreground",
  OTHER: "bg-muted text-muted-foreground",
};

export default function ResourcesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<ResourceType | "">("");

  /** Drop one query param and keep the rest (course filter, etc.). */
  const stripParam = useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/resources?${qs}` : "/resources", { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    const courseParam = searchParams.get("course");
    if (courseParam) {
      setCourseFilter(courseParam);
      stripParam("course");
    }
  }, [searchParams, stripParam]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ResourceRecord | undefined>(undefined);
  const [deleting, setDeleting] = useState<ResourceRecord | null>(null);

  // Deep links from the command palette: `/resources?resource=<id>` opens
  // that resource's editor. A stale id is dropped instead of spinning.
  const resourceIdParam = searchParams.get("resource");
  const resourceQuery = useResource(resourceIdParam ?? undefined);
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!resourceIdParam) {
      openedRef.current = null;
      return;
    }
    if (resourceQuery.isError) {
      stripParam("resource");
      return;
    }
    const resource = resourceQuery.data;
    if (!resource || openedRef.current === resourceIdParam) return;
    openedRef.current = resourceIdParam;
    setEditing(resource);
    setFormOpen(true);
    stripParam("resource");
  }, [resourceIdParam, resourceQuery.data, resourceQuery.isError, stripParam]);

  const resources = useResources({
    search: search || undefined,
    courseId: courseFilter || undefined,
    resourceType: typeFilter || undefined,
    limit: 100,
  });
  const courses = useCourses();
  const deleteResource = useDeleteResource();

  const courseName = useMemo(() => {
    const map = new Map((courses.data ?? []).map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "Unknown course";
  }, [courses.data]);

  const items = useMemo(() => resources.data?.items ?? [], [resources.data]);
  const hasFilters = Boolean(search || courseFilter || typeFilter);

  const stats = useMemo(() => {
    let links = 0;
    let linked = 0;
    for (const r of items) {
      if (r.resourceType === "LINK") links += 1;
      if (r.courseId) linked += 1;
    }
    return { links, linked };
  }, [items]);

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const openEdit = (resource: ResourceRecord) => {
    setEditing(resource);
    setFormOpen(true);
  };

  const clearFilters = () => {
    setSearch("");
    setCourseFilter("");
    setTypeFilter("");
  };

  return (
    <div>
      <PageHeader
        kicker="Library"
        title="Resources"
        description="Lecture slides, readings, recordings and links for your courses."
        chips={
          resources.data ? (
            <>
              <Chip tone="primary" icon={FolderOpen}>
                {items.length} saved
              </Chip>
              <Chip tone="neutral" icon={Link2}>
                {stats.links} links
              </Chip>
              <Chip tone="success" icon={FileText}>
                {stats.linked} with course
              </Chip>
            </>
          ) : undefined
        }
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add resource
          </Button>
        }
      />

      <FilterBar onClear={hasFilters ? clearFilters : undefined}>
        <SearchField
          value={search}
          onChange={setSearch}
          label="Search resources"
          placeholder="Search resources…"
        />
        <SelectFilter
          value={courseFilter}
          onChange={setCourseFilter}
          label="Filter by course"
          placeholder="All courses"
          allLabel="All courses"
          options={(courses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          className="sm:w-56"
        />
        <SelectFilter
          value={typeFilter}
          onChange={(value) => setTypeFilter(value as ResourceType | "")}
          label="Filter by type"
          placeholder="All types"
          allLabel="All types"
          options={TYPE_FILTERS.filter((t): t is ResourceType => t !== "").map((t) => ({
            value: t,
            label: RESOURCE_TYPE_LABELS[t],
          }))}
        />
      </FilterBar>

      {resources.isPending ? (
        <ListSkeleton rows={4} />
      ) : resources.isError ? (
        <ErrorState error={resources.error} retry={() => resources.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={hasFilters ? Search : FolderOpen}
          title={hasFilters ? "No matching resources" : "No resources yet"}
          description={
            hasFilters
              ? "Try a different search term or clear the filters."
              : "Save links to lecture slides, readings and past papers so they are one click away."
          }
          action={
            hasFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add resource
              </Button>
            )
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Resources">
          {items.map((resource) => (
            <li key={resource.id} className="flex flex-col">
              <Surface className="flex h-full flex-col p-4 transition-all hover:border-primary/30 hover:shadow-pop">
                <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      TYPE_TONE[resource.resourceType] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {resource.resourceType === "LINK" ? (
                      <Link2 className="h-4 w-4" aria-hidden />
                    ) : (
                      <FileText className="h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{resource.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {resource.courseId ? courseName(resource.courseId) : "No course"}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {RESOURCE_TYPE_LABELS[resource.resourceType] ?? resource.resourceType}
                </Badge>
              </div>

              {resource.description && (
                <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
                  {resource.description}
                </p>
              )}

              <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                <span className="text-xs text-muted-foreground">
                  {relativeTime(resource.createdAt)}
                </span>
                <div className="flex items-center gap-1">
                  {resource.url && (
                    <Button asChild variant="ghost" size="sm">
                      <a href={resource.url} target="_blank" rel="noopener noreferrer">
                        Open
                        <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only"> {resource.title} in a new tab</span>
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${resource.title}`}
                    onClick={() => openEdit(resource)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
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
              </div>
              </Surface>
            </li>
          ))}
        </ul>
      )}

      <ResourceFormDialog open={formOpen} onOpenChange={setFormOpen} resource={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete resource"
        description={
          deleting
            ? `"${deleting.title}" will be removed from your library. This cannot be undone.`
            : undefined
        }
        busy={deleteResource.isPending}
        onConfirm={() => {
          if (!deleting) return;
          void deleteResource.mutateAsync(deleting.id).then(() => setDeleting(null));
        }}
      />
    </div>
  );
}
