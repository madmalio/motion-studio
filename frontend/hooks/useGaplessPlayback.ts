import { useState, useRef, useEffect, useCallback } from "react";

// --- TYPES ---
interface PlaybackShot {
  id: string;
  outputVideo: string;
  duration: number;
  timelineId: string;
  startTime?: number;
  trimStart?: number;
  offset?: number; // Calculated internally
}

interface UseGaplessPlaybackProps {
  tracks: any[][];
  trackSettings: { locked: boolean; visible: boolean; name: string }[];
  totalDuration: number;
  videoBlobs?: Map<string, string>;
  volume: number;
  isReversePlaying: boolean;
}

// HELPER: Convert local file path to a browser-accessible URL
const convertFileSrc = (filePath: string) => {
  if (!filePath) return "";
  if (filePath.startsWith("http")) return filePath;
  if (filePath.startsWith("blob:")) return filePath;

  // IMPORTANT: We prepend "/video/" so the Go Handler knows to pick this up.
  // We do NOT encodeURIComponent the whole path because Windows drive colons (C:)
  // sometimes get messy if over-encoded.
  return `http://localhost:3456/video/${filePath.replace(/\\/g, "/")}`;
};

export function useGaplessPlayback({
  tracks,
  trackSettings,
  totalDuration,
  videoBlobs,
  volume,
  isReversePlaying,
}: UseGaplessPlaybackProps) {
  const primaryVideoRef = useRef<HTMLVideoElement>(null);
  const secondaryVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentTimeRef = useRef(0);
  const activePlayerRef = useRef<"primary" | "secondary">("primary");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activePlayer, setActivePlayer] = useState<"primary" | "secondary">(
    "primary",
  );

  const updateActivePlayer = (p: "primary" | "secondary") => {
    activePlayerRef.current = p;
    setActivePlayer(p);
  };

  // Track loaded state to avoid thrashing src
  const loadedShotIds = useRef<{
    primary: string | null;
    secondary: string | null;
  }>({
    primary: null,
    secondary: null,
  });

  // --- NEW: VOLUME SYNC EFFECT ---
  useEffect(() => {
    if (primaryVideoRef.current) {
      primaryVideoRef.current.volume = volume;
    }
    if (secondaryVideoRef.current) {
      secondaryVideoRef.current.volume = volume;
    }
  }, [volume]);

  // 1. FLATTEN TRACKS TO FIND ACTIVE SHOT
  const getShotAtTime = useCallback(
    (time: number) => {
      // Iterate tracks from TOP (highest index) to BOTTOM (0)
      for (let t = tracks.length - 1; t >= 0; t--) {
        // Skip disabled tracks
        if (trackSettings[t] && !trackSettings[t].visible) continue;

        const track = tracks[t];
        if (!track) continue;

        for (const shot of track) {
          const duration = shot.duration || 4;
          const shotStart = shot.startTime ?? 0;
          const shotEnd = shotStart + duration;

          if (time >= shotStart && time < shotEnd) {
            return {
              shot: shot as PlaybackShot,
              offset: time - shotStart + (shot.trimStart || 0),
              trackIndex: t,
            };
          }
        }
      }
      return null;
    },
    [tracks, trackSettings],
  );

  // 2. LOAD VIDEO (No Base64!)
  const loadShot = (
    shot: PlaybackShot,
    playerType: "primary" | "secondary",
    startOffset: number = 0,
    forceSeek: boolean = false,
  ) => {
    const videoEl =
      playerType === "primary"
        ? primaryVideoRef.current
        : secondaryVideoRef.current;
    if (!videoEl) return;

    const isNewSource = loadedShotIds.current[playerType] !== shot.id;
    if (isNewSource) {
      // DIRECT FILE SOURCE
      const blobUrl = videoBlobs?.get(shot.outputVideo);
      const src = blobUrl || convertFileSrc(shot.outputVideo);

      videoEl.src = src;
      videoEl.load();
      loadedShotIds.current[playerType] = shot.id;

      // Apply volume immediately on load
      videoEl.volume = volume;

      // PRE-SEEK
      try {
        videoEl.currentTime = startOffset;
      } catch (e) {
        // Ignore if metadata not loaded yet
      }

      const onLoaded = () => {
        videoEl.currentTime = startOffset;
      };
      videoEl.addEventListener("loadedmetadata", onLoaded, { once: true });
    } else if (forceSeek) {
      if (Math.abs(videoEl.currentTime - startOffset) > 0.05) {
        videoEl.currentTime = startOffset;
      }
    }
  };

  // HELPER: Draw to Canvas
  const renderFrame = useCallback(
    (time: number, force: boolean = false) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;

      const activeData = getShotAtTime(time);

      if (!activeData) {
        // GAP: Draw Black
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const activeEl =
        activePlayerRef.current === "primary"
          ? primaryVideoRef.current
          : secondaryVideoRef.current;

      const minReady = isPlaying && !force ? 3 : 2;

      if (activeEl && activeEl.readyState >= minReady) {
        ctx.drawImage(activeEl, 0, 0, canvas.width, canvas.height);
      }
    },
    [getShotAtTime, isPlaying],
  );

  // 3. PLAYBACK LOOP (Animation Frame)
  useEffect(() => {
    if (!isPlaying) return;

    let animationFrameId: number;
    let lastTick = performance.now();

    currentTimeRef.current = currentTime;

    const loop = (now: number) => {
      const delta = (now - lastTick) / 1000;
      lastTick = now;
    
      // Use the flag to decide: Add time or Subtract time?
      let nextTime = isReversePlaying 
        ? currentTimeRef.current - delta 
        : currentTimeRef.current + delta;
    
      // Boundary Check: If we hit the end (Forward)
      if (!isReversePlaying && nextTime >= totalDuration && totalDuration > 0) {
        setIsPlaying(false);
        loadedShotIds.current = { primary: null, secondary: null };
        return;
      }
    
      // Boundary Check: If we hit the start (Reverse)
      if (isReversePlaying && nextTime <= 0) {
        nextTime = 0;
        setIsPlaying(false); // Stop the engine at 0:00
      }
    
      currentTimeRef.current = nextTime;
      setCurrentTime(nextTime);
    
      renderFrame(nextTime);
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, totalDuration, renderFrame]);

  // 4. SYNC PLAYERS
  useEffect(() => {
    const activeData = getShotAtTime(currentTime);
    const p = primaryVideoRef.current;
    const s = secondaryVideoRef.current;
    let currentShotEnd = currentTime;

    let targetPlayer: "primary" | "secondary" = activePlayer;

    // --- 1. HANDLE ACTIVE SHOT ---
    if (activeData) {
      const { shot, offset } = activeData;
      currentShotEnd = (shot.startTime || 0) + (shot.duration || 0);

      if (loadedShotIds.current.primary === shot.id) {
        targetPlayer = "primary";
      } else if (loadedShotIds.current.secondary === shot.id) {
        targetPlayer = "secondary";
      } else {
        targetPlayer = activePlayer === "primary" ? "secondary" : "primary";
        loadShot(shot, targetPlayer, offset, true);
      }

      if (activePlayer !== targetPlayer) {
        updateActivePlayer(targetPlayer);
      }

      const activeEl = targetPlayer === "primary" ? p : s;
      const otherEl = targetPlayer === "primary" ? s : p;

      // Sync Active Player
      if (activeEl) {
        const drift = Math.abs(activeEl.currentTime - (offset || 0));
        const tolerance = isPlaying ? 0.5 : 0.05;
        if (drift > tolerance) {
          if (Number.isFinite(offset) && activeEl.readyState >= 1) {
            activeEl.currentTime = offset || 0;
          }
        }

        if (isPlaying && activeEl.paused) {
          activeEl.play().catch(() => {});
        } else if (!isPlaying && !activeEl.paused) {
          activeEl.pause();
        }

        activeEl.muted = false;

        if (!isPlaying) {
          requestAnimationFrame(() => renderFrame(currentTime));
        }
      }

      // Sync Inactive Player
      if (otherEl) {
        otherEl.pause();
        otherEl.muted = true;
      }
    } else {
      // GAP
      if (p) {
        p.style.opacity = "0";
        p.pause();
      }
      if (s) {
        if (!isPlaying) {
          requestAnimationFrame(() => renderFrame(currentTime));
        }
        s.style.opacity = "0";
        s.pause();
      }
    }

    // --- 2. PRELOAD NEXT SHOT ---
    let nextShot: PlaybackShot | null = null;
    let minDiff = Infinity;

    for (let t = 0; t < tracks.length; t++) {
      if (trackSettings[t] && !trackSettings[t].visible) continue;
      const track = tracks[t];
      for (const shot of track) {
        const sTime = shot.startTime ?? 0;
        if (sTime >= currentShotEnd - 0.5) {
          if (activeData && shot.id === activeData.shot.id) continue;
          const diff = sTime - currentShotEnd;
          if (diff < minDiff) {
            minDiff = diff;
            nextShot = shot as PlaybackShot;
          }
        }
      }
    }

    if (nextShot) {
      const preloadPlayer =
        targetPlayer === "primary" ? "secondary" : "primary";
      if (loadedShotIds.current[preloadPlayer] !== nextShot.id) {
        loadShot(nextShot, preloadPlayer, nextShot.trimStart || 0, true);
      }
    }
  }, [
    currentTime,
    isPlaying,
    getShotAtTime,
    activePlayer,
    tracks,
    trackSettings,
    videoBlobs,
    renderFrame,
    volume, // Added dependency to volume to ensure updates
  ]);

  // 5. EVENT LISTENERS
  useEffect(() => {
    const onFrameReady = () => {
      requestAnimationFrame(() => renderFrame(currentTimeRef.current, true));
    };

    const p = primaryVideoRef.current;
    const s = secondaryVideoRef.current;

    if (p) {
      p.addEventListener("seeked", onFrameReady);
      p.addEventListener("loadeddata", onFrameReady);
    }
    if (s) {
      s.addEventListener("seeked", onFrameReady);
      s.addEventListener("loadeddata", onFrameReady);
    }

    return () => {
      if (p) {
        p.removeEventListener("seeked", onFrameReady);
        p.removeEventListener("loadeddata", onFrameReady);
      }
      if (s) {
        s.removeEventListener("seeked", onFrameReady);
        s.removeEventListener("loadeddata", onFrameReady);
      }
    };
  }, [renderFrame]);

  const togglePlay = () => setIsPlaying(!isPlaying);

  const seekTo = (time: number) => {
    const t = Math.max(0, Math.min(time, totalDuration));
    setCurrentTime(t);
    currentTimeRef.current = t;
  };

  return {
    primaryVideoRef,
    secondaryVideoRef,
    canvasRef,
    activePlayer,
    isPlaying,
    togglePlay,
    currentTime,
    seekTo,
    duration: totalDuration,
  };
}
