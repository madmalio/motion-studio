// frontend/lib/remotionBridge.ts

export interface RemotionClip {
  type: "video" | "audio";
  file: string;
  startFrame: number;
  endFrame: number;
  layer: number;
  trimStart: number;
  volume: number;
}

export interface RemotionManifest {
  durationInFrames: number;
  width: number;
  height: number;
  fps: number;
  tracks: {
    id: string;
    clips: RemotionClip[];
  }[];
}

export function convertToRemotionManifest(
  tracks: any[][],
  fps: number = 30,
): RemotionManifest {
  const manifest: RemotionManifest = {
    durationInFrames: 0,
    width: 1920,
    height: 1080,
    fps: fps,
    tracks: [],
  };

  tracks.forEach((trackItems, trackIndex) => {
    const remotionTrack = {
      id: `track-${trackIndex}`,
      clips: [] as RemotionClip[],
    };

    trackItems.forEach((item) => {
      // 1. Calculate Timeline Position
      const startFrame = Math.round((item.startTime || 0) * fps);
      const durationFrames = Math.round((item.duration || 0) * fps);
      const endFrame = startFrame + durationFrames;

      if (endFrame > manifest.durationInFrames) {
        manifest.durationInFrames = endFrame;
      }

      const trimStart = item.trimStart || 0;
      const volume = item.muted ? 0 : (item.volume ?? 1);

      // 2. CHECK FOR VIDEO (Independent Check)
      // If outputVideo exists, add it as a video layer
      if (item.outputVideo || item.sourceImage) {
        remotionTrack.clips.push({
          type: "video",
          file: item.outputVideo || item.sourceImage,
          startFrame: startFrame,
          endFrame: endFrame,
          layer: trackIndex,
          trimStart: trimStart,
          volume: volume,
        });
      }

      // 3. CHECK FOR AUDIO (Independent Check)
      // If audioPath exists, add it as a separate audio layer
      // This allows silent AI videos to play alongside their source audio
      if (item.audioPath) {
        remotionTrack.clips.push({
          type: "audio",
          file: item.audioPath,
          startFrame: startFrame,
          endFrame: endFrame,
          layer: trackIndex,
          trimStart: trimStart,
          volume: volume,
        });
      }
    });

    manifest.tracks.push(remotionTrack);
  });

  return manifest;
}
