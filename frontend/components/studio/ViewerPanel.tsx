"use client";

import { memo, useRef, useEffect, useMemo } from "react";
import { Player, PlayerRef } from "@remotion/player";
import { HelloWorld } from "./HelloWorld";
import { convertToRemotionManifest } from "@/lib/remotionBridge";

interface ViewerPanelProps {
  tracks: any[][];
  totalDuration: number;
  currentTime: number;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  projectFps: number;
  volume?: number; // <--- NEW: Global Volume
  previewAsset?: string; // <--- NEW: Single Clip Mode
}

const ViewerPanel = memo(function ViewerPanel({
  tracks,
  totalDuration,
  currentTime,
  isPlaying,
  setIsPlaying,
  setCurrentTime,
  projectFps,
  volume = 1,
  previewAsset,
}: ViewerPanelProps) {
  const playerRef = useRef<PlayerRef>(null);

  const seekRafRef = useRef<number | null>(null);
  const lastSeekFrameRef = useRef<number>(-1);

  const ignorePauseEventRef = useRef(false);
  const lastAppFrameRef = useRef<number>(-1);
  // Optimize Manifest Rebuilds
  const manifest = useMemo(() => {
    // 1. PREVIEW MODE: If a single asset is selected, ignore timeline tracks
    if (previewAsset) {
      return {
        tracks: [
          {
            id: "preview-track",
            clips: [
              {
                id: "preview-clip",
                file: previewAsset,
                startFrame: 0,
                endFrame: Math.round(totalDuration * projectFps),
                trimStart: 0,
                type: previewAsset.match(/\.(mp3|wav|m4a|flac|aac)$/i)
                  ? "audio"
                  : "video",
                volume: 1,
              },
            ],
          },
        ],
        fps: projectFps,
        volume: volume, // Pass global volume to HelloWorld
      };
    }

    // 2. TIMELINE MODE: Standard conversion
    const base = convertToRemotionManifest(tracks, projectFps);
    return { ...base, volume };
  }, [tracks, projectFps, previewAsset, totalDuration, volume]);

  const currentFrame = Math.round(currentTime * projectFps);

  // 1. App -> Player: Sync Play/Pause
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;

    if (isPlaying) {
      p.play();
    } else {
      p.pause();
    }
  }, [isPlaying]);

  // 2. App -> Player: Sync Seeking (ONLY when paused) — THROTTLED to avoid echo
  useEffect(() => {
    const p = playerRef.current;
    if (!p || isPlaying) return;

    // Cancel any pending seek
    if (seekRafRef.current != null) {
      cancelAnimationFrame(seekRafRef.current);
      seekRafRef.current = null;
    }

    seekRafRef.current = requestAnimationFrame(() => {
      seekRafRef.current = null;

      // Don’t re-seek to same frame
      if (lastSeekFrameRef.current === currentFrame) return;

      // Hard-stop audio before/after seek to prevent overlap
      p.pause();
      p.seekTo(currentFrame);
      p.pause();

      lastSeekFrameRef.current = currentFrame;
    });

    return () => {
      if (seekRafRef.current != null) {
        cancelAnimationFrame(seekRafRef.current);
        seekRafRef.current = null;
      }
    };
  }, [currentFrame, isPlaying]);

  // 2b. If user scrubs while playing: force a pause before seeking (prevents echo)

  // 2c. Seek requests while playing: only intervene on BIG jumps (user scrub)
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    if (!isPlaying) {
      // keep last frame in sync for the next time playback starts
      lastAppFrameRef.current = currentFrame;
      return;
    }

    const last = lastAppFrameRef.current;
    lastAppFrameRef.current = currentFrame;

    // During normal playback, currentFrame increments ~1 per render.
    // If it jumps by more than 1, treat it as a user scrub/seek request.
    if (last !== -1 && Math.abs(currentFrame - last) > 1) {
      // Pause without letting the Player's pause event flip app state.
      ignorePauseEventRef.current = true;
      try {
        p.pause();
        p.seekTo(currentFrame);
        p.play();
      } finally {
        // Clear on next tick
        setTimeout(() => {
          ignorePauseEventRef.current = false;
        }, 0);
      }

      lastSeekFrameRef.current = currentFrame;
    }
  }, [currentFrame, isPlaying]);

  // 3. Player -> App: Listen for frame changes
  useEffect(() => {
    const { current } = playerRef;
    if (!current) return;

    const handleFrameUpdate = (e: CustomEvent<{ frame: number }>) => {
      if (!isPlaying) return;

      const frame = e.detail.frame;
      setCurrentTime(frame / projectFps);

      // Stop when we reach the end (prevents endless "playing" state)
      const endFrame = Math.max(0, Math.floor(totalDuration * projectFps) - 1);
      if (frame >= endFrame) {
        setIsPlaying(false);
      }
    };

    current.addEventListener("frameupdate", handleFrameUpdate as any);
    return () => {
      current.removeEventListener("frameupdate", handleFrameUpdate as any);
    };
  }, [isPlaying, setCurrentTime, setIsPlaying, projectFps, totalDuration]);

  // Force a reset when switching between Timeline and Preview modes
  // This prevents the "ghost timeline" playback and clears audio buffers
  const playerKey = previewAsset
    ? `preview-${previewAsset}`
    : "timeline-player";

  return (
    <div className="h-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
      <div className="relative w-full h-full flex items-center justify-center bg-zinc-950">
        <Player
          key={playerKey}
          ref={playerRef}
          component={HelloWorld}
          inputProps={manifest}
          durationInFrames={Math.max(1, Math.round(totalDuration * projectFps))}
          fps={projectFps}
          compositionWidth={1920}
          compositionHeight={1080}
          style={{ width: "100%", height: "100%" }}
          acknowledgeRemotionLicense
        />
      </div>
    </div>
  );
});

export default ViewerPanel;
