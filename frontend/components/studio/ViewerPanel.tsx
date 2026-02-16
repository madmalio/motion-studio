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
}

const ViewerPanel = memo(function ViewerPanel({
  tracks,
  totalDuration,
  currentTime,
  isPlaying,
  setIsPlaying,
  setCurrentTime,
  projectFps,
}: ViewerPanelProps) {
  const playerRef = useRef<PlayerRef>(null);

  // Optimize Manifest Rebuilds
  const manifest = useMemo(() => {
    return convertToRemotionManifest(tracks, projectFps);
  }, [tracks, projectFps]);

  const currentFrame = Math.round(currentTime * projectFps);

  // 1. App -> Player: Sync Play/Pause
  useEffect(() => {
    if (!playerRef.current) return;
    if (isPlaying) {
      playerRef.current.play();
    } else {
      playerRef.current.pause();
    }
  }, [isPlaying]);

  // 2. App -> Player: Sync Seeking (ONLY when paused)
  useEffect(() => {
    // Safety: Don't seek if we are playing (avoids fighting the engine)
    if (!playerRef.current || isPlaying) return;

    const engineFrame = playerRef.current.getCurrentFrame();
    if (Math.abs(engineFrame - currentFrame) > 0.5) {
      playerRef.current.seekTo(currentFrame);
    }
  }, [currentFrame, isPlaying]);

  // 3. Player -> App: Listen for frame changes
  useEffect(() => {
    const { current } = playerRef;
    if (!current) return;

    const handleFrameUpdate = (e: CustomEvent<{ frame: number }>) => {
      if (isPlaying) {
        setCurrentTime(e.detail.frame / projectFps);
      }
    };

    current.addEventListener("frameupdate", handleFrameUpdate as any);
    return () => {
      current.removeEventListener("frameupdate", handleFrameUpdate as any);
    };
  }, [isPlaying, setCurrentTime, projectFps]);

  // 4. LOOP FIX: Safety Guard on Pause Event
  useEffect(() => {
    const { current } = playerRef;
    if (!current) return;

    const handlePause = () => {
      // CRITICAL FIX: Only update state if it actually needs changing.
      // This prevents the "Maximum update depth" infinite loop.
      if (isPlaying) {
        setIsPlaying(false);
      }
    };

    current.addEventListener("pause", handlePause);

    return () => {
      current.removeEventListener("pause", handlePause);
    };
  }, [isPlaying, setIsPlaying]); // Add isPlaying to dependencies so we access the fresh value

  return (
    <div className="h-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
      <div className="relative w-full h-full flex items-center justify-center bg-zinc-950">
        <Player
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
