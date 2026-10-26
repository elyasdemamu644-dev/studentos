"use client";

import type { ResourceProgress } from "@/types/api-types";

export interface ViewerProgressUpdate {
  page?: number | null;
  slide?: number | null;
  positionSeconds?: number | null;
  percent?: number | null;
  completed?: boolean;
}

export interface ViewerLocation extends ViewerProgressUpdate {
  label: string;
}

export interface JumpTarget {
  page?: number | null;
  slide?: number | null;
  positionSeconds?: number | null;
  nonce: number;
}

export interface ViewerProps {
  resourceId: string;
  fileName: string;
  blob: Blob;
  progress: ResourceProgress;
  jumpTarget: JumpTarget | null;
  onLocationChange: (location: ViewerLocation) => void;
}

export const EMPTY_PROGRESS: ResourceProgress = {
  page: null,
  slide: null,
  positionSeconds: null,
  percent: null,
  completed: false,
  updatedAt: null,
};

export function saveBlob(blob: Blob, fileName: string): void {
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

export function formatTimestamp(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
