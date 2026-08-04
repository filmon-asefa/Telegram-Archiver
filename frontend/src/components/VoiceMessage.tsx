"use client";

import { memo, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Loader2,
  RefreshCw,
  CheckCheck,
} from "lucide-react";
import { encodeMediaPath } from "@/lib/utils";

const BAR_COUNT = 45;

interface VoiceMessageProps {
  message: {
    message_id: number;
    media_type: string | null;
    file_path: string | null;
  };
  isOutgoing: boolean;
  wasEdited: boolean;
  onToggleEdits: () => void;
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds)) return "0:00";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function generateWaveform(seed: number, count: number): number[] {
  let s = Math.abs(seed) || 1;
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    bars.push(0.25 + ((s % 100) / 100) * 0.75);
  }
  return bars;
}

const VoiceMessage = memo(function VoiceMessage({
  message,
  isOutgoing,
  wasEdited,
  onToggleEdits,
}: VoiceMessageProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const autoplayRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [retryKey, setRetryKey] = useState(0);

  const pending = !message.file_path;
  const src = useMemo(
    () =>
      message.file_path
        ? `/media-files/${encodeMediaPath(message.file_path)}`
        : "",
    [message.file_path]
  );
  const bars = useMemo(
    () => generateWaveform(message.message_id, BAR_COUNT),
    [message.message_id]
  );

  const progress = duration > 0 ? currentTime / duration : 0;
  const hasStarted = phase === "ready" && currentTime > 0;

  const playedColor = isOutgoing
    ? "rgba(255,255,255,0.95)"
    : "var(--text-accent)";
  const idleColor = isOutgoing
    ? "rgba(255,255,255,0.32)"
    : "rgba(255,255,255,0.18)";
  const timeColor = isOutgoing ? "rgba(255,255,255,0.85)" : "var(--text-secondary)";
  const editedColor = isOutgoing ? "rgba(255,255,255,0.8)" : "var(--text-time)";
  const checkColor = isOutgoing ? "rgba(255,255,255,0.9)" : "var(--text-time)";

  const timeText = !pending && phase === "ready"
    ? hasStarted
      ? `${formatDuration(currentTime)} / ${formatDuration(duration)}`
      : formatDuration(duration)
    : "";

  const togglePlay = () => {
    const audio = audioRef.current;
    if (pending || !audio) return;
    if (phase === "failed") {
      retry();
      return;
    }
    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play().catch(() => {});
    }
  };

  const retry = () => {
    setPhase("loading");
    setRetryKey((k) => k + 1);
    autoplayRef.current = true;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const rect = waveformRef.current?.getBoundingClientRect();
    if (!audio || phase !== "ready" || duration <= 0 || !rect || rect.width <= 0) {
      return;
    }
    const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    audio.currentTime = frac * duration;
    setCurrentTime(audio.currentTime);
  };

  const handleWaveformKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || phase !== "ready") return;
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -5 : 5;
      audio.currentTime = Math.min(Math.max(audio.currentTime + delta, 0), duration);
      setCurrentTime(audio.currentTime);
    }
  };

  const renderButton = () => {
    if (pending) {
      return <Loader2 className="animate-spin" size={18} aria-label="Downloading" />;
    }
    if (phase === "loading") {
      return <Loader2 className="animate-spin" size={18} aria-label="Loading" />;
    }
    if (phase === "failed") {
      return <RefreshCw size={18} aria-label="Retry" />;
    }
    if (isPlaying) {
      return <Pause size={16} fill="currentColor" aria-hidden />;
    }
    return <Play size={18} fill="currentColor" aria-hidden style={{ marginLeft: 2 }} />;
  };

  return (
    <div className="voice-message">
      <button
        type="button"
        className="voice-play-btn"
        onClick={togglePlay}
        aria-label={
          pending
            ? "Voice message downloading"
            : phase === "failed"
              ? "Retry voice message"
              : isPlaying
                ? "Pause voice message"
                : "Play voice message"
        }
        title={
          pending ? "Downloading…" : phase === "failed" ? "Retry" : isPlaying ? "Pause" : "Play"
        }
      >
        {renderButton()}
      </button>

      <div className="voice-main">
        <div
          ref={waveformRef}
          role="slider"
          tabIndex={0}
          aria-label="Voice message position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          aria-disabled={pending || phase !== "ready"}
          className="voice-waveform"
          onClick={handleSeek}
          onKeyDown={handleWaveformKeyDown}
        >
          {bars.map((h, i) => {
            const played = progress >= (i + 1) / bars.length;
            return (
              <div
                key={i}
                className="voice-bar"
                style={{
                  height: `${h * 100}%`,
                  background: played ? playedColor : idleColor,
                  animation:
                    isPlaying && played
                      ? `voiceBarPulse 1s ease-in-out ${(i % 8) * 0.06}s infinite`
                      : undefined,
                }}
              />
            );
          })}
        </div>

        <div className="voice-meta">
          <span className="voice-time" style={{ color: timeColor }}>
            {timeText}
          </span>
          <span className="voice-meta-right">
            {wasEdited && (
              <button
                type="button"
                className="voice-edited"
                onClick={onToggleEdits}
                title="View edit history"
                style={{ color: editedColor }}
              >
                edited
              </button>
            )}
            {isOutgoing && (
              <CheckCheck
                size={16}
                style={{ color: checkColor }}
                aria-label="Delivered"
              />
            )}
          </span>
        </div>
      </div>

      {!pending && (
        <audio
          ref={audioRef}
          key={retryKey}
          src={src}
          preload="metadata"
          style={{ display: "none" }}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (isFinite(d)) setDuration(d);
            setPhase("ready");
          }}
          onCanPlay={() => {
            setPhase("ready");
            if (autoplayRef.current) {
              autoplayRef.current = false;
              void audioRef.current?.play().catch(() => {});
            }
          }}
          onPlaying={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(duration);
          }}
          onError={() => {
            if (!pending) setPhase("failed");
          }}
        />
      )}
    </div>
  );
});

export default VoiceMessage;
