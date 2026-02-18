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
  } = props as RemotionManifest & { volume: number; videoBlobs?: Map<string, string> };
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
      {[...tracks].reverse().map((track) => ( // <--- Reversed tracks for z-index
        <Fragment key={track.id}>
          {track.clips.map((clip, index) => {
            // Handle both "Render Manifest" (frames) and "Timeline State" (seconds)
            let durationInFrames = 0;
            let startFrame = 0;

            const c = clip as any;

            if (typeof c.start === "number" && typeof c.duration === "number") {
              startFrame = Math.round(c.start * fps);
              durationInFrames = Math.round(c.duration * fps);
            } else {
              durationInFrames = clip.endFrame - clip.startFrame;
              startFrame = clip.startFrame;
            }

            const startFromFrames = Math.round(
              (c.trimStart || c.offset || 0) * fps,
            );

            // RESOLVE SOURCE: Check Blobs first, then URL
            let src = c.src || c.file || "";
            if (videoBlobs && videoBlobs instanceof Map && videoBlobs.has(src)) {
              src = videoBlobs.get(src)!;
            } else {
              src = getSafeUrl(src);
            }

            if (!src) return null;

            // Ensure volume is a valid number. Default to 1 (100%) if missing.
            const volume = typeof c.volume === "number" ? c.volume : 1;

            // Calculate final volume (Clip Volume * Global Master Volume)
            const finalVolume =
              volume * (typeof globalVolume === "number" ? globalVolume : 1);

            const isMuted = finalVolume === 0;

            const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(src);

            return (
              <Sequence
                key={c.id ?? index}
                from={startFrame}
                durationInFrames={durationInFrames}
              >
                {/* 1. AUDIO CLIPS (Separate Files) */}
                {c.type === "audio" ? (
                  <Audio
                    src={src}
                    startFrom={startFromFrames}
                    volume={finalVolume}
                    muted={isMuted}
                    onError={(e) =>
                      console.error(`❌ Audio File Failed: ${src}`, e)
                    }
                  />
                ) : isImage ? (
                  /* 2. IMAGE CLIPS */
                  <Img
                    src={src}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                  />
                ) : (
                  /* 2. VIDEO CLIPS (With Embedded Audio) */
                  <Video
                    src={src}
                    crossOrigin="anonymous"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      backgroundColor: "black",
                    }}
                    startFrom={startFromFrames}
                    muted={isMuted}
                    volume={finalVolume}
                    // @ts-ignore
                    preload="auto"
                    playbackRate={1}
                    onError={(e) => console.error(`❌ Video Failed: ${src}`, e)}
                  />
                )}
              </Sequence>
            );
          })}
        </Fragment>
      ))}
    </AbsoluteFill>
  );
};
