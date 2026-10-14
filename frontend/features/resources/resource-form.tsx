"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileUp, Paperclip, X } from "lucide-react";

import type { ResourceRecord, ResourceType } from "@/types/api-types";
import { Button, LoadingButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorAlert } from "@/components/states";
import { useCourses } from "@/features/courses/hooks";
import { DialogShell } from "@/features/tasks/task-form";
import { formatBytes } from "@/lib/format";
import { toClientError } from "@/lib/api/errors";
import { useCreateResource, useUpdateResource, useUploadResource } from "./hooks";

// The API validates the URL with `z.string().url()`; mirror it so the user
// gets feedback before a round-trip. http(s) only — a resource link must be
// openable in a browser.
const linkFormSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(200, "Keep the title under 200 characters"),
  url: z
    .string()
    .trim()
    .min(1, "A link is required")
    .refine((v) => /^https?:\/\/.+\..+/.test(v), "Enter a full link starting with http:// or https://"),
  resourceType: z
    .enum(["PDF", "VIDEO", "AUDIO", "SLIDES", "LINK", "DOCUMENT", "OTHER"])
    .default("LINK"),
  courseId: z.string().optional(),
  description: z.string().trim().max(2000, "Keep it under 2000 characters").optional(),
});

const uploadFormSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(200, "Keep the title under 200 characters"),
  courseId: z.string().optional(),
  description: z.string().trim().max(2000, "Keep it under 2000 characters").optional(),
});

type LinkFormValues = z.infer<typeof linkFormSchema>;
type UploadFormValues = z.infer<typeof uploadFormSchema>;

type FormMode = "upload" | "link";
type UploadType = ResourceType | "AUTO";

const EMPTY_LINK: LinkFormValues = {
  title: "",
  url: "",
  resourceType: "LINK",
  courseId: "",
  description: "",
};

const EMPTY_UPLOAD: UploadFormValues = {
  title: "",
  courseId: "",
  description: "",
};

const LINK_TYPE_OPTIONS: Array<{ value: ResourceType; label: string }> = [
  { value: "LINK", label: "Link" },
  { value: "PDF", label: "PDF" },
  { value: "SLIDES", label: "Slides" },
  { value: "VIDEO", label: "Video" },
  { value: "AUDIO", label: "Audio" },
  { value: "DOCUMENT", label: "Document" },
  { value: "OTHER", label: "Other" },
];

const UPLOAD_TYPE_OPTIONS: Array<{ value: UploadType; label: string }> = [
  { value: "AUTO", label: "Auto-detect" },
  { value: "PDF", label: "PDF" },
  { value: "SLIDES", label: "Slides" },
  { value: "DOCUMENT", label: "Document" },
  { value: "VIDEO", label: "Video" },
  { value: "AUDIO", label: "Audio" },
  { value: "OTHER", label: "Other" },
];

/**
 * Add-or-edit dialog for the Resources page. The user chooses between two
 * visible modes: uploading a file (POST /resources/upload) or saving a link
 * (POST /resources). Editing an existing resource keeps its storage kind and
 * only patches the metadata.
 */
