import { AbsoluteFill, Video, Audio, Sequence, Img } from "remotion";
import { RemotionManifest } from "@/lib/remotionBridge";
import { useState, Fragment } from "react";

// Helper to safely encode Windows paths for URLs
const getSafeUrl = (filePath: string) => {
  if (!filePath) return "";
  if (filePath.startsWith("http") || filePath.startsWith("blob"))
    return filePath;

  // Use the static video endpoint for better performance/caching during playback
  return `http://localhost:3456/video/${encodeURIComponent(filePath.replace(/\\/g, "/"))}`;
};

export const HelloWorld = (props: any) => {
  const {
    tracks,
    fps,
    volume: globalVolume,
    videoBlobs, // <--- Receive blobs
  } = props as RemotionManifest & {
    volume: number;
    videoBlobs?: Map<string, string>;
  };
  const [error, setError] = useState<string | null>(null);

  if (error) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "red",
          color: "white",
          fontSize: 24,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Error: {error}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {(() => {
        // 1. Flatten all clips into a single list with metadata
        const allClips = tracks.flatMap((t, trackIdx) => {
          const track = t as any; // Fix: Cast to any to access isHidden
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
              trackIdx, // Store original track index
              trackIsMuted: track.isMuted, // Param: trackIsMuted
              startFrame,
              endFrame: startFrame + durationInFrames,
              durationInFrames,
              // Invert Z-Index: Track 0 (Top in UI) should be rendered last (Highest Score)
              // to appear on top of other tracks.
              score: (tracks.length - trackIdx) * 1000,
            };
          });
        });

        // 2. Adjust scores for Gapless Transitions
        // We want Outgoing Clip (A) to cover Incoming Clip (B) if they abut.
        // A.end == B.start.
        // If BaseScore(B) > BaseScore(A), B covers A (Black Flash!).
        // So we boost A to be > B.
        const OVERLAP_FRAMES = 3;

        // Optimization: Sort by start time to find neighbors efficiently?
        // Or just blunt O(N^2) for typical timeline size (usually < 100 clips visible? Project can be large).
        // Let's stick to simple O(N^2) for now or filter.

        // Filter to only Videos (Audio doesn't flash black)
        // Actually, let's just loop all.

        allClips.forEach((outgoing) => {
          // Only boost "Video" types (checking file extension or type)
          // HelloWorld logic checks type via props or file extension.
          // Let's rely on overlap logic. If A overlaps B, A should cover B.

          allClips.forEach((incoming) => {
            if (outgoing === incoming) return;

            // Only apply gapless optimization to clips on the same track
            if (outgoing.trackIdx !== incoming.trackIdx) return;

            // Check if it's a "Cut" (Incoming starts where Outgoing ends)
            // Tolerance: +/- 1 frame.
            const diff = incoming.startFrame - outgoing.endFrame;
            if (Math.abs(diff) <= 1) {
              // It's a cut.
              // Ensure Outgoing covers Incoming.
              if (outgoing.score <= incoming.score) {
                // Boost Outgoing
                outgoing.score = incoming.score + 1;
              }
            }
          });
        });

        // 3. Sort by Score (Low -> High). Last rendered is Top.
        allClips.sort((a, b) => a.score - b.score);

        // 4. Render
        return allClips.map((item) => {
          const { clip: c, startFrame, durationInFrames, trackIsMuted } = item;

          // Common Props Logic
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

          // Add Overlap Extension
          const extraDuration = c.type === "audio" ? 0 : OVERLAP_FRAMES;

          // Dynamic Volume: Handle Muting & Track Occlusion (Top track silences bottom)
          const volumeFn = (f: number) => {
            if (isMuted) return 0;
            const currentFrame = startFrame + f;
            // Check if any clip on a higher priority track (lower index) overlaps
            const isOccluded = allClips.some((other) => {
              if (other.trackIdx >= item.trackIdx) return false; // Only tracks above
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
