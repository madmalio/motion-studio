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

      const parseTrackNum = (name?: string, prefix?: "V" | "A") => {
        const n = (name || "").trim().toUpperCase();
        if (!prefix || !n.startsWith(prefix)) return -1;
        const m = n.match(/\d+/);
        return m ? parseInt(m[0], 10) : -1;
      };

      // 1) Find winning VIDEO by highest V-number (V3 > V2 > V1), not by array index
      let bestVideo: any = null;
      let bestV = -1;

      for (let t = 0; t < tracks.length; t++) {
        const settings = trackSettings[t];
        const isAudio =
          settings?.type === "audio" ||
          (settings?.name || "").trim().toUpperCase().startsWith("A");
        if (isAudio) continue;
        if (settings && settings.visible === false) continue;

        const vNum = parseTrackNum(settings?.name, "V");
        const track = tracks[t];
        if (!track || track.length === 0) continue;

        for (const rawShot of track) {
          const shot = rawShot as PlaybackShot;
          if (shot.hidden) continue;

          const duration = shot.duration || 4;
          const shotStart = shot.startTime ?? 0;
          const shotEnd = shotStart + duration;

          if (time >= shotStart && time < shotEnd) {
            // higher V-number wins
            if (vNum > bestV) {
              bestV = vNum;
              bestVideo = {
                shot,
                offset: time - shotStart + (shot.trimStart || 0),
                trackIndex: t,
              };
            }
            break; // only need first hit per track
          }
        }
      }

      videoData = bestVideo;

      // AUDIO RULE:
      // - If an A-track is active at the current time, it overrides video audio.
      // - If no A-track is active, audio follows the winning video clip.
      // This is intentional (rough-cut editor behavior)
      let bestAudio: any = null;
      let bestA = -1;

      for (let t = 0; t < tracks.length; t++) {
        const settings = trackSettings[t];
        const isAudio =
          settings?.type === "audio" ||
          (settings?.name || "").trim().toUpperCase().startsWith("A");
        if (!isAudio) continue;
        if (settings && settings.visible === false) continue;

        const aNum = parseTrackNum(settings?.name, "A");
        const track = tracks[t];
        if (!track || track.length === 0) continue;

        for (const rawShot of track) {
          const shot = rawShot as PlaybackShot;
          if (shot.hidden) continue;

          const duration = shot.duration || 4;
          const shotStart = shot.startTime ?? 0;
          const shotEnd = shotStart + duration;

          if (time >= shotStart && time < shotEnd) {
            if (aNum > bestA) {
              bestA = aNum;
              bestAudio = {
                shot,
                offset: time - shotStart + (shot.trimStart || 0),
                trackIndex: t,
              };
            }
            break;
          }
        }
      }

      audioData = bestAudio;

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
      const minReady = isPlaying && !force ? 3 : 2;

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

  // 4. SYNC PLAYERS (Overwrite model)
  // - PRIMARY = visuals (always)
  // - SECONDARY = audio-only when an audio track is active
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

      // Load or seek
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

      // Play/pause
      if (isPlaying && p.paused) p.play().catch(() => {});
      if (!isPlaying && !p.paused) p.pause();

      // If an A-track is active, we do NOT want video audio (prevents echo)
      // If no A-track, video audio is allowed unless the shot is muted
      // FIX: Only mute video audio if there is a VISIBLE audio track.
      const hasVisibleAudioTrack = trackSettings.some(
        (t) =>
          (t.type === "audio" ||
            (t.name || "").trim().toUpperCase().startsWith("A")) &&
          t.visible,
      );
      p.muted =
        Boolean(audioData) || Boolean(vShot.muted) || hasVisibleAudioTrack;

      // When paused, force a redraw so scrubbing shows correct frame
      if (!isPlaying) requestAnimationFrame(() => renderFrame(currentTime));
    } else {
      // No active video: pause visuals
      if (p) {
        p.pause();
        p.muted = true;
      }
    }

    // -------------------------
    // AUDIO
    // -------------------------
    if (s) {
      // If there is an audio track active at this time, play it on SECONDARY.
      if (audioData?.shot) {
        const aShot = audioData.shot;
        const aOffset = audioData.offset ?? 0;

        // Load or seek
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

        // Audio should be audible unless explicitly muted
        s.muted = Boolean(aShot.muted);

        // Play/pause
        if (isPlaying && s.paused) s.play().catch(() => {});
        if (!isPlaying && !s.paused) s.pause();
      } else {
        // No active A-track: secondary must be silent
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
