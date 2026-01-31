import { useState, useRef, useEffect, useCallback } from "react";

// --- TYPES ---
interface PlaybackShot {
  id: string;
  outputVideo: string;
  audioPath?: string; // Added support for audio-only files
  duration: number;
  timelineId: string;
  startTime?: number;
  trimStart?: number;
  offset?: number;
  hidden?: boolean; // Added support for forced hiding
  muted?: boolean;
}

interface UseGaplessPlaybackProps {
  tracks: any[][];
  trackSettings: { locked: boolean; visible: boolean; name: string }[];
  totalDuration: number;
  videoBlobs?: Map<string, string>;
  volume: number;
}

// HELPER: Convert local file path to a browser-accessible URL
const convertFileSrc = (filePath: string) => {
  if (!filePath) return "";
  if (filePath.startsWith("http")) return filePath;
  if (filePath.startsWith("blob:")) return filePath;

  // IMPORTANT: Prepend "/video/" for the Go Handler
  return `http://localhost:3456/video/${filePath.replace(/\\/g, "/")}`;
};

export function useGaplessPlayback({
  tracks,
  trackSettings,
  totalDuration,
  videoBlobs,
  volume,
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

  // --- VOLUME SYNC ---
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
      let videoData = null;
      let audioData = null;

      // 1. Find Video Source (Visuals)
      for (let t = tracks.length - 1; t >= 0; t--) {
        const settings = trackSettings[t];
        const isAudio =
          settings?.type === "audio" ||
          settings?.name?.trim().toUpperCase().startsWith("A");

        if (isAudio) continue;

        const track = tracks[t];
        if (!track || track.length === 0) continue;

        for (const rawShot of track) {
          const shot = rawShot as PlaybackShot;
          if (shot.hidden) continue;
          const duration = shot.duration || 4;
          const shotStart = shot.startTime ?? 0;
          const shotEnd = shotStart + duration;

          if (time >= shotStart && time < shotEnd) {
            videoData = {
              shot: shot,
              offset: time - shotStart + (shot.trimStart || 0),
              trackIndex: t,
            };
            break;
          }
        }
        if (videoData) break;
      }

      // 2. Find Audio Source (Sound)
      for (let t = tracks.length - 1; t >= 0; t--) {
        const settings = trackSettings[t];
        const isAudio =
          settings?.type === "audio" ||
          settings?.name?.trim().toUpperCase().startsWith("A");

        if (!isAudio) continue;

        const track = tracks[t];
        if (!track || track.length === 0) continue;

        for (const rawShot of track) {
          const shot = rawShot as PlaybackShot;
          if (shot.hidden) continue;
          const duration = shot.duration || 4;
          const shotStart = shot.startTime ?? 0;
          const shotEnd = shotStart + duration;

          if (time >= shotStart && time < shotEnd) {
            audioData = {
              shot: shot,
              offset: time - shotStart + (shot.trimStart || 0),
              trackIndex: t,
            };
            break;
          }
        }
        if (audioData) break;
      }

      return { videoData, audioData };
    },
    [tracks, trackSettings],
  );

  // 2. LOAD VIDEO OR AUDIO
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
      // Prioritize outputVideo, fallback to audioPath
      const filePath = shot.outputVideo || shot.audioPath;

      if (!filePath) {
        // No media to play
        videoEl.removeAttribute("src");
        return;
      }

      const blobUrl = videoBlobs?.get(filePath);
      const src = blobUrl || convertFileSrc(filePath);

      videoEl.src = src;
      videoEl.load();
      loadedShotIds.current[playerType] = shot.id;

      videoEl.volume = volume;

      try {
        videoEl.currentTime = startOffset;
      } catch (e) {}

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

      const { videoData } = getShotAtTime(time);

      if (!videoData) {
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

      // Only draw if we have a valid element and it's not a pure audio track (optional check)
      if (activeEl && activeEl.readyState >= minReady) {
        ctx.drawImage(activeEl, 0, 0, canvas.width, canvas.height);
      }
    },
    [getShotAtTime, isPlaying],
  );

  // 3. PLAYBACK LOOP
  useEffect(() => {
    if (!isPlaying) return;

    let animationFrameId: number;
    let lastTick = performance.now();

    currentTimeRef.current = currentTime;

    const loop = (now: number) => {
      const delta = (now - lastTick) / 1000;
      lastTick = now;

      let nextTime = currentTimeRef.current + delta;

      if (nextTime >= totalDuration && totalDuration > 0) {
        setIsPlaying(false);
        // Do not clear loadedShotIds here to prevent black flash on replay
        return;
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
    const { videoData, audioData } = getShotAtTime(currentTime);
    const activeData = videoData || audioData;
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

        activeEl.muted = !audioData;

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
      // GAP - Ensure silence and pause
      if (p) {
        p.style.opacity = "0";
        p.pause();
      }
      if (s) {
        s.style.opacity = "0";
        s.pause();
      }
      if (!isPlaying) {
        requestAnimationFrame(() => renderFrame(currentTime));
      }
    }

    // --- 2. PRELOAD NEXT SHOT ---
    let nextShot: PlaybackShot | null = null;
    let minDiff = Infinity;

    for (let t = 0; t < tracks.length; t++) {
      if (trackSettings[t] && !trackSettings[t].visible) continue;
      const track = tracks[t];
      for (const rawShot of track) {
        const shot = rawShot as PlaybackShot;
        if (shot.hidden) continue; // Skip hidden shots during preload check

        const sTime = shot.startTime ?? 0;
        if (sTime >= currentShotEnd - 0.5) {
          if (activeData && shot.id === activeData.shot.id) continue;
          const diff = sTime - currentShotEnd;
          if (diff < minDiff) {
            minDiff = diff;
            nextShot = shot;
          }
        }
      }
    }

    if (nextShot) {
      const preloadPlayer =
        targetPlayer === "primary" ? "secondary" : "primary";
      if (
        loadedShotIds.current[preloadPlayer] !== (nextShot as PlaybackShot).id
      ) {
        loadShot(
          nextShot as PlaybackShot,
          preloadPlayer,
          (nextShot as PlaybackShot).trimStart || 0,
          true,
        );
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
    volume,
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
    setIsPlaying,
    togglePlay,
    currentTime,
    seekTo,
    duration: totalDuration,
  };
}
