"use client";

import React, { useRef, useEffect, useMemo } from "react";
import { Player, PlayerRef } from "@remotion/player";
import { TimelineComposition } from "./TimelineComposition";
import { TimelineTrack } from "./SimpleTimeline"; // Re-use your types

// --- TYPES ---
interface ViewerPanelProps {
  tracks: TimelineTrack[];
  totalDuration: number;
  currentTime: number;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  projectFps?: number;
  volume?: number;
  videoBlobs: Map<string, string>;
}

export default function ViewerPanel({
  tracks,
  totalDuration,
  currentTime,
  isPlaying,
  setIsPlaying,
  setCurrentTime,
  projectFps = 30,
  volume = 1,
  videoBlobs,
}: ViewerPanelProps) {
  const playerRef = useRef<PlayerRef>(null);

  // --- SYNC PLAYBACK STATE (Play/Pause) ---
  useEffect(() => {
    if (!playerRef.current) return;

    if (isPlaying && !playerRef.current.isPlaying()) {
      playerRef.current.play();
    } else if (!isPlaying && playerRef.current.isPlaying()) {
      playerRef.current.pause();
    }
  }, [isPlaying]);

  // --- SYNC CURRENT TIME (Seeking from Timeline) ---
  useEffect(() => {
    if (isPlaying || !playerRef.current) return; // Player drives time when playing

    const targetFrame = Math.floor(currentTime * projectFps);
    const currentFrame = playerRef.current.getCurrentFrame();

    if (Math.abs(currentFrame - targetFrame) > 1) {
      playerRef.current.seekTo(targetFrame);
    }
  }, [currentTime, projectFps, isPlaying]);

  // --- POLL CURRENT FRAME (Driving Timeline Playhead) ---
  useEffect(() => {
    if (!isPlaying) return;

    let handle = 0;
    const loop = () => {
      if (playerRef.current) {
        const frame = playerRef.current.getCurrentFrame();
        const durationInFrames = Math.ceil(totalDuration * projectFps);

        // Auto-pause at the end of the timeline
        if (frame >= durationInFrames - 1) {
          setIsPlaying(false);
        }

        setCurrentTime(frame / projectFps);
      }
      handle = requestAnimationFrame(loop);
    };

    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [isPlaying, projectFps, setCurrentTime, totalDuration]);

  // --- MEMOIZE INPUT PROPS ---
  const inputProps = useMemo(
    () => ({
      tracks,
      volume,
      fps: projectFps,
      videoBlobs,
    }),
    [tracks, volume, projectFps, videoBlobs]
  );

  return (
    <div className="w-full h-full flex items-center justify-center bg-black">
      <Player
        ref={playerRef}
        component={TimelineComposition}
        inputProps={inputProps}
        durationInFrames={Math.max(1, Math.ceil(totalDuration * projectFps))}
        fps={projectFps}
        compositionWidth={1920}
        compositionHeight={1080}
        style={{ width: "100%", height: "100%" }}
        controls={false}
        loop={false}
        autoPlay={isPlaying}
      />
    </div>
  );
}