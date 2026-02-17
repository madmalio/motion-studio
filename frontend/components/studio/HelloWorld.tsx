import { AbsoluteFill, Video, Audio, Sequence } from "remotion";
import { RemotionManifest } from "@/lib/remotionBridge";
import { useState, Fragment } from "react";

// Helper to safely encode Windows paths for URLs
const getSafeUrl = (filePath: string) => {
  if (!filePath) return "";
  if (filePath.startsWith("http") || filePath.startsWith("blob"))
    return filePath;

  // Use the new robust query-param endpoint
  // This handles C:\, spaces, #, ?, etc. perfectly without manual splitting
  return `http://localhost:3456/api/media?file=${encodeURIComponent(filePath)}`;
};

export const HelloWorld = (props: any) => {
  const {
    tracks,
    fps,
    volume: globalVolume,
  } = props as RemotionManifest & { volume: number };
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
        <Fragment key={track.id}>
          {track.clips.map((clip, index) => {
            const durationInFrames = clip.endFrame - clip.startFrame;
            const startFromFrames = Math.round(clip.trimStart * fps);

            const src = getSafeUrl(clip.file);

            // Ensure volume is a valid number. Default to 1 (100%) if missing.
            const volume = typeof clip.volume === "number" ? clip.volume : 1;

            // Calculate final volume (Clip Volume * Global Master Volume)
            const finalVolume =
              volume * (typeof globalVolume === "number" ? globalVolume : 1);

            const isMuted = finalVolume === 0;

            return (
              <Sequence
                key={clip.id ?? index}
                from={clip.startFrame}
                durationInFrames={durationInFrames}
              >
                {/* 1. AUDIO CLIPS (Separate Files) */}
                {clip.type === "audio" ? (
                  <Audio
                    src={src}
                    startFrom={startFromFrames}
                    volume={finalVolume}
                    muted={isMuted}
                    onError={(e) =>
                      console.error(`❌ Audio File Failed: ${src}`, e)
                    }
                  />
                ) : (
                  /* 2. VIDEO CLIPS (With Embedded Audio) */
                  <>
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
                      muted // ✅ ALWAYS mute the video element to prevent double-audio
                      playbackRate={1}
                      onError={(e) =>
                        console.error(`❌ Video Failed: ${src}`, e)
                      }
                    />

                    {/* ✅ Explicit audio for video clips (single, controlled source) */}
                    {!isMuted && (
                      <Audio
                        src={src}
                        startFrom={startFromFrames}
                        volume={finalVolume}
                        onError={(e) =>
                          console.error(`❌ Video-Audio Failed: ${src}`, e)
                        }
                      />
                    )}
                  </>
                )}
              </Sequence>
            );
          })}
        </Fragment>
      ))}
    </AbsoluteFill>
  );
};
