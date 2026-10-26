"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Film,
  Music2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTimestamp, type ViewerProps } from "./types";

export function MediaViewer({
  blob,
  fileName,
  progress,
  jumpTarget,
  onLocationChange,
}: ViewerProps) {
  const isAudio = blob.type.startsWith("audio/");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const completedRef = useRef(progress.completed);
  const resumedRef = useRef(false);
  const resumeSecondsRef = useRef(progress.positionSeconds ?? 0);
  const lastReportRef = useRef(0);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    setError(null);
    setPlaying(false);
    setDuration(0);
    setCurrent(0);
    completedRef.current = progress.completed;
    resumedRef.current = false;
    resumeSecondsRef.current = progress.positionSeconds ?? 0;
    return () => URL.revokeObjectURL(objectUrl);
    // The blob identity is the media file; progress is only the initial resume
    // point and is captured in a ref so saving it does not reattach listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  const report = useCallback(
    (media: HTMLMediaElement, force = false) => {
      const now = Date.now();
      if (!force && now - lastReportRef.current < 600) return;
      lastReportRef.current = now;
      const total = Number.isFinite(media.duration) ? media.duration : 0;
      const percent = total > 0 ? Math.min(100, Math.round((media.currentTime / total) * 100)) : null;
      const complete =
        !completedRef.current &&
        (media.ended || (percent != null && percent >= 95) || (total > 0 && total - media.currentTime <= 2));
      if (complete) completedRef.current = true;
      onLocationChange({
        positionSeconds: Math.floor(media.currentTime),
        percent,
        label: `${formatTimestamp(media.currentTime)}${total ? ` of ${formatTimestamp(total)}` : ""}`,
        ...(complete ? { completed: true } : {}),
      });
    },
    [onLocationChange],
  );

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const onLoaded = () => {
      setDuration(Number.isFinite(media.duration) ? media.duration : 0);
      const resumeAt = resumeSecondsRef.current;
      if (!resumedRef.current && resumeAt > 0 && resumeAt < (Number.isFinite(media.duration) ? media.duration - 1 : Infinity)) {
        media.currentTime = resumeAt;
      }
      resumedRef.current = true;
      setCurrent(media.currentTime);
    };
    const onTime = () => {
      setCurrent(media.currentTime);
      report(media);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      report(media, true);
    };
    const onEnded = () => {
      setPlaying(false);
      report(media, true);
    };
    const onError = () =>
      setError(
        "This file could not be played. The browser may not support its codec — download it to open it in a media player.",
      );
    media.addEventListener("loadedmetadata", onLoaded);
    media.addEventListener("timeupdate", onTime);
    media.addEventListener("play", onPlay);
    media.addEventListener("pause", onPause);
    media.addEventListener("ended", onEnded);
    media.addEventListener("error", onError);
    return () => {
      media.removeEventListener("loadedmetadata", onLoaded);
      media.removeEventListener("timeupdate", onTime);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("pause", onPause);
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("error", onError);
      report(media, true);
    };
  }, [report]);

  useEffect(() => {
    if (jumpTarget?.positionSeconds == null) return;
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, jumpTarget.positionSeconds);
    setCurrent(media.currentTime);
  }, [jumpTarget?.nonce, jumpTarget?.positionSeconds]);

  const togglePlay = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play();
    else media.pause();
  };

  const skip = (delta: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, Math.min(media.duration || Infinity, media.currentTime + delta));
    setCurrent(media.currentTime);
  };

  const toggleMute = () => {
    const media = mediaRef.current;
    if (!media) return;
    media.muted = !media.muted;
    setMuted(media.muted);
  };

  const percent = duration > 0 ? Math.min(100, Math.round((current / duration) * 100)) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/95 px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="Back 10 seconds" onClick={() => skip(-10)}>
          <RotateCcw className="h-4 w-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Forward 10 seconds" onClick={() => skip(10)}>
          <RotateCw className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={toggleMute}
        >
          {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </Button>
        <span className="ml-1 text-xs tabular-nums text-muted-foreground">
          {formatTimestamp(current)} / {formatTimestamp(duration)}
        </span>
        {(progress.completed || completedRef.current) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
            <CheckCircle2 className="h-3 w-3" aria-hidden /> Completed
          </span>
        )}
        <span className="ml-auto hidden max-w-[40%] truncate text-xs text-muted-foreground sm:block" title={fileName}>
          {fileName}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto p-4">
        {error ? (
          <div className="max-w-md rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {error}
          </div>
        ) : isAudio ? (
          <div className="w-full max-w-xl">
            <div className="surface-panel flex flex-col items-center gap-5 p-8">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Music2 className="h-9 w-9" aria-hidden />
              </span>
              <div className="min-w-0 text-center">
                <p className="truncate font-medium" title={fileName}>{fileName}</p>
                <p className="text-xs text-muted-foreground">Audio recording</p>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
              </div>
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={url ?? undefined}
                className="w-full"
                controls
                preload="metadata"
              />
            </div>
          </div>
        ) : (
          <div className={cn("flex w-full max-w-5xl items-center justify-center", "aspect-video")}>
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={url ?? undefined}
              className="max-h-full w-full rounded-lg bg-black shadow-pop"
              controls
              preload="metadata"
              playsInline
            />
          </div>
        )}
        {!isAudio && !error && (
          <div className="mt-3 flex w-full max-w-5xl items-center gap-2 text-xs text-muted-foreground">
            <Film className="h-3.5 w-3.5" aria-hidden />
            <span className="shrink-0 tabular-nums">
              {formatTimestamp(current)} / {formatTimestamp(duration)}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
