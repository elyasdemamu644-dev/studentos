"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileUp, Paperclip, X } from "lucide-react";

import type { ResourceType } from "@/types/api-types";
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
import { DialogShell } from "@/features/tasks/task-form";
import { formatBytes } from "@/lib/format";
import { toClientError } from "@/lib/api/errors";
import { useUploadResource } from "./hooks";

// Only the title is required alongside the file. The API infers the resource
// type from the file's sniffed content when none is chosen, so "Auto" sends no
// `resourceType` field at all. The size/type limits themselves live in server
// config (UPLOAD_MAX_FILE_SIZE_BYTES / UPLOAD_ALLOWED_MIME_TYPES) and are
// enforced there; the client does not guess them.
const uploadFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "A title is required")
    .max(200, "Keep the title under 200 characters"),
  description: z.string().trim().max(2000, "Keep it under 2000 characters").optional(),
});

type UploadFormValues = z.infer<typeof uploadFormSchema>;

const EMPTY_VALUES: UploadFormValues = { title: "", description: "" };

const TYPE_OPTIONS: Array<{ value: ResourceType | "AUTO"; label: string }> = [
  { value: "AUTO", label: "Auto-detect" },
  { value: "PDF", label: "PDF" },
  { value: "SLIDES", label: "Slides" },
  { value: "DOCUMENT", label: "Document" },
  { value: "VIDEO", label: "Video" },
  { value: "AUDIO", label: "Audio" },
  { value: "OTHER", label: "Other" },
];

export function MaterialUploadDialog({
  open,
  onOpenChange,
  courseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
}) {
  const upload = useUploadResource();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [resourceType, setResourceType] = useState<ResourceType | "AUTO">("AUTO");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UploadFormValues>({
    resolver: zodResolver(uploadFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  // Nothing from a previous attempt may leak into a new one — not a stale file,
  // a stale server error, or the last title.
  useEffect(() => {
    if (!open) return;
    reset(EMPTY_VALUES);
    setFile(null);
    setFileError(null);
    setResourceType("AUTO");
    upload.reset();
    if (fileInputRef.current) fileInputRef.current.value = "";
    // `upload` is intentionally excluded: re-running on its identity would clear
    // the inline error as soon as a request settles mid-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setFileError(null);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onSubmit = async (values: UploadFormValues) => {
    if (!file) {
      setFileError("Choose a file to upload");
      return;
    }
    try {
      await upload.mutateAsync({
        file,
        title: values.title,
        description: values.description || undefined,
        courseId,
        resourceType: resourceType === "AUTO" ? undefined : resourceType,
      });
      onOpenChange(false);
    } catch {
      // The hook has already surfaced the server's message as a toast; the
      // inline alert below renders the same error for people who missed it.
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Upload material"
      description="Add a file to this course. You can attach a title and optional notes."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {upload.isError && (
          <ErrorAlert
            error={toClientError(upload.error, "Could not upload the file")}
            title="Upload failed"
            className="py-4"
          />
        )}

        <div className="space-y-2">
          <Label htmlFor={fileInputId}>File</Label>
          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            className="sr-only"
            aria-describedby={`${fileInputId}-hint`}
            onChange={onFileChange}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
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
          <p id={`${fileInputId}-hint`} className="text-xs text-muted-foreground">
            PDF, images (PNG/JPEG), Word, PowerPoint or plain text. Other types are rejected by
            the server.
          </p>
          {fileError && <p className="text-sm text-danger">{fileError}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="material-title">Title</Label>
          <Input
            id="material-title"
            aria-invalid={!!errors.title}
            placeholder="e.g. Week 3 lecture slides"
            {...register("title")}
          />
          {errors.title && <p className="text-sm text-danger">{errors.title.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="material-type">Type</Label>
          <Select
            value={resourceType}
            onValueChange={(value) => setResourceType(value as ResourceType | "AUTO")}
          >
            <SelectTrigger id="material-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Leave on auto-detect to let StudentOS choose from the file&apos;s content.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="material-description">Description</Label>
          <Textarea
            id="material-description"
            rows={3}
            placeholder="Optional notes about this file"
            {...register("description")}
          />
          {errors.description && (
            <p className="text-sm text-danger">{errors.description.message}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton type="submit" loading={isSubmitting || upload.isPending}>
            <FileUp className="mr-1.5 h-4 w-4" aria-hidden /> Upload
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}
