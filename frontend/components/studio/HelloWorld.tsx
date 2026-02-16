import { AbsoluteFill, Video, Audio, Sequence } from "remotion";
import { RemotionManifest } from "@/lib/remotionBridge";
import { useState } from "react";

// Helper to safely encode Windows paths for URLs
const getSafeUrl = (filePath: string) => {
  if (!filePath) return "";
  if (filePath.startsWith("http") || filePath.startsWith("blob"))
    return filePath;

  const normalized = filePath.replace(/\\/g, "/");
  const encoded = encodeURI(normalized);

  return `http://localhost:3456/video/${encoded}`;
};

export const HelloWorld = (props: any) => {
  const { tracks, fps } = props as RemotionManifest;
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
      {tracks.map((track) => (
        <div key={track.id}>
          {track.clips.map((clip, index) => {
            const durationInFrames = clip.endFrame - clip.startFrame;
            const startFromFrames = Math.round(clip.trimStart * fps);

            const src = getSafeUrl(clip.file);

            // Ensure volume is a valid number. Default to 1 (100%) if missing.
            const volume = typeof clip.volume === "number" ? clip.volume : 1;

            return (
              <Sequence
                key={index}
                from={clip.startFrame}
                durationInFrames={durationInFrames}
              >
                {/* 1. AUDIO CLIPS (Separate Files) */}
                {clip.type === "audio" ? (
                  <Audio
                    src={src}
                    startFrom={startFromFrames}
                    volume={volume}
                    onError={(e) =>
                      console.error(`❌ Audio File Failed: ${src}`, e)
                    }
                  />
                ) : (
                  /* 2. VIDEO CLIPS (With Embedded Audio) */
                  <Video
                    src={src}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                    startFrom={startFromFrames}
                    // CRITICAL: Ensure these props are set to allow sound
                    volume={volume}
                    muted={false}
                    playbackRate={1}
                    // DEBUG: Log the video URL so we can test it
                    onError={(e) => console.error(`❌ Video Failed: ${src}`, e)}
                    onVolumeChange={(e) => {
                      // This fires when the video loads its audio track
                      console.log(`🔊 Video Audio Loaded: ${src}`);
                    }}
                  />
                )}
              </Sequence>
            );
          })}
        </div>
      ))}
    </AbsoluteFill>
  );
};