export function ResourceFormDialog({
  open,
  onOpenChange,
  resource,
  defaultCourseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource?: ResourceRecord;
  defaultCourseId?: string;
}) {
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const uploadResource = useUploadResource();
  const courses = useCourses();

  const isEditing = Boolean(resource);
  const editingUpload = resource?.storageType === "UPLOAD";

  const [mode, setMode] = useState<FormMode>("upload");
  const [uploadType, setUploadType] = useState<UploadType>("AUTO");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LinkFormValues & UploadFormValues>({
    resolver: zodResolver(mode === "upload" ? uploadFormSchema : linkFormSchema),
    defaultValues: { ...EMPTY_UPLOAD, ...EMPTY_LINK },
  });

  // Nothing from a previous attempt may leak into a new one — not a stale file,
  // a stale server error, or the last values.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setFileError(null);
    uploadResource.reset();
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (resource) {
      setMode(editingUpload ? "upload" : "link");
      setUploadType(editingUpload ? resource.resourceType : "AUTO");
      reset({
        title: resource.title,
        url: resource.url ?? "",
        resourceType: resource.resourceType,
        courseId: resource.courseId ?? "",
        description: resource.description ?? "",
      });
    } else {
      setMode("upload");
      setUploadType("AUTO");
      reset({ ...EMPTY_UPLOAD, courseId: defaultCourseId ?? "" });
    }
    // `uploadResource` is intentionally excluded: re-running on its identity
    // would clear the inline error as soon as a request settles mid-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resource, defaultCourseId, editingUpload, reset]);

  /** Switch mode and clear the form for a fresh entry. */
  const switchMode = (next: FormMode) => {
    if (next === mode) return;
    setMode(next);
    setFile(null);
    setFileError(null);
    reset(next === "upload" ? { ...EMPTY_UPLOAD } : { ...EMPTY_LINK });
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setFileError(null);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onSubmitLink = async (values: LinkFormValues) => {
    const payload = {
      title: values.title,
      url: values.url,
      resourceType: values.resourceType,
      courseId: values.courseId || null,
      description: values.description || null,
    };
    if (resource) {
      await updateResource.mutateAsync({ id: resource.id, input: payload });
    } else {
      await createResource.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  const onSubmitUpload = async (values: UploadFormValues) => {
    if (resource) {
      // Editing keeps the stored file; only the metadata is patched.
      await updateResource.mutateAsync({
        id: resource.id,
        input: {
          title: values.title,
          resourceType: uploadType === "AUTO" ? undefined : uploadType,
          courseId: values.courseId || null,
          description: values.description || null,
        },
      });
      onOpenChange(false);
      return;
    }
    if (!file) {
      setFileError("Choose a file to upload");
      return;
    }
    try {
      await uploadResource.mutateAsync({
        file,
        title: values.title,
        description: values.description || undefined,
        courseId: values.courseId || undefined,
        resourceType: uploadType === "AUTO" ? undefined : uploadType,
      });
      onOpenChange(false);
    } catch {
      // The hook has already surfaced the server's message as a toast; the
      // inline alert renders the same error for people who missed it.
    }
  };

  const onSubmit = handleSubmit((values) => {
    if (mode === "upload") return onSubmitUpload(values as UploadFormValues);
    return onSubmitLink(values as LinkFormValues);
  });

  const showUpload = mode === "upload";
  const submitLabel = resource ? "Save changes" : showUpload ? "Upload resource" : "Add resource";

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={resource ? "Edit resource" : "Add resource"}
      description={
        resource
          ? "Update the details for this resource."
          : "Upload a file or save a link to lecture slides, readings, videos or past papers."
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {/* Mode selector — both options stay visible side by side. */}
        {!isEditing && (
          <div
            role="tablist"
            aria-label="How to add this resource"
            className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={showUpload}
              onClick={() => switchMode("upload")}
              className={
                showUpload
                  ? "rounded-md bg-background px-3 py-2 text-sm font-medium shadow-sm"
                  : "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              }
            >
              Upload file
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!showUpload}
              onClick={() => switchMode("link")}
              className={
                !showUpload
                  ? "rounded-md bg-background px-3 py-2 text-sm font-medium shadow-sm"
                  : "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              }
            >
              Add link
            </button>
          </div>
        )}

        {showUpload && uploadResource.isError && (
          <ErrorAlert
            error={toClientError(uploadResource.error, "Could not upload the file")}
            title="Upload failed"
            className="py-4"
          />
        )}

        {/* Upload mode: file picker (create only). */}
        {showUpload && !isEditing && (
          <div className="space-y-2">
            <Label htmlFor={fileInputId}>File</Label>
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              className="sr-only"
              onChange={onFileChange}
              disabled={isSubmitting}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
              >
                <FileUp className="mr-1.5 h-4 w-4" aria-hidden /> Choose file
              </Button>
              {file ? (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-sm">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="max-w-[16rem] truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={clearFile}
                    aria-label="Remove selected file"
                    className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">No file chosen</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Any file type is accepted. Maximum size is enforced by the server.
            </p>
            {fileError && <p className="text-sm text-danger">{fileError}</p>}
          </div>
        )}

        {/* Link mode: URL field. */}
        {!showUpload && (
          <div className="space-y-2">
            <Label htmlFor="resource-url">Link</Label>
            <Input
              id="resource-url"
              type="url"
              inputMode="url"
              aria-invalid={!!errors.url}
              placeholder="https://example.com/slides"
              {...register("url")}
            />
            {errors.url && <p className="text-sm text-danger">{errors.url.message}</p>}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="resource-title">Title</Label>
          <Input
            id="resource-title"
            autoFocus
            aria-invalid={!!errors.title}
            placeholder="e.g. Week 3 lecture slides"
            {...register("title")}
          />
          {errors.title && <p className="text-sm text-danger">{errors.title.message}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="resource-type">Type</Label>
            {showUpload ? (
              // `key` forces a fresh Select when the mode flips: without it,
              // Radix clears the value when the item set changes underneath it.
              <Select
                key="upload-type"
                value={uploadType}
                onValueChange={(v) => setUploadType(v as UploadType)}
              >
                <SelectTrigger id="resource-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UPLOAD_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select
                key="link-type"
                value={watch("resourceType")}
                onValueChange={(v) => {
                  if (v) setValue("resourceType", v as LinkFormValues["resourceType"], { shouldValidate: true });
                }}
              >
                <SelectTrigger id="resource-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="resource-course">Course</Label>
            <Select
              value={watch("courseId") || "none"}
              onValueChange={(v) => setValue("courseId", v === "none" ? "" : v)}
            >
              <SelectTrigger id="resource-course">
                <SelectValue placeholder="No course" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No course</SelectItem>
                {(courses.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="resource-description">Description</Label>
          <Textarea
            id="resource-description"
            rows={3}
            placeholder="Optional notes about this resource"
            {...register("description")}
          />
          {errors.description && <p className="text-sm text-danger">{errors.description.message}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton type="submit" loading={isSubmitting || uploadResource.isPending}>
            {showUpload && !resource && <FileUp className="mr-1.5 h-4 w-4" aria-hidden />}
            {submitLabel}
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}
