import { AbsoluteFill, Video, Audio, Sequence, Img, useCurrentFrame } from "remotion";
import { RemotionManifest } from "@/lib/remotionBridge";

// Helper to safely encode Windows paths for URLs
const getSafeUrl = (filePath: string) => {
  if (!filePath) return "";
  if (filePath.startsWith("http") || filePath.startsWith("blob"))
    return filePath;

  // Use the static video endpoint for better performance/caching during playback
  return `http://localhost:3456/video/${encodeURIComponent(filePath.replace(/\\/g, "/"))}`;
};

// --- BUFFERED VIDEO COMPONENT ---
// Grand Unified Strategy (The Proxy Force):
// 1. ALL clips get a massive 3-second (90 frame) warm-up buffer.
// 2. Trimmed clips (with handles) play at 1.0x speed (Seamless).
// 3. Raw clips (no handles) play at 0.1x speed (Safe Slow-Mo).
//    - This ensures decoder is active without eating too much content.
const BufferedVideo = ({ src, startFrom, volume, playbackRate, onError, preBufferFrames, preRollSpeed }: any) => {
  const frame = useCurrentFrame();

  // Opacity Logic:
  // If we are in the pre-buffer window, be invisible.
  const isPreroll = frame < preBufferFrames;

  // Speed Logic:
  // During pre-roll, usage the calculated safe speed (1.0 or 0.1).
  // After pre-roll, use normal speed (usually 1.0).
  const currentRate = isPreroll ? (preRollSpeed || 1) : (playbackRate || 1);

  return (
    <Video
      src={src}
      crossOrigin="anonymous"
      startFrom={startFrom}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        backgroundColor: "transparent",
        opacity: isPreroll ? 0 : 1, // Fade in instantly after pre-roll
      }}
      volume={volume}
      // @ts-ignore
      preload="auto"
      playbackRate={currentRate}
      onError={onError}
    />
  );
};

