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
  tracks: any[][]; // Accepts the tracks from your page state
  trackSettings: { locked: boolean; visible: boolean; name: string }[];
  totalDuration: number;
  videoBlobs?: Map<string, string>;
}

// HELPER: Convert local file path to a browser-accessible URL
const convertFileSrc = (filePath: string) => {
  if (!filePath) return "";
  if (filePath.startsWith("http")) return filePath;
  if (filePath.startsWith("blob:")) return filePath;

  // IMPORTANT: We prepend "/video/" so the Go Handler knows to pick this up.
  // We do NOT encodeURIComponent the whole path because Windows drive colons (C:)
  // sometimes get messy if over-encoded.
  // If your paths have spaces, you might need encodeURI(filePath).
  // ✅ Use the Go server explicitly to ensure we hit the file handler
  return `http://localhost:3456/video/${filePath.replace(/\\/g, "/")}`;
};

export function useGaplessPlayback({
  tracks,
  trackSettings,
  totalDuration,
  videoBlobs,
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

  // 1. FLATTEN TRACKS TO FIND ACTIVE SHOT
  // This calculates which shot *should* be playing at the current time.
  // It prioritizes higher tracks (V2 over V1).
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
              offset: time - shotStart + (shot.trimStart || 0), // How many seconds INTO the clip are we?
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
      // ✅ Use Blob URL if available (Pre-loaded), otherwise fallback to file server
      const blobUrl = videoBlobs?.get(shot.outputVideo);
      const src = blobUrl || convertFileSrc(shot.outputVideo);

      videoEl.src = src;
      videoEl.load();
      loadedShotIds.current[playerType] = shot.id;

      // ✅ AGGRESSIVE PRE-SEEK: Set time immediately so buffer starts at correct point
      try {
        videoEl.currentTime = startOffset;
      } catch (e) {
        // Ignore if metadata not loaded yet, event listener will catch it
      }

      const onLoaded = () => {
        videoEl.currentTime = startOffset;
      };
      videoEl.addEventListener("loadedmetadata", onLoaded, { once: true });
    } else if (forceSeek) {
      // If reusing the player (e.g. looping same shot), ensure we seek to the new start
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
      const ctx = canvas.getContext("2d", { alpha: false }); // Optimize for no transparency
      if (!ctx) return;

      // Check if we are in a gap
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

      // ✅ PREVENT FLASHING:
      // If playing, wait for HAVE_FUTURE_DATA (3) to ensure smooth playback.
      // If paused (scrubbing), HAVE_CURRENT_DATA (2) is sufficient.
      // If forced (seeked event), accept 2 to show frame immediately.
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

    // Sync ref on start
    currentTimeRef.current = currentTime;

    const loop = (now: number) => {
      const delta = (now - lastTick) / 1000; // Seconds passed
      lastTick = now;

      let nextTime = currentTimeRef.current + delta;

      if (nextTime >= totalDuration && totalDuration > 0) {
        setIsPlaying(false);
        loadedShotIds.current = { primary: null, secondary: null };
        return;
      }

      currentTimeRef.current = nextTime;
      setCurrentTime(nextTime);

      renderFrame(nextTime); // Draw every frame during playback
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animationFrameId);
    // Note: currentTime is intentionally omitted from deps to prevent loop restart on every frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // Determine which player SHOULD be active
      if (loadedShotIds.current.primary === shot.id) {
        targetPlayer = "primary";
      } else if (loadedShotIds.current.secondary === shot.id) {
        targetPlayer = "secondary";
      } else {
        // Not loaded anywhere? Load into the 'other' player to prepare for switch
        // or fallback to switching immediately if we missed the preload window.
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
        const drift = Math.abs(activeEl.currentTime - offset);
        // ✅ RELAX DRIFT CHECK: Prevent micro-stutters during playback
        // If playing, allow more drift (0.25s) before forcing a seek.
        const tolerance = isPlaying ? 0.5 : 0.05;
        if (drift > tolerance) {
          if (Number.isFinite(offset) && activeEl.readyState >= 1) {
            activeEl.currentTime = offset;
          }
        }

        if (isPlaying && activeEl.paused) {
          activeEl.play().catch(() => {});
        } else if (!isPlaying && !activeEl.paused) {
          activeEl.pause();
        }

        activeEl.muted = false;

        // Force a draw immediately after sync (for scrubbing/pausing)
        if (!isPlaying) {
          requestAnimationFrame(() => renderFrame(currentTime));
        }
      }

      // Sync Inactive Player (Pause & Hide)
      if (otherEl) {
        otherEl.pause();
        otherEl.muted = true;
      }
    } else {
      // GAP: Hide both
      if (p) {
        p.style.opacity = "0";
        p.pause();
      }
      if (s) {
        // Ensure canvas is cleared during gaps when scrubbing
        if (!isPlaying) {
          requestAnimationFrame(() => renderFrame(currentTime));
        }
        s.style.opacity = "0";
        s.pause();
      }
    }

    // --- 2. PRELOAD NEXT SHOT ---
    // Find the closest shot that starts >= currentShotEnd
    let nextShot: PlaybackShot | null = null;
    let minDiff = Infinity;

    for (let t = 0; t < tracks.length; t++) {
      if (trackSettings[t] && !trackSettings[t].visible) continue;

      const track = tracks[t];
      for (const shot of track) {
        const sTime = shot.startTime ?? 0;
        // Look for shots starting in the future (relative to current clip end)
        if (sTime >= currentShotEnd - 0.5) {
          // Don't preload the current shot again
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
      // Load into the INACTIVE player
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
  ]);

  // 5. EVENT LISTENERS (NEW)
  useEffect(() => {
    const onFrameReady = () => {
      // Force a draw when new data is available (seek complete, or initial load)
      requestAnimationFrame(() => renderFrame(currentTimeRef.current, true));
    };

    const p = primaryVideoRef.current;
    const s = secondaryVideoRef.current;

    if (p) {
      p.addEventListener("seeked", onFrameReady);
      p.addEventListener("loadeddata", onFrameReady); // ✅ Catch initial load
    }
    if (s) {
      s.addEventListener("seeked", onFrameReady);
      s.addEventListener("loadeddata", onFrameReady); // ✅ Catch initial load
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
