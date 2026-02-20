import React from "react";
import { AbsoluteFill, Sequence, Img, useCurrentFrame, Video, Audio } from "remotion";
import { RemotionManifest } from "@/lib/remotionBridge";

// Helper to safely encode Windows paths for URLs
const getSafeUrl = (filePath: string) => {
  if (!filePath) return "";
  if (filePath.startsWith("http") || filePath.startsWith("blob"))
    return filePath;

  // Use the static video endpoint for better performance/caching during playback
  return `http://localhost:3456/video/${encodeURIComponent(filePath.replace(/\\/g, "/"))}`;
};

// --- DIRECT VIDEO COMPONENT ---
// Removed BufferedVideo as modern Remotion native Video component with correct startFrom/duration handles this properly.

export const TimelineComposition = (props: any) => {
  const {
    tracks,
    fps,
    volume: globalVolume,
    videoBlobs,
    isPlaying,
  } = props as RemotionManifest & {
    volume: number;
    videoBlobs?: Map<string, string>;
    isPlaying?: boolean;
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
              // Z-INDEX SORTING: (100 - trackIdx) * 1000 ensures Track 0 (top of UI) is rendered LATER than Track 1 (so it's ON TOP)
              score: (100 - trackIdx) * 1000 + clipIdx,
            };
          });
        });

        allClips.sort((a, b) => a.score - b.score);

        return allClips.map((item) => (
          <VideoClipRenderer
            key={item.id}
            item={item}
            fps={fps}
            globalVolume={globalVolume}
            videoBlobs={videoBlobs}
            isPlaying={isPlaying}
          />
        ));
      })()}
    </AbsoluteFill>
  );
};

// --- GAPLESS DOM CLIP RENDERER ---
const VideoClipRenderer = ({ item, fps, globalVolume, videoBlobs, isPlaying }: {
  item: any;
  fps: number;
  globalVolume: number;
  videoBlobs?: Map<string, string>;
  isPlaying?: boolean;
}) => {
  const { clip: c, startFrame, durationInFrames, trackIsMuted } = item;

  let src = c.src || c.file || "";
  if (c.type === "audio") {
    src = getSafeUrl(src);
  } else if (videoBlobs && videoBlobs instanceof Map && videoBlobs.has(src)) {
    src = videoBlobs.get(src)!;
  } else {
    src = getSafeUrl(src);
  }

  if (!src) return null;

  const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(src);

  // Remotion Official Warmup: 30 frames
  // The Component mounts 1 second earlier invisibly to natively prepare the WebCodecs buffer!
  const PREMOUNT_FRAMES = 30;

  const seqFrom = startFrame;
  const seqDuration = Math.max(durationInFrames, 1);
  const startFrom = Math.max(0, Math.round((c.trimStart || c.offset || 0) * fps));

  const volume = typeof c.volume === "number" ? c.volume : 1;
  const finalVolume = volume * (typeof globalVolume === "number" ? globalVolume : 1);
  const isMuted = finalVolume === 0 || !!trackIsMuted || !!c.isMuted;

  const volumeVal = isMuted ? 0 : finalVolume;

  return (
    <Sequence
      from={seqFrom}
      durationInFrames={seqDuration}
      premountFor={PREMOUNT_FRAMES} // NATIVE GAPLESS MAGIC!
    >
      <ClipContent
        c={c}
        src={src}
        startFrom={startFrom}
        volumeVal={volumeVal}
        isMuted={isMuted}
        isImage={isImage}
      />
    </Sequence>
  );
};

// Use a tertiary component to access useCurrentFrame cleanly inside the Sequence
const ClipContent = ({ c, src, startFrom, volumeVal, isMuted, isImage }: any) => {
  if (c.type === "audio") {
    return (
      <Audio
        src={src}
        startFrom={startFrom}
        volume={volumeVal}
        muted={isMuted}
        pauseWhenBuffering={false} // NEVER FREEZE TIMELINE!
        onError={(e) => console.error(`❌ Audio File Failed: ${src}`, e)}
      />
    );
  }

  if (isImage) {
    return (
      <Img
        src={src}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    );
  }

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <Video
        src={src}
        startFrom={startFrom}
        volume={volumeVal}
        muted={isMuted}
        style={{ width: "100%", height: "100%", objectFit: "contain", backgroundColor: "transparent" }}
        pauseWhenBuffering={false} // NEVER FREEZE TIMELINE!
        onError={(e: any) => console.error(`❌ Video Failed: ${src}`, e)}
      />
    </div>
  );
};