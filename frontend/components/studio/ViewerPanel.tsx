"use client";
import React, { useRef, useEffect, useState } from "react";
import { Player } from "@remotion/player";
import { AbsoluteFill, Sequence, Video, Audio, Img } from "remotion";
import { HelloWorld } from "./HelloWorld";

export default function ViewerPanel({
  tracks,
  totalDuration,
  currentTime,
  isPlaying,
  setIsPlaying,
  setCurrentTime,
  projectFps = 30,
  volume = 1,
  videoBlobs, // <--- NEW PROP
}: any) {
  const playerRef = useRef<any>(null);

  // --- FORCE VOLUME UPDATE ---
  // The Remotion Player usually handles volume via props, but sometimes
  // needs a hard nudget depending on how the Composition uses the audio.
  // This is a safety wrapper.
  useEffect(() => {
    if (playerRef.current) {
      // Remotion player wrapper specific logic if available,
      // otherwise we rely on the Composition passing the volume prop down.
    }
  }, [volume]);

  // --- SYNC PLAYBACK STATE ---
  useEffect(() => {
    if (!playerRef.current) return;

    if (isPlaying) {
      if (!playerRef.current.isPlaying()) playerRef.current.play();
    } else {
      if (playerRef.current.isPlaying()) playerRef.current.pause();
    }
  }, [isPlaying]);

  // --- SYNC CURRENT TIME (SEEKING) ---
  useEffect(() => {
    // Prevent fighting: Only seek if we are NOT playing.
    // When playing, the player drives the time, not the state.
    if (isPlaying) return;

    if (playerRef.current) {
      const targetFrame = Math.floor(currentTime * projectFps);
      const currentFrame = playerRef.current.getCurrentFrame();
      if (Math.abs(currentFrame - targetFrame) > 1) {
        playerRef.current.seekTo(targetFrame);
      }
    }
  }, [currentTime, projectFps, isPlaying]);

  // --- POLL CURRENT FRAME DURING PLAYBACK ---
  useEffect(() => {
    if (!isPlaying) return;

    let handle = 0;
    const loop = () => {
      if (playerRef.current) {
        const frame = playerRef.current.getCurrentFrame();
        const durationInFrames = Math.ceil(totalDuration * projectFps);

        // Stop if we reached the end
        if (frame >= durationInFrames - 1) { // -1 buffer to catch it before loop/reset
          setIsPlaying(false);
        }

        setCurrentTime(frame / projectFps);
      }
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [isPlaying, projectFps, setCurrentTime]);

  // --- MEMOIZE INPUT PROPS (CRITICAL FIX) ---
  // We explicitly memoize this object so that the Player doesn't see a "new"
  // input object every single render cycle (which happens on every seek/time update).
  // We also convert the videoBlobs Map to a plain object if needed, or pass it as is.
  // Remotion inputProps must be JSON serializable mostly, but for local preview passing a Map *might* work
  // if we are careful, but safer to pass as an object or just the raw map if we type it.
  // Actually, for client-side player, passing the Map is fine.
  const inputProps = React.useMemo(
    () => ({
      tracks,
      volume,
      fps: projectFps,
      videoBlobs, // Pass the blobs down
    }),
    [tracks, volume, projectFps, videoBlobs],
  );

  return (
    <div className="w-full h-full flex items-center justify-center bg-black">
      <Player
        ref={playerRef}
        component={HelloWorld}
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
