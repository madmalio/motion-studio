"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { Play, Pause, Scissors } from "lucide-react";

interface AudioWaveformProps {
  url: string;
  startTime: number;
  duration: number;
  onTrimChange: (start: number, duration: number) => void;
}

export default function AudioWaveform({
  url,
  startTime,
  duration,
  onTrimChange,
}: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !url) return;

    // 1. Initialize WaveSurfer
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#3f3f46", // zinc-700
      progressColor: "#D2FF44", // Neon Lime
      cursorColor: "#fff",
      barWidth: 2,
      barGap: 1,
      height: 48,
      normalize: true,
      url: url,
    });

    // 2. Initialize Regions Plugin (for Trimming)
    const wsRegions = RegionsPlugin.create();
    ws.registerPlugin(wsRegions);

    ws.on("ready", () => {
      setIsReady(true);

      // Add the trim region
      // If duration is 0 (new file), default to full length or 10s
      const fileDuration = ws.getDuration();
      const initialStart = startTime || 0;
      const initialEnd = duration > 0 ? initialStart + duration : fileDuration;

      wsRegions.addRegion({
        start: initialStart,
        end: initialEnd,
        color: "rgba(210, 255, 68, 0.2)", // Transparent Lime
        drag: true,
        resize: true,
        id: "trim-region",
      });

      // Sync initial duration back to parent if it was 0 (new file loaded)
      if (duration === 0) {
        onTrimChange(initialStart, initialEnd - initialStart);
      }
    });

    ws.on("interaction", () => {
      ws.play();
      setIsPlaying(true);
    });

    ws.on("finish", () => setIsPlaying(false));

    // Listen for region updates
    wsRegions.on("region-updated", (region) => {
      onTrimChange(region.start, region.end - region.start);
    });

    // Sync Playback to Region Loop
    wsRegions.on("region-out", (region) => {
      // Loop back to start of region
      ws.setTime(region.start);
      ws.play();
    });

    wavesurfer.current = ws;
    regions.current = wsRegions;

    return () => {
      ws.destroy();
    };
  }, [url]);

  const togglePlay = () => {
    if (!wavesurfer.current) return;
    if (isPlaying) {
      wavesurfer.current.pause();
    } else {
      wavesurfer.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-3 flex gap-3 items-center">
      {/* Play/Pause Button */}
      <button
        onClick={togglePlay}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-[#D2FF44] transition-colors shrink-0"
      >
        {isPlaying ? (
          <Pause size={14} fill="currentColor" />
        ) : (
          <Play size={14} fill="currentColor" />
        )}
      </button>

      {/* Waveform Container */}
      <div className="flex-1 min-w-0 relative">
        <div ref={containerRef} className="w-full" />

        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 bg-zinc-900/80 z-10">
            Loading waveform...
          </div>
        )}
      </div>

      {/* Info Stats */}
      {isReady && (
        <div className="flex flex-col text-[10px] text-zinc-500 font-mono gap-1 shrink-0 w-16 text-right">
          <span>Start: {startTime.toFixed(1)}s</span>
          <span className="text-[#D2FF44]">
            Dur: {(duration || 0).toFixed(1)}s
          </span>
        </div>
      )}
    </div>
  );
}
