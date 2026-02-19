import { AbsoluteFill, Video, Audio, Sequence, Img } from "remotion";
import { RemotionManifest } from "@/lib/remotionBridge";

// Helper to safely encode Windows paths for URLs
const getSafeUrl = (filePath: string) => {
  if (!filePath) return "";
  if (filePath.startsWith("http") || filePath.startsWith("blob"))
    return filePath;

  // Use the static video endpoint for better performance/caching
  return `http://localhost:3456/video/${encodeURIComponent(filePath.replace(/\\/g, "/"))}`;
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
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {(() => {
        // 1. Flatten all clips into a single list with metadata
        const allClips = tracks.flatMap((t, trackIdx) => {
          const track = t as any;
          if (track.isHidden) return [];

          return track.clips.map((clip: any, clipIdx: number) => {
            const c = clip as any;

            // Calculate timing in frames
            let startFrame = 0;
            let durationInFrames = 0;
            if (typeof c.start === "number" && typeof c.duration === "number") {
              startFrame = Math.round(c.start * fps);
              durationInFrames = Math.round(c.duration * fps);
            } else {
              startFrame = c.startFrame;
              durationInFrames = c.endFrame - c.startFrame;
            }

            return {
              id: c.id ?? `${track.id}-${clipIdx}`,
              clip: c,
              trackIdx,
              trackIsMuted: track.isMuted,
              startFrame,
              endFrame: startFrame + durationInFrames,
              durationInFrames,
              // Invert Z-Index: Track 0 (Top in UI) should be rendered last (Highest Score)
              score: (tracks.length - trackIdx) * 1000,
            };
          });
        });

        // 2. Adjust scores for Gapless Transitions (Overlap Fix)
        const OVERLAP_FRAMES = 3;

        allClips.forEach((outgoing) => {
          allClips.forEach((incoming) => {
            if (outgoing === incoming) return;
            if (outgoing.trackIdx !== incoming.trackIdx) return;

            const diff = incoming.startFrame - outgoing.endFrame;
            if (Math.abs(diff) <= 1) {
              if (outgoing.score <= incoming.score) {
                outgoing.score = incoming.score + 1;
              }
            }
          });
        });

        // 3. Sort by Score (Low -> High)
        allClips.sort((a, b) => a.score - b.score);

        // 4. Render
        return allClips.map((item) => {
          const { clip: c, startFrame, durationInFrames, trackIsMuted } = item;

          const startFromFrames = Math.round(
            (c.trimStart || c.offset || 0) * fps,
          );

          // RESOLVE SOURCE
          let src = c.src || c.file || "";
          if (videoBlobs && videoBlobs instanceof Map && videoBlobs.has(src)) {
            src = videoBlobs.get(src)!;
          } else {
            src = getSafeUrl(src);
          }

          if (!src) return null;

          const volume = typeof c.volume === "number" ? c.volume : 1;
          const finalVolume =
            volume * (typeof globalVolume === "number" ? globalVolume : 1);
          const isMuted = finalVolume === 0 || !!trackIsMuted || !!c.isMuted;
          const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(src);

          const extraDuration = c.type === "audio" ? 0 : OVERLAP_FRAMES;

          // Dynamic Volume: Handle Muting & Track Occlusion
          const volumeFn = (f: number) => {
            if (isMuted) return 0;
            const currentFrame = startFrame + f;
            const isOccluded = allClips.some((other) => {
              if (other.trackIdx >= item.trackIdx) return false;
              return (
                currentFrame >= other.startFrame &&
                currentFrame < other.endFrame
              );
            });
            return isOccluded ? 0 : finalVolume;
          };

          return (
            <Sequence
              key={item.id}
              from={startFrame}
              durationInFrames={durationInFrames + extraDuration}
            >
              {c.type === "audio" ? (
                <Audio
                  src={src}
                  startFrom={startFromFrames}
                  volume={volumeFn}
                  onError={(e) =>
                    console.error(`❌ Audio File Failed: ${src}`, e)
                  }
                />
              ) : isImage ? (
                <Img
                  src={src}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : (
                <Video
                  src={src}
                  crossOrigin="anonymous"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                  startFrom={startFromFrames}
                  volume={volumeFn}
                  // @ts-ignore
                  preload="auto"
                  playbackRate={1}
                  onError={(e) => console.error(`❌ Video Failed: ${src}`, e)}
                />
              )}
            </Sequence>
          );
        });
      })()}
    </AbsoluteFill>
  );
};