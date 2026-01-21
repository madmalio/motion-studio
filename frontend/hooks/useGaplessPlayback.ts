import { useState, useRef, useEffect, useCallback } from "react";

// --- TYPES ---
interface PlaybackShot {
  id: string;
  outputVideo: string;
  duration: number;
  timelineId: string;
  offset?: number; // Calculated internally
}

interface UseGaplessPlaybackProps {
  tracks: any[][]; // Accepts the tracks from your page state
  totalDuration: number;
}

// HELPER: Convert local file path to a browser-accessible URL
const convertFileSrc = (filePath: string) => {
  if (!filePath) return "";
  if (filePath.startsWith("http")) return filePath;

  // IMPORTANT: We prepend "/video/" so the Go Handler knows to pick this up.
  // We do NOT encodeURIComponent the whole path because Windows drive colons (C:)
  // sometimes get messy if over-encoded.
  // If your paths have spaces, you might need encodeURI(filePath).
  return "/video/" + filePath;
};

export function useGaplessPlayback({
  tracks,
  totalDuration,
}: UseGaplessPlaybackProps) {
  const primaryVideoRef = useRef<HTMLVideoElement>(null);
  const secondaryVideoRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activePlayer, setActivePlayer] = useState<"primary" | "secondary">(
    "primary",
  );

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
        const track = tracks[t];
        if (!track) continue;

        let currentTrackTime = 0;

        for (const shot of track) {
          const duration = shot.duration || 4;
          const shotStart = currentTrackTime;
          const shotEnd = shotStart + duration;

          if (time >= shotStart && time < shotEnd) {
            return {
              shot: shot as PlaybackShot,
              offset: time - shotStart, // How many seconds INTO the clip are we?
              trackIndex: t,
            };
          }
          currentTrackTime += duration;
        }
      }
      return null;
    },
    [tracks],
  );

  // 2. LOAD VIDEO (No Base64!)
  const loadShot = (
    shot: PlaybackShot,
    playerType: "primary" | "secondary",
  ) => {
    const videoEl =
      playerType === "primary"
        ? primaryVideoRef.current
        : secondaryVideoRef.current;
    if (!videoEl) return;

    if (loadedShotIds.current[playerType] === shot.id) return; // Already loaded

    // DIRECT FILE SOURCE
    // This removes the massive CPU spike of Base64 decoding
    const src = convertFileSrc(shot.outputVideo);

    videoEl.src = src;
    videoEl.load();
    loadedShotIds.current[playerType] = shot.id;
  };

  // 3. PLAYBACK LOOP (Animation Frame)
  useEffect(() => {
    let animationFrameId: number;
    let lastTick = performance.now();

    const loop = (now: number) => {
      if (!isPlaying) return;

      const delta = (now - lastTick) / 1000; // Seconds passed
      lastTick = now;

      setCurrentTime((prev) => {
        const nextTime = prev + delta;
        if (nextTime >= totalDuration && totalDuration > 0) {
          setIsPlaying(false);
          return totalDuration;
        }
        return nextTime;
      });

      animationFrameId = requestAnimationFrame(loop);
    };

    if (isPlaying) {
      lastTick = performance.now();
      animationFrameId = requestAnimationFrame(loop);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, totalDuration]);

  // 4. SYNC PLAYERS
  useEffect(() => {
    const activeData = getShotAtTime(currentTime);
    const p = primaryVideoRef.current;
    const s = secondaryVideoRef.current;

    if (!activeData) {
      // GAP in timeline
      if (p) p.style.opacity = "0";
      if (s) s.style.opacity = "0";
      return;
    }

    const { shot, offset } = activeData;

    // Determine which player to use
    // Simple strategy: Keep using the player that has the shot loaded.
    let targetPlayer: "primary" | "secondary" = "primary";

    if (loadedShotIds.current.secondary === shot.id) targetPlayer = "secondary";
    else targetPlayer = "primary"; // Default to primary

    // Load if needed
    if (loadedShotIds.current[targetPlayer] !== shot.id) {
      loadShot(shot, targetPlayer);
    }

    // Switch visible player
    if (activePlayer !== targetPlayer) setActivePlayer(targetPlayer);

    const activeEl = targetPlayer === "primary" ? p : s;
    const otherEl = targetPlayer === "primary" ? s : p;

    // Sync Time
    if (activeEl) {
      // Only seek if we drifted significantly (> 0.1s) or if scrubbing (paused)
      // This allows the browser's native playback to run smooth during normal play
      const drift = Math.abs(activeEl.currentTime - offset);

      if (!isPlaying || drift > 0.2) {
        if (Number.isFinite(offset)) activeEl.currentTime = offset;
      }

      // Sync Play State
      if (isPlaying && activeEl.paused) {
        activeEl.play().catch((e) => console.warn("Autoplay blocked", e));
      } else if (!isPlaying && !activeEl.paused) {
        activeEl.pause();
      }

      activeEl.style.opacity = "1";
      activeEl.style.zIndex = "10";
    }

    if (otherEl) {
      otherEl.style.opacity = "0";
      otherEl.style.zIndex = "0";
      otherEl.pause();
    }
  }, [currentTime, isPlaying, getShotAtTime, activePlayer]);

  const togglePlay = () => setIsPlaying(!isPlaying);

  const seekTo = (time: number) => {
    const t = Math.max(0, Math.min(time, totalDuration));
    setCurrentTime(t);
  };

  return {
    primaryVideoRef,
    secondaryVideoRef,
    activePlayer,
    isPlaying,
    togglePlay,
    currentTime,
    seekTo,
    duration: totalDuration,
  };
}
