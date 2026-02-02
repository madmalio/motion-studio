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
  trackSettings: {
    locked: boolean;
    visible: boolean;
    name: string;
    type?: "audio" | "video";
  }[];
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

      // 1) Find winning VIDEO.
      // Tracks are ordered by precedence (e.g. V2 is at a lower index than V1).
      // The first visible video track with a clip at the current time wins.
      for (let t = 0; t < tracks.length; t++) {
        const settings = trackSettings[t];
        const isAudio =
          settings?.type === "audio" ||
          (!settings?.type &&
            (settings?.name || "").trim().toUpperCase().startsWith("A"));

        if (isAudio) continue;
        if (settings && settings.visible === false) continue;

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
              shot,
              offset: time - shotStart + (shot.trimStart || 0),
              trackIndex: t,
            };
            break; // Found clip on this track
          }
        }
        if (videoData) {
          break; // Found winning video, no need to check lower tracks
        }
      }

      // 2) Find winning AUDIO.
      // Audio tracks are added after video tracks. Higher index = higher precedence.
      // We iterate backwards to find the topmost audio track.
      for (let t = tracks.length - 1; t >= 0; t--) {
        const settings = trackSettings[t];
        const isAudio =
          settings?.type === "audio" ||
          (!settings?.type &&
            (settings?.name || "").trim().toUpperCase().startsWith("A"));

        if (!isAudio) continue;
        if (settings && settings.visible === false) continue;

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
              shot,
              offset: time - shotStart + (shot.trimStart || 0),
              trackIndex: t,
            };
            break; // Found clip on this track
          }
        }
        if (audioData) {
          break; // Found winning audio, no need to check lower tracks
        }
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

      const activeEl = primaryVideoRef.current;
      const minReady = isPlaying && !force ? 2 : 2; // Relaxed requirement

      if (activeEl && activeEl.readyState >= minReady) {
        ctx.drawImage(activeEl, 0, 0, canvas.width, canvas.height);
      }
    },
    [getShotAtTime, isPlaying],
  );

  // 3. PLAYBACK LOOP (FIXED RACE CONDITION)
  useEffect(() => {
    if (!isPlaying) return;

    let animationFrameId: number;
    let lastTick = performance.now();

    currentTimeRef.current = currentTime;

    const loop = (now: number) => {
      const delta = (now - lastTick) / 1000;
      lastTick = now;

      // --- SYNC CHECK: WAIT FOR BUFFERING ---
      // Check if the ACTIVE media element is actually ready to play.
      // If it is seeking or buffering, we DO NOT advance the time.
      const { videoData, audioData } = getShotAtTime(currentTimeRef.current);
      let activeEl = null;

      // Determine "Leader" element
      if (videoData) activeEl = primaryVideoRef.current;
      else if (audioData) activeEl = secondaryVideoRef.current;

      if (activeEl) {
        // readyState 3 = HAVE_FUTURE_DATA (Smooth)
        // readyState 2 = HAVE_CURRENT_DATA (Frame available)
        // If we are less than 3, or seeking, we STALL.
        if (activeEl.readyState < 3 || activeEl.seeking) {
          // By returning here, we effectively PAUSE the timeline,
          // but because we updated `lastTick` above, the delta won't accumulate.
          // This prevents the "Jump" when playback resumes.
          animationFrameId = requestAnimationFrame(loop);
          return;
        }
      }
      // --------------------------------------

      let nextTime = currentTimeRef.current + delta;

      if (nextTime >= totalDuration && totalDuration > 0) {
        setIsPlaying(false);
        return;
      }

      currentTimeRef.current = nextTime;
      setCurrentTime(nextTime);

      renderFrame(nextTime);
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, totalDuration, renderFrame, getShotAtTime]);

  // 4. SYNC PLAYERS
  useEffect(() => {
    const { videoData, audioData } = getShotAtTime(currentTime);

    const p = primaryVideoRef.current;
    const s = secondaryVideoRef.current;

    // -------------------------
    // VISUALS (PRIMARY ONLY)
    // -------------------------
    if (videoData?.shot && p) {
      const vShot = videoData.shot;
      const vOffset = videoData.offset ?? 0;

      if (loadedShotIds.current.primary !== vShot.id) {
        loadShot(vShot, "primary", vOffset, true);
      } else {
        const drift = Math.abs(p.currentTime - vOffset);
        const tolerance = isPlaying ? 0.25 : 0.05;
        if (
          drift > tolerance &&
          p.readyState >= 1 &&
          Number.isFinite(vOffset)
        ) {
          p.currentTime = vOffset;
        }
      }

      if (isPlaying && p.paused) p.play().catch(() => {});
      if (!isPlaying && !p.paused) p.pause();

      const hasVisibleAudioTrack = trackSettings.some((t) => {
        const isAudio =
          t.type === "audio" ||
          (!t.type && (t.name || "").trim().toUpperCase().startsWith("A"));
        return isAudio && t.visible;
      });
      p.muted =
        Boolean(audioData) || Boolean(vShot.muted) || hasVisibleAudioTrack;

      if (!isPlaying) requestAnimationFrame(() => renderFrame(currentTime));
    } else {
      if (p) {
        p.pause();
        p.muted = true;
      }
    }

    // -------------------------
    // AUDIO
    // -------------------------
    if (s) {
      if (audioData?.shot) {
        const aShot = audioData.shot;
        const aOffset = audioData.offset ?? 0;

        if (loadedShotIds.current.secondary !== aShot.id) {
          loadShot(aShot, "secondary", aOffset, true);
        } else {
          const drift = Math.abs(s.currentTime - aOffset);
          const tolerance = isPlaying ? 0.25 : 0.05;
          if (
            drift > tolerance &&
            s.readyState >= 1 &&
            Number.isFinite(aOffset)
          ) {
            s.currentTime = aOffset;
          }
        }

        s.muted = Boolean(aShot.muted);

        if (isPlaying && s.paused) s.play().catch(() => {});
        if (!isPlaying && !s.paused) s.pause();
      } else {
        s.pause();
        s.muted = true;
      }
    }
  }, [currentTime, isPlaying, getShotAtTime, renderFrame, trackSettings]);

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
