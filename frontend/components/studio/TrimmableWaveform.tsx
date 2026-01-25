"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00.0";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
};

function WaveformCanvas({
  data,
  color = "#D2FF44",
}: {
  data: number[];
  color?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = color;

    const barCount = data.length;
    const barWidth = rect.width / barCount;
    const gap = 0;
    const drawWidth = Math.max(1, barWidth - gap);

    for (let i = 0; i < barCount; i++) {
      const h = Math.max(2, data[i] * rect.height);
      const x = i * barWidth;
      const y = (rect.height - h) / 2;
      ctx.fillRect(x, y, drawWidth, h);
    }
  }, [data, color]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

interface TrimmableWaveformProps {
  data: number[];
  trimStart: number;
  trimDuration: number;
  onTrimChange: (start: number, duration: number) => void;
  audioUrl?: string;
}

export default function TrimmableWaveform({
  data,
  trimStart,
  trimDuration,
  onTrimChange,
  audioUrl,
}: TrimmableWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isDragging, setIsDragging] = useState<
    "start" | "end" | "region" | null
  >(null);
  const [dragOffset, setDragOffset] = useState(0);

  const SAMPLES_PER_SEC = 20;
  const totalDuration = data.length > 0 ? data.length / SAMPLES_PER_SEC : 0;

  const effectiveDuration = trimDuration > 0 ? trimDuration : totalDuration;
  const trimEnd = Math.min(totalDuration, trimStart + effectiveDuration);

  const safeTotal = totalDuration || 1;
  const startPct = (trimStart / safeTotal) * 100;
  const endPct = (trimEnd / safeTotal) * 100;
  const widthPct = endPct - startPct;
  const playheadPct = (playbackTime / safeTotal) * 100;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => {
      setPlaybackTime(audio.currentTime);
      if (audio.currentTime >= trimEnd && isPlaying) {
        audio.currentTime = trimStart;
      }
    };

    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [trimStart, trimEnd, isPlaying]);

  const togglePlay = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (audio.currentTime < trimStart || audio.currentTime > trimEnd) {
        audio.currentTime = trimStart;
      }
      audio.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const handlePointerDown = (
    e: React.PointerEvent,
    type: "start" | "end" | "region",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(type);

    if (type === "region" && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickTime = (clickX / rect.width) * totalDuration;
      setDragOffset(clickTime - trimStart);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const time = percentage * totalDuration;

    if (isDragging === "start") {
      const newStart = Math.min(time, trimEnd - 0.1);
      onTrimChange(newStart, trimEnd - newStart);
      if (audioRef.current) audioRef.current.currentTime = newStart;
    } else if (isDragging === "end") {
      const newEnd = Math.max(time, trimStart + 0.1);
      onTrimChange(trimStart, newEnd - trimStart);
    } else if (isDragging === "region") {
      let newStart = time - dragOffset;
      if (newStart < 0) newStart = 0;
      if (newStart + effectiveDuration > totalDuration)
        newStart = totalDuration - effectiveDuration;
      onTrimChange(newStart, effectiveDuration);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(null);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  if (totalDuration === 0) {
    return (
      <div className="h-20 bg-zinc-900 rounded border border-zinc-800 flex flex-col items-center justify-center text-xs text-zinc-500 gap-2">
        <span>No waveform data</span>
        {audioUrl && (
          <span className="text-[10px] opacity-50">
            Restart 'wails dev' if new
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-20 w-full bg-zinc-900 rounded select-none group border border-zinc-800 mt-2"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <audio ref={audioRef} src={audioUrl} className="hidden" />

      {/* 1. Base Waveform */}
      <div className="absolute inset-0 opacity-30 p-1 pointer-events-none">
        <WaveformCanvas data={data} color="#ffffff" />
      </div>

      {/* 2. Playhead */}
      <div
        className="absolute top-0 bottom-0 w-px bg-white z-10 pointer-events-none shadow-[0_0_5px_rgba(255,255,255,0.5)]"
        style={{ left: `${playheadPct}%` }}
      />

      {/* 3. Active Region */}
      <div
        className="absolute top-0 bottom-0 overflow-hidden cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => handlePointerDown(e, "region")}
        style={{ left: `${startPct}%`, width: `${widthPct}%` }}
      >
        <div className="absolute inset-y-0 bg-[#D2FF44]/10 border-l border-r border-[#D2FF44]/50 w-full" />
        <div
          className="absolute top-0 bottom-0 h-full p-1 opacity-100 pointer-events-none"
          style={{
            left: `-${(startPct / widthPct) * 100}%`,
            width: `${(100 / widthPct) * 100}%`,
          }}
        >
          <WaveformCanvas data={data} color="#D2FF44" />
        </div>
      </div>

      {/* 4. Handles (No Labels) */}
      <div
        className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-20 flex items-center justify-center hover:scale-110 transition-transform group/handle"
        style={{ left: `${startPct}%` }}
        onPointerDown={(e) => handlePointerDown(e, "start")}
      >
        <div className="h-3/5 w-1 bg-[#D2FF44] rounded-full shadow-md" />
      </div>

      <div
        className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-20 flex items-center justify-center hover:scale-110 transition-transform group/handle"
        style={{ left: `${endPct}%` }}
        onPointerDown={(e) => handlePointerDown(e, "end")}
      >
        <div className="h-3/5 w-1 bg-[#D2FF44] rounded-full shadow-md" />
      </div>

      {/* 5. Play Button */}
      <button
        onClick={togglePlay}
        className="absolute bottom-2 right-2 z-30 p-1.5 rounded-full bg-zinc-800 text-[#D2FF44] hover:bg-[#D2FF44] hover:text-black transition-colors shadow-lg border border-zinc-700"
      >
        {isPlaying ? (
          <Pause size={10} fill="currentColor" />
        ) : (
          <Play size={10} fill="currentColor" />
        )}
      </button>

      {/* 6. DURATION LABEL (Kept this one) */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-black/40 px-2 rounded-full backdrop-blur-sm border border-white/10 pointer-events-none">
        <span className="text-[9px] text-zinc-400 font-medium uppercase tracking-wider">
          Length
        </span>
        <span className="text-[10px] font-mono font-bold text-[#D2FF44]">
          {formatTime(effectiveDuration)}
        </span>
      </div>
    </div>
  );
}