export const TimelineComposition = (props: any) => {
  const {
    tracks,
    fps,
    volume: globalVolume,
    videoBlobs,
  } = props as RemotionManifest & {
    volume: number;
    videoBlobs?: Map<string, string>;
    previewUrl?: string | null;
  };

  // --- CACHED PLAYBACK MODE ---
  // If a prerender exists, we bypass the complex track stacking and just play the flat file.
  // This guarantees 0 gaps during playback.
  if (props.previewUrl) {
    return (
      <AbsoluteFill style={{ backgroundColor: "black" }}>
        <Video
          src={props.previewUrl}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          crossOrigin="anonymous"
          // @ts-ignore
          preload="auto"
        />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {(() => {
        // 1. Flatten all clips into a single list with metadata
        const allClips = tracks.flatMap((t, trackIdx) => {
          const track = t as any;
          if (track.isHidden) return [];

          return track.clips.map((clip: any, clipIdx: number) => {
            const c = clip as any;

            // --- CRITICAL FIX: MATHEMATICALLY GAPLESS FRAME CALCULATION ---
            let startFrame = 0;
            let durationInFrames = 0;

            if (typeof c.start === "number" && typeof c.duration === "number") {
              startFrame = Math.round(c.start * fps);
              const endFrame = Math.round((c.start + c.duration) * fps);
              durationInFrames = endFrame - startFrame;
            } else {
              startFrame = c.startFrame;
              durationInFrames = c.endFrame - c.startFrame;
            }

            return {
              id: c.id ?? `${track.id}-${clipIdx}`,
              clip: c,
              trackIdx,
              trackIsMuted: track.isMuted,
              startFrame, // Original Start
              durationInFrames, // Original Duration
              // Z-INDEX SORTING: -clipIdx ensures later clips (Clip 2) are LOWER in the stack than Clip 1
              // Crucial so the Universal Buffer of Clip 2 hides behind Clip 1.
              score: (tracks.length - trackIdx) * 1000 - clipIdx,
            };
          });
        });

        // 2. Sort by Score (Low -> High)
        allClips.sort((a, b) => a.score - b.score);

        // 3. Render
        return allClips.map((item) => {
          const { clip: c, startFrame, durationInFrames, trackIsMuted } = item;

          let renderStart = startFrame;
          let renderDuration = durationInFrames;
          let preBuffer = 0;
          let driftOffset = 0;
          let preRollSpeed = 1;

          // Apply Universal Buffer to VIDEO only
          if (c.type !== 'audio' && !/\.(jpg|jpeg|png|webp|gif)$/i.test(c.src || "")) {
            // PROXY ENGINE ENABLED:
            // With the backend now producing "Fast Decode" media (GOP 15), we don't need massive buffers.
            // We stick to the "Intelligent" Strategy (Scenario A/B) at 1.0x speed.
            const TARGET_BUFFER = 15; // 0.5s is enough for tuned media
            const MIN_BUFFER = 3;     // 0.1s floor

            const trimStartFrames = Math.round((c.trimStart || c.offset || 0) * fps);

            if (trimStartFrames >= TARGET_BUFFER) {
              // Scenario A: Use handle
              preBuffer = TARGET_BUFFER;
              driftOffset = TARGET_BUFFER;
            } else {
              // Scenario B: Raw clip / No Handle
              // PROXY ENGINE TUNING:
              // 0 frames caused a black flash (decoder wake-up > 0ms).
              // 3 frames caused a visible skip (100ms).
              // We compromise with a 1-frame Micro-Buffer (33ms).
              // This should be invisible enough but sufficient for the fast-decode media.
              preBuffer = 1;
              driftOffset = 0;
            }

            preRollSpeed = 1.0; // Strictly stable speed

            renderStart -= preBuffer;
            renderDuration += preBuffer;
          }

          // Compensation:
          const startFromFrames = Math.max(0, Math.round((c.trimStart || c.offset || 0) * fps) - driftOffset);

          // RESOLVE SOURCE
          let src = c.src || c.file || "";
          if (videoBlobs && videoBlobs instanceof Map && videoBlobs.has(src)) {
            src = videoBlobs.get(src)!;
          } else {
            src = getSafeUrl(src);
          }

          if (!src) return null;

          const volume = typeof c.volume === "number" ? c.volume : 1;
          const finalVolume = volume * (typeof globalVolume === "number" ? globalVolume : 1);
          const isMuted = finalVolume === 0 || !!trackIsMuted || !!c.isMuted;
          const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(src);

          // Dynamic Volume: Handle Muting & Track Occlusion
          const volumeFn = (f: number) => {
            if (isMuted) return 0;
            // Note: f includes pre-roll frames. 
            // We align volume logic to logical frames by subtracting preBuffer.
            const logicalFrame = startFrame + (f - preBuffer);

            // Check against *logical* boundaries of other clips
            const isOccluded = allClips.some((other) => {
              if (other.trackIdx >= item.trackIdx) return false;
              // Check strictly against *logical* boundaries (without buffer)
              return logicalFrame >= other.startFrame && logicalFrame < (other.startFrame + other.durationInFrames);
            });
            return isOccluded ? 0 : finalVolume;
          };

          return (
            <Sequence
              key={item.id}
              from={renderStart}
              durationInFrames={renderDuration}
            >
              {c.type === "audio" ? (
                <Audio
                  src={src}
                  startFrom={startFromFrames}
                  volume={volumeFn}
                  onError={(e) => console.error(`❌ Audio File Failed: ${src}`, e)}
                />
              ) : isImage ? (
                <Img
                  src={src}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              ) : (
                <BufferedVideo
                  src={src}
                  startFrom={startFromFrames}
                  volume={volumeFn}
                  preBufferFrames={preBuffer}
                  preRollSpeed={preRollSpeed}
                  onError={(e: any) => console.error(`❌ Video Failed: ${src}`, e)}
                />
              )}
            </Sequence>
          );
        });
      })()}
    </AbsoluteFill>
  );
};