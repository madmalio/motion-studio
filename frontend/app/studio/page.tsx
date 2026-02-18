"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useConfirm } from "../../components/ConfirmProvider";
import { Loader2, PanelLeft, PanelTop, Download, X } from "lucide-react";
// --- DND KIT ---
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  pointerWithin,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useGaplessPlayback } from "../../hooks/useGaplessPlayback";

const round = (n: number) => Math.round(n * 10000) / 10000;

// --- COMPONENTS ---
import GeneratorPanel from "../../components/studio/GeneratorPanel";
import LibraryPanel from "../../components/studio/LibraryPanel";
import ViewerPanel from "../../components/studio/ViewerPanel";
import SimpleTimeline, {
  TimelineTrack,
  TimelineClip,
} from "@/components/studio/SimpleTimeline";
import { waitForWails } from "../../lib/wailsReady";

// --- WAILS IMPORTS ---
import {
  GetProject,
  GetScenes,
  ReadImageBase64,
  ExtractLastFrame,
  SaveShots,
  GetShots,
  DeleteShot,
  SaveTimeline,
  GetTimeline,
  ExtractAudioPeaks,
} from "../../lib/wailsSafe";

// --- TYPESCRIPT FIX FOR WAILS ---
declare global {
  interface Window {
    go: {
      main: {
        App: {
          GetVideoFPS: (path: string) => Promise<number>;
          // We add these two lines so TypeScript knows they exist:
          RenderTimelinePreview: (
            projectId: string,
            sceneId: string,
            timeline: any,
          ) => Promise<string>;
          ExportVideo: (
            projectId: string,
            sceneId: string,
            options: any,
          ) => Promise<string>;
        };
      };
    };
    runtime: {
      EventsOn: (event: string, callback: (data: any) => void) => () => void;
    };
  }
}

// --- TYPES ---
interface Shot {
  id: string;
  sceneId: string;
  name: string;
  sourceImage: string;
  audioPath: string;
  waveform?: number[];
  previewBase64?: string;
  prompt: string;
  motionStrength: number;
  seed: number;
  duration: number;
  status: string;
  outputVideo: string;
}

interface Project {
  id: string;
  name: string;
}

interface Scene {
  id: string;
  name: string;
}

interface TimelineItem extends Shot {
  timelineId: string;
  pairId?: string;
  trackIndex?: number;
  startTime: number;
  maxDuration?: number;
  trimStart?: number;
  volume?: number;
  muted?: boolean;
}

// --- HELPERS ---
const findContainer = (id: string, tracks: TimelineItem[][]) => {
  if (id.toString().startsWith("timeline-track-")) return id;
  for (let i = 0; i < tracks.length; i++) {
    const item = tracks[i].find((s) => s.timelineId === id);
    if (item) return `timeline-track-${i}`;
  }
  return undefined;
};

const isTimelineDropTarget = (overId: string, tracks: TimelineItem[][]) => {
  if (overId.startsWith("track-")) return true;
  return tracks.some((t) => t.some((item) => item.timelineId === overId));
};

const applyOverwrite = (trackItems: TimelineItem[], newItem: TimelineItem) => {
  const result: TimelineItem[] = [];
  const start = newItem.startTime;
  const end = newItem.startTime + (newItem.duration || 0);
  for (const item of trackItems) {
    if (item.timelineId === newItem.timelineId) continue;
    const itemStart = item.startTime;
    const itemEnd = round(item.startTime + (item.duration || 0));
    if (start < itemEnd && end > itemStart) {
      if (start <= itemStart && end >= itemEnd) {
        continue;
      } else if (start > itemStart && end < itemEnd) {
        result.push({ ...item, duration: round(start - itemStart) });
        result.push({
          ...item,
          timelineId: crypto.randomUUID(),
          startTime: end,
          duration: round(itemEnd - end),
          trimStart: round((item.trimStart || 0) + (end - itemStart)),
        });
      } else if (start > itemStart && start < itemEnd) {
        result.push({ ...item, duration: round(start - itemStart) });
      } else if (end > itemStart && end < itemEnd) {
        const cut = end - itemStart;
        result.push({
          ...item,
          startTime: end,
          duration: round((item.duration || 0) - cut),
          trimStart: round((item.trimStart || 0) + cut),
        });
      }
    } else {
      result.push(item);
    }
  }
  result.push(newItem);
  return result;
};

function WailsGuard({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (alive) setShowError(true);
    }, 2000);

    waitForWails()
      .then(() => {
        if (!alive) return;
        setIsReady(true);
        clearTimeout(timer);
      })
      .catch(() => {
        if (!alive) return;
        setShowError(true);
        clearTimeout(timer);
      });

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  if (isReady) return <>{children}</>;

  if (showError)
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[#09090b] text-red-500 gap-4">
        <Loader2 className="animate-spin text-red-500" size={32} />
        <div className="text-center">
          <h3 className="font-bold text-lg text-white">Backend Disconnected</h3>
          <p className="text-sm text-zinc-500 mt-2">
            Please make sure the application is running via Wails.
          </p>
        </div>
      </div>
    );

  return (
    <div className="h-full w-full flex items-center justify-center bg-[#09090b] text-[#D2FF44] gap-2">
      <Loader2 className="animate-spin" /> Initializing System...
    </div>
  );
}

// --- HELPERS FOR MODAL ---
const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const estimateFileSize = (duration: number, format: string) => {
  // Rough estimates: MP4 (15MB/min), ProRes (200MB/min), Audio (2MB/min)
  let mbPerMin = 15;
  if (format === "mov") mbPerMin = 200;
  if (format === "mp3" || format === "wav") mbPerMin = 2;

  const estimatedMB = (duration / 60) * mbPerMin;
  return estimatedMB < 1000
    ? `${estimatedMB.toFixed(1)} MB`
    : `${(estimatedMB / 1024).toFixed(2)} GB`;
};

function StudioContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") || "";
  const sceneId = searchParams.get("sceneId") || "";
  const { confirm } = useConfirm();

  // --- STATE ---
  const [project, setProject] = useState<Project | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [previewingShotId, setPreviewingShotId] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null); // <--- NEW STATE
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [exportOptions, setExportOptions] = useState({
    format: "mp4",
    includeVideo: true,
    includeAudio: true,
    quality: "medium",
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [projectFps, setProjectFps] = useState(30);

  // --- REAL TIMELINE STATE (CLEAN) ---
  const [tracks, setTracks] = useState<TimelineTrack[]>([
    {
      id: "t1",
      name: "Video 1",
      type: "video",
      clips: [], // <--- EMPTY!
      isMuted: false,
      isHidden: false,
      isLocked: false,
    },
    {
      id: "t2",
      name: "Audio 1",
      type: "audio",
      clips: [], // <--- EMPTY!
      isMuted: false,
      isHidden: false,
      isLocked: false,
    },
  ]);

  const [activeDragItem, setActiveDragItem] = useState<any>(null);
  const [zoom, setZoom] = useState(10); // px/second
  const [masterVolume, setMasterVolume] = useState(1);
  const handleVolumeChange = useCallback((val: number) => {
    setMasterVolume(val);
  }, []);

  // --- LAYOUT STATE ---
  const [generatorWidth, setGeneratorWidth] = useState(320);
  const [libraryWidth, setLibraryWidth] = useState(320);
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [isGeneratorFullHeight, setIsGeneratorFullHeight] = useState(true);
  const [isLayoutLoaded, setIsLayoutLoaded] = useState(false);

  const isResizingGen = useRef(false);
  const isResizingLib = useRef(false);
  const isResizingTime = useRef(false);
  const generatorWidthRef = useRef(generatorWidth);
  const libraryRef = useRef<HTMLDivElement>(null);

  // --- PERSIST LAYOUT ---
  useEffect(() => {
    const saved = localStorage.getItem("motion-studio-layout-full");
    if (saved !== null) {
      setIsGeneratorFullHeight(saved === "true");
    }
    setIsLayoutLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLayoutLoaded) return;
    localStorage.setItem(
      "motion-studio-layout-full",
      String(isGeneratorFullHeight),
    );
  }, [isGeneratorFullHeight, isLayoutLoaded]);

  useEffect(() => {
    generatorWidthRef.current = generatorWidth;
  }, [generatorWidth]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (isResizingGen.current) {
        const newW = Math.max(200, Math.min(600, e.clientX));
        setGeneratorWidth(newW);
        document.body.style.cursor = "col-resize";
      }
      if (isResizingLib.current) {
        const newW = Math.max(
          200,
          Math.min(800, e.clientX - generatorWidthRef.current),
        );
        setLibraryWidth(newW);
        document.body.style.cursor = "col-resize";
      }
      if (isResizingTime.current) {
        const newH = Math.max(
          150,
          Math.min(800, window.innerHeight - e.clientY),
        );
        setTimelineHeight(newH);
        document.body.style.cursor = "row-resize";
      }
    };

    const handlePointerUp = () => {
      isResizingGen.current = false;
      isResizingLib.current = false;
      isResizingTime.current = false;
      document.body.style.cursor = "default";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const [videoBlobs, setVideoBlobs] = useState<Map<string, string>>(new Map());
  const initialized = useRef(false);
  const videoCache = useRef<Map<string, string>>(new Map());
  const isCtrlPressed = useRef(false);

  // --- UNDO / REDO (Fixed) ---
  const [history, setHistory] = useState<any[]>([]);
  const [redoStack, setRedoStack] = useState<any[]>([]);

  const recordHistory = () => {
    setHistory((prev) => [
      ...prev,
      {
        tracks: JSON.parse(JSON.stringify(tracks)),
        shots: JSON.parse(JSON.stringify(shots)),
      },
    ]);
    setRedoStack([]);
  };

  const undo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    setRedoStack((prev) => [
      ...prev,
      {
        tracks: JSON.parse(JSON.stringify(tracks)),
        shots: JSON.parse(JSON.stringify(shots)),
      },
    ]);
    setHistory(newHistory);
    setTracks(previous.tracks);
    setShots(previous.shots);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const newRedo = redoStack.slice(0, -1);
    setHistory((prev) => [
      ...prev,
      {
        tracks: JSON.parse(JSON.stringify(tracks)),
        shots: JSON.parse(JSON.stringify(shots)),
      },
    ]);
    setRedoStack(newRedo);
    setTracks(next.tracks);
    setShots(next.shots);
  };

  const totalDuration = Math.max(
    0,
    ...tracks.map((t) =>
      // Fix 1: Access 't.clips' before reducing
      // Fix 2: Use 's.start' instead of 's.startTime'
      t.clips.reduce((acc, s) => Math.max(acc, s.start + (s.duration || 4)), 0),
    ),
  );

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      // If we are at the very end of the video and hit play, jump back to start
      if (!prev && currentTime >= totalDuration) {
        setCurrentTime(0);
      }
      return !prev;
    });
  }, [currentTime, totalDuration]);

  const seekTo = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  // --- AUTO-SAVE ---
  useEffect(() => {
    if (projectId && sceneId && initialized.current && shots.length > 0) {
      const cleanShots = shots.map(({ previewBase64, ...keep }) => keep);
      SaveShots(projectId, sceneId, cleanShots as any);
    }
  }, [shots, projectId, sceneId]);

  // --- AUTO-SAVE TIMELINE (FIXED COMPATIBILITY) ---
  useEffect(() => {
    if (projectId && sceneId && initialized.current) {
      // 1. Convert New Tracks (Objects) -> Old Tracks (Array of Arrays)
      // The backend expects [[clip, clip], [clip, clip]]
      const legacyTracks = tracks.map((t) =>
        t.clips.map((c) => ({
          ...c,
          // Map new fields back to old fields if necessary
          timelineId: c.id,
          startTime: c.start,
          trimStart: c.offset,
          // Ensure audio/video paths are set for the backend to recognize type
          outputVideo: t.type === "video" ? c.src : undefined,
          audioPath: t.type === "audio" ? c.src : undefined,
        })),
      );

      // 2. Extract Track Settings (So names/mute status persist)
      const legacySettings = tracks.map((t) => ({
        name: t.name,
        type: t.type,
        visible: !t.isHidden,
        locked: t.isLocked,
        // You can add height/volume here if the backend supports it
      }));

      SaveTimeline(projectId, sceneId, {
        tracks: legacyTracks, // <--- Sending Array of Arrays
        trackSettings: legacySettings, // <--- Sending Settings separately
      } as any);
    }
  }, [tracks, projectId, sceneId]);

  // --- SYNC NEW VIDEOS TO BLOBS ---
  useEffect(() => {
    shots.forEach((shot) => {
      if (shot.outputVideo && !videoBlobs.has(shot.outputVideo)) {
        if (videoCache.current.has(shot.id)) {
          const b64 = videoCache.current.get(shot.id);
          if (b64) {
            try {
              const byteCharacters = atob(b64);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: "video/mp4" });
              const url = URL.createObjectURL(blob);
              setVideoBlobs((prev) => new Map(prev).set(shot.outputVideo, url));
            } catch (e) { }
          }
        }
      }
    });
  }, [shots]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control") isCtrlPressed.current = true;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }

      if (e.code === "Space") {
        if (libraryRef.current?.contains(e.target as Node)) return;
        e.preventDefault();
        togglePlay();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") isCtrlPressed.current = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [history, redoStack, tracks, shots, togglePlay]);

  // --- HELPER: GENERATE WAVEFORM ---
  const generateWaveform = async (shotId: string, filePath: string) => {
    if (!filePath) return;
    const peaks = await ExtractAudioPeaks(filePath, 20);
    if (peaks && peaks.length > 0) {
      // 1. Update the Shot Library
      setShots((prev) =>
        prev.map((s) => (s.id === shotId ? { ...s, waveform: peaks } : s)),
      );

      // 2. Update the Timeline Tracks (Fixed for new structure)
      setTracks((prev) =>
        prev.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            clip.id === shotId ? { ...clip, waveform: peaks } : clip,
          ),
        })),
      );
    }
  };

  const refreshVideoBlob = async (path: string) => {
    try {
      const url = `http://localhost:3456/video/${path.replace(/\\/g, "/")}?t=${Date.now()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setVideoBlobs((prev) => {
        const next = new Map(prev);
        if (next.has(path)) URL.revokeObjectURL(next.get(path)!);
        next.set(path, objectUrl);
        return next;
      });
    } catch (e) {
      console.error("Failed to refresh blob:", path, e);
    }
  };

  // --- PREVIEW PLAYER ---
  const previewLoopRef = useRef<number | null>(null);

  const handlePlayShot = useCallback(async (shot: Shot) => {
    // 1. If we are currently playing the main timeline, stop it
    if (isPlaying) setIsPlaying(false);

    // 2. TOGGLE OFF: If already previewing this shot, just stop and reset
    if (previewingShotId === shot.id) {
      setPreviewingShotId(null);
      setCurrentTime(0);
      return;
    }

    // 3. START PREVIEW:
    // We find where this shot would be on a "temp" timeline,
    // but for a simple preview, we'll just seek to its start
    // if it's on the timeline, or simply set our state to its data.
    setPreviewingShotId(shot.id);

    // For now, we'll just toggle the global play state.
    // In a future step, we can make this "solo" the specific shot.
    setIsPlaying(true);
  }, [isPlaying, previewingShotId]);

  // --- LOAD DATA ---
  useEffect(() => {
    if (projectId && sceneId) loadData(projectId, sceneId);
  }, [projectId, sceneId]);

  const loadData = async (pId: string, sId: string) => {
    setIsLoading(true);
    try {
      const p = await GetProject(pId);
      setProject(p);
      const sData = await GetScenes(pId);
      const s = sData.find((x: any) => x.id === sId);
      setScene(s || null);

      // 1. Load Library Shots
      const savedShots = await GetShots(pId, sId);
      if (savedShots && savedShots.length > 0) {
        const hydratedShots = await Promise.all(
          savedShots.map(async (shot: any) => {
            if (shot.sourceImage) {
              const b64 = await ReadImageBase64(shot.sourceImage);
              shot.previewBase64 = b64;
            }
            return shot;
          }),
        );
        setShots(hydratedShots);
        setActiveShotId(hydratedShots[0].id);
      }

      // 2. Load Timeline & Convert to New Format
      try {
        const timelineData = await GetTimeline(pId, sId);

        if (timelineData && timelineData.tracks) {
          const settings = timelineData.trackSettings || [];

          // CONVERSION LOGIC: Transform [][]any to TimelineTrack[]
          const newTracks: TimelineTrack[] = await Promise.all(
            timelineData.tracks.map(async (rawClips: any[], index: number) => {
              // A. Hydrate Clips
              const clips = await Promise.all(
                rawClips.map(async (item: any) => {
                  if (item.sourceImage) {
                    await ReadImageBase64(item.sourceImage); // Preload (optional)
                  }

                  // Map Legacy Item -> New TimelineClip
                  return {
                    id: item.timelineId || crypto.randomUUID(),
                    type: (item.audioPath ? "audio" : "video") as
                      | "video"
                      | "audio",
                    name: item.name || "Untitled",
                    // LOAD THE ACTUAL FILE PATH
                    src:
                      item.outputVideo ||
                      item.audioPath ||
                      item.sourceImage ||
                      "",
                    start: item.startTime,
                    duration: item.duration,
                    offset: item.trimStart || 0,
                    sourceDuration: item.duration, // <--- Set sourceDuration (assuming item.duration was total length originally, or strictly from shot)
                    // Actually, item.duration from backend MIGHT be the trimmed duration.
                    // But we don't have the original total duration stored in the backend "TimelineItem" struct apparently unless we check the Shot library.
                    // However, we can use the Shot Library to look it up if needed.
                    // For now, let's assume valid clips come from Shots, and we should look up the shot if possible?
                    // Better: The backend item might not have it.
                    // Let's set it to item.duration + (item.trimStart || 0) + (maybe trimEnd? no).
                    // Providing a safe fallback:
                    color: item.audioPath ? "bg-purple-600" : "bg-blue-600",
                  };
                }),
              );

              // B. Get Track Info from Settings
              const setting = settings[index] || {};
              // Fallback names if settings are missing
              const defaultName = index === 0 ? "Video 1" : `Audio ${index}`;
              const trackName = setting.name || defaultName;
              const trackType =
                setting.type ||
                (trackName.toUpperCase().startsWith("A") ? "audio" : "video");

              return {
                id: `track-${index}-${crypto.randomUUID()}`,
                name: trackName,
                type: trackType as "video" | "audio",
                isMuted: false,
                isHidden: !setting.visible,
                isLocked: setting.locked,
                clips: clips,
              };
            }),
          );

          setTracks(newTracks);

          // C. Preload Video Blobs (so playback works immediately)
          const uniquePaths = new Set<string>();
          timelineData.tracks.flat().forEach((item: any) => {
            if (item.outputVideo) uniquePaths.add(item.outputVideo);
          });

          await Promise.all(
            Array.from(uniquePaths).map(async (path) => {
              try {
                const url = `http://localhost:3456/video/${path.replace(/\\/g, "/")}`;
                const res = await fetch(url);
                if (res.ok) {
                  const blob = await res.blob();
                  setVideoBlobs((prev) =>
                    new Map(prev).set(path, URL.createObjectURL(blob)),
                  );
                }
              } catch (e) {
                console.error("Failed to preload:", path);
              }
            }),
          );
        } else {
          // Default Empty State
          setTracks([
            { id: "t1", name: "Video 1", type: "video", clips: [] },
            { id: "t2", name: "Audio 1", type: "audio", clips: [] },
          ]);
        }
      } catch (e) {
        console.error("Timeline Load Error:", e);
        // Fallback
        setTracks([
          { id: "t1", name: "Video 1", type: "video", clips: [] },
          { id: "t2", name: "Audio 1", type: "audio", clips: [] },
        ]);
      }

      initialized.current = true;
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // --- SHOT LOGIC ---
  const activeShotIndex = shots.findIndex((s) => s.id === activeShotId);
  const activeShot = shots[activeShotIndex];

  const handleAddShot = useCallback(() => {
    if (!sceneId) return;
    recordHistory();
    const newId = crypto.randomUUID();
    setShots((prev) => {
      const newShot: Shot = {
        id: newId,
        sceneId: sceneId,
        name: `Shot ${prev.length + 1}`,
        sourceImage: "",
        audioPath: "",
        waveform: [],
        prompt: "",
        motionStrength: 127,
        seed: Math.floor(Math.random() * 1000000),
        duration: 4,
        status: "DRAFT",
        outputVideo: "",
      };
      return [...prev, newShot];
    });
    setActiveShotId(newId);
  }, [sceneId]);

  const createExtensionShot = useCallback(async (originalShot: Shot) => {
    const sourcePath = originalShot.outputVideo || originalShot.sourceImage;
    if (!sourcePath) {
      alert("Select source first");
      return null;
    }
    const lastFramePath = await ExtractLastFrame(sourcePath);
    if (!lastFramePath) return null;
    const b64 = await ReadImageBase64(lastFramePath);
    const newId = crypto.randomUUID();
    const newShot: Shot = {
      ...originalShot,
      id: newId,
      name: `${originalShot.name} (Ext)`,
      sourceImage: lastFramePath,
      audioPath: "",
      waveform: [],
      previewBase64: b64,
      status: "DRAFT",
      outputVideo: "",
      duration: 4,
    };
    return newShot;
  }, []);

  const handleExtendShot = useCallback(async (originalShot: Shot) => {
    const newShot = await createExtensionShot(originalShot);
    if (!newShot) return;

    recordHistory();
    setShots((prev) => {
      const idx = prev.findIndex((s) => s.id === originalShot.id);
      if (idx === -1) return [...prev, newShot];
      const next = [...prev];
      next.splice(idx + 1, 0, newShot);
      return next;
    });
    setActiveShotId(newShot.id);
  }, [shots, createExtensionShot]);

  const handleTimelineExtend = async (timelineId: string) => {
    console.log("Extend feature pending migration to new timeline engine.");
  };

  const handleDeleteShot = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    confirm({
      title: "Delete Shot?",
      message: "This will permanently remove the shot.",
      variant: "danger",
      onConfirm: async () => {
        recordHistory();
        if (project && scene) await DeleteShot(project.id, scene.id, id);
        setShots((prev) => prev.filter((s) => s.id !== id));
      },
    });
  }, [confirm, project, scene]);

  const updateActiveShot = useCallback((updates: Partial<Shot>) => {
    if (!activeShotId) return;

    // 1. Update the Source Library
    const shot = shots.find((s) => s.id === activeShotId); // Access shots from state, but inside callback it might be stale if not in deps.
    // Actually, better to use functional update for setShots if we want to avoid dep on shots, 
    // BUT we need 'shot' to check outputVideo changes. 
    // So we must depend on 'shots' or use a ref. 
    // Since shots don't change during playback, depending on shots is fine.

    if (shot) {
      const isNewRender = updates.status === "DONE";
      const path = updates.outputVideo || shot.outputVideo;
      if (
        (isNewRender ||
          (updates.outputVideo && updates.outputVideo !== shot.outputVideo)) &&
        path
      ) {
        refreshVideoBlob(path);
        generateWaveform(shot.id, path);
      }
      if (updates.audioPath && updates.audioPath !== shot.audioPath) {
        generateWaveform(shot.id, updates.audioPath);
      }
    }

    setShots((prev) =>
      prev.map((s) => (s.id === activeShotId ? { ...s, ...updates } : s)),
    );

    // 2. Update the Timeline (Fixed for New Structure)
    setTracks((prev) =>
      prev.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id === activeShotId) {
            // Merge updates into the clip
            // Note: We cast to 'any' briefly because Shot types and Clip types
            // might have slight differences during this migration.
            const newItem = { ...clip, ...updates } as any;

            if (updates.duration) {
              newItem.duration = updates.duration;
            }
            return newItem;
          }
          return clip;
        }),
      })),
    );
  }, [activeShotId, shots]);

  const handleUpdateItem = (
    id: string,
    updates: Partial<TimelineClip>, // Changed from TimelineItem to TimelineClip
    skipHistory = false,
  ) => {
    if (!skipHistory) recordHistory();
    setTracks((prev) =>
      prev.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === id ? { ...clip, ...updates } : clip,
        ),
      })),
    );
  };

  const handleSplit = (itemId: string, splitTime: number) => {
    console.log("Split feature pending migration.");
  };

  // --- TRACK MANAGEMENT (FIXED) ---

  const handleAddAudioTrack = () => {
    recordHistory();
    setTracks((prev) => {
      // 1. Calculate next Audio Track Number (A1, A2...)
      const audioTracks = prev.filter((t) => t.type === "audio");
      let nextNum = 1;
      if (audioTracks.length > 0) {
        const last = audioTracks[audioTracks.length - 1];
        const match = last.name.match(/(\d+)/);
        if (match) nextNum = parseInt(match[1]) + 1;
        else nextNum = audioTracks.length + 1;
      }

      // 2. Create Valid Track Object
      const newTrack: TimelineTrack = {
        id: crypto.randomUUID(),
        name: `A${nextNum}`,
        type: "audio",
        clips: [],
        isMuted: false,
        isHidden: false,
        isLocked: false,
      };

      return [...prev, newTrack];
    });
  };

  const handleAddTrack = () => {
    recordHistory();
    setTracks((prev) => {
      // 1. Calculate next Video Track Number (V1, V2...)
      const videoTracks = prev.filter((t) => t.type === "video");
      const nextNum = videoTracks.length + 1;

      // 2. Create Valid Track Object
      const newTrack: TimelineTrack = {
        id: crypto.randomUUID(),
        name: `V${nextNum}`,
        type: "video",
        clips: [],
        isMuted: false,
        isHidden: false,
        isLocked: false,
      };

      // Insert at the TOP of the list (Standard for Video tracks in this UI)
      return [newTrack, ...prev];
    });
  };

  const handleDeleteTrack = (index: number) => {
    recordHistory();
    setTracks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRenameTrack = (index: number, newName: string) => {
    setTracks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, name: newName } : t)),
    );
  };

  // Note: Height resizing is removed for now to simplify the interface
  const handleResizeTrack = (index: number, newHeight: number) => {
    // Optional: Add 'height' to TimelineTrack interface if needed later
  };

  const handleToggleTrackLock = (index: number) => {
    setTracks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, isLocked: !t.isLocked } : t)),
    );
  };

  const handleToggleTrackVisibility = (index: number) => {
    setTracks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, isHidden: !t.isHidden } : t)),
    );
  };

  // --- DND LOGIC ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: ["Enter"],
        cancel: ["Escape"],
        end: ["Enter"],
      },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    // 1. Check if dragging from Library (Shot data)
    if (event.active.data.current?.shot) {
      setActiveDragItem(event.active.data.current.shot);
      return;
    }

    // 2. Check if dragging a Shot ID directly
    const shot = shots.find((s) => s.id === event.active.id);
    if (shot) {
      setActiveDragItem(shot);
      return;
    }

    // 3. Check if dragging an existing Timeline Clip
    // FIX: Look inside 'track.clips' instead of 'track'
    for (const track of tracks) {
      const item = track.clips.find((i) => i.id === event.active.id);
      if (item) {
        setActiveDragItem(item);
        return;
      }
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    if (active.data.current?.type === "shot") return;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragItem(null);

    // 1. Must drop over a track
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("track-")) return;

    // 2. Identify the Track
    const trackIndex = parseInt(overId.split("-")[1]);

    // 3. Identify the Shot (Handle "library-" prefix)
    let shotData = active.data.current?.shot;
    if (!shotData) {
      const activeId = String(active.id).replace("library-", "");
      shotData = shots.find((s) => s.id === activeId);
    }

    // 4. Create the Clip
    if (shotData) {
      recordHistory();

      // Calculate Drop Time: (Drop X - Track Start X) / Zoom
      const dropX =
        (active.rect.current.translated?.left || 0) - over.rect.left;
      const startTime = Math.max(0, dropX / zoom);

      const newClip: TimelineClip = {
        id: crypto.randomUUID(),
        type: shotData.audioPath ? "audio" : "video",
        name: shotData.name,
        src:
          shotData.outputVideo ||
          shotData.audioPath ||
          shotData.sourceImage ||
          "",
        start: startTime,
        duration: shotData.duration || 4,
        sourceDuration: shotData.duration || 4, // <--- Set sourceDuration
        offset: 0,
        color: shotData.audioPath ? "bg-purple-600" : "bg-blue-600",
      };

      // 5. Add to Track
      setTracks((prev) => {
        const next = [...prev];
        if (next[trackIndex]) {
          next[trackIndex] = {
            ...next[trackIndex],
            clips: [...next[trackIndex].clips, newClip],
          };
        }
        return next;
      });
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportProgress(0);
    setExportStatus("Initializing...");

    // Listen for progress
    const cleanupStatus = (window as any).runtime.EventsOn(
      "export:status",
      (msg: string) => {
        setExportStatus(msg);
      },
    );
    const cleanupProgress = (window as any).runtime.EventsOn(
      "export:progress",
      (pct: number) => {
        setExportProgress(pct);
      },
    );

    try {
      // Call backend directly
      const result = await (window as any).go.main.App.ExportVideo(
        project?.id,
        scene?.id,
        exportOptions,
      );
      if (result !== "Success" && result !== "Cancelled") {
        alert("Export failed: " + result);
      }
    } finally {
      cleanupStatus();
      cleanupProgress();
      setIsExporting(false);
      setShowExportModal(false);
    }
  };

  if (isLoading || !project || !scene)
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#09090b] text-[#D2FF44] gap-2">
        <Loader2 className="animate-spin" /> Loading Studio...
      </div>
    );

  const generatorContent = (
    <div className="flex flex-col h-full relative">
      <div className="h-8 border-b border-zinc-800 flex items-center justify-between px-2 bg-[#09090b] shrink-0">
        <span className="text-xs font-bold text-zinc-400">Generator</span>
        <button
          onClick={() => setIsGeneratorFullHeight(!isGeneratorFullHeight)}
          className="text-zinc-400 hover:text-white"
          title={
            isGeneratorFullHeight
              ? "Switch to Classic View"
              : "Switch to Full Height"
          }
        >
          {isGeneratorFullHeight ? (
            <PanelTop size={14} />
          ) : (
            <PanelLeft size={14} />
          )}
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <GeneratorPanel
          activeShot={activeShot}
          updateActiveShot={updateActiveShot}
          project={project}
          scene={scene}
          isRendering={isRendering}
          setIsRendering={setIsRendering}
          setVideoCache={(id: string, b64: string) =>
            videoCache.current.set(id, b64)
          }
          setVideoSrc={() => { }}
        />
      </div>
    </div>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex-1 w-full flex flex-col overflow-hidden bg-[#09090b]">
        <header className="h-10 w-full border-b border-zinc-800 bg-[#09090b] flex items-center justify-between px-4 shrink-0">
          <h1 className="text-sm font-bold text-white flex items-center gap-2">
            {scene.name} <span className="text-zinc-600">/</span>{" "}
            <span className="text-zinc-500 font-normal">{project.name}</span>
          </h1>
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#D2FF44] text-black text-xs font-bold rounded hover:bg-[#b8e635] transition-colors"
          >
            <Download size={14} />
            Export
          </button>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {isGeneratorFullHeight && (
            <>
              <div
                style={{ width: generatorWidth }}
                className="border-r border-zinc-800 bg-[#09090b] flex flex-col min-h-0 shrink-0"
              >
                {generatorContent}
              </div>
              <div
                className="w-1 hover:w-1.5 bg-zinc-900 hover:bg-[#D2FF44] cursor-col-resize transition-all z-50 flex-shrink-0"
                onPointerDown={(e) => {
                  isResizingGen.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerUp={(e) =>
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
              />
            </>
          )}

          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex-1 flex overflow-hidden min-h-0">
              {!isGeneratorFullHeight && (
                <>
                  <div
                    style={{ width: generatorWidth }}
                    className="border-r border-zinc-800 bg-[#09090b] flex flex-col min-h-0 shrink-0"
                  >
                    {generatorContent}
                  </div>
                  <div
                    className="w-1 hover:w-1.5 bg-zinc-900 hover:bg-[#D2FF44] cursor-col-resize transition-all z-50 flex-shrink-0"
                    onPointerDown={(e) => {
                      isResizingGen.current = true;
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerUp={(e) =>
                      e.currentTarget.releasePointerCapture(e.pointerId)
                    }
                  />
                </>
              )}
              <div
                ref={libraryRef}
                style={{ width: libraryWidth }}
                className="border-r border-zinc-800 bg-[#09090b] flex flex-col min-h-0 shrink-0"
              >
                <LibraryPanel
                  shots={shots}
                  activeShotId={activeShotId}
                  setActiveShotId={setActiveShotId}
                  handleAddShot={handleAddShot}
                  handleExtendShot={handleExtendShot}
                  handleDeleteShot={handleDeleteShot}
                  handlePlayShot={handlePlayShot}
                  projectId={project.id}
                  previewingShotId={previewingShotId}
                />
              </div>
              <div
                className="w-1 hover:w-1.5 bg-zinc-900 hover:bg-[#D2FF44] cursor-col-resize transition-all z-50 flex-shrink-0"
                onPointerDown={(e) => {
                  isResizingLib.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerUp={(e) =>
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
              />
              <div className="flex-1 min-w-0 bg-black min-h-0">
                <ViewerPanel
                  tracks={tracks}
                  totalDuration={totalDuration}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                  setCurrentTime={setCurrentTime}
                  projectFps={projectFps}
                  volume={masterVolume}
                  videoBlobs={videoBlobs}
                />
              </div>
            </div>
            <div
              className="h-1 hover:h-1.5 bg-zinc-900 hover:bg-[#D2FF44] cursor-row-resize transition-all z-50 shrink-0"
              onPointerDown={(e) => {
                isResizingTime.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerUp={(e) =>
                e.currentTarget.releasePointerCapture(e.pointerId)
              }
            />
            <div
              style={{ height: timelineHeight }}
              className="border-t border-zinc-800 bg-[#1e1e20] shrink-0"
            >
              {/* --- NEW TIMELINE --- */}
              <div style={{ height: timelineHeight }} className="shrink-0">
                <SimpleTimeline
                  tracks={tracks}
                  setTracks={setTracks}
                  currentTime={currentTime}
                  setCurrentTime={setCurrentTime}
                  zoom={zoom}
                  setZoom={setZoom}
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                  onUndo={undo}
                  onRedo={redo}
                  volume={masterVolume}
                  onVolumeChange={handleVolumeChange}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <DragOverlay
        dropAnimation={
          activeDragItem && "timelineId" in activeDragItem
            ? {
              sideEffects: defaultDropAnimationSideEffects({
                styles: { active: { opacity: "0.5" } },
              }),
            }
            : null
        }
      >
        {activeDragItem ? (
          "timelineId" in activeDragItem ? (
            <div
              style={{
                width: (activeDragItem.duration || 4) * zoom,
                height: "96px",
              }}
              className="relative flex flex-col overflow-hidden bg-[#375a6c] border border-[#213845] rounded-sm shadow-xl cursor-grabbing opacity-90"
            >
              <div className="flex-1 relative overflow-hidden flex">
                {activeDragItem.previewBase64 && (
                  <img
                    src={activeDragItem.previewBase64}
                    className="h-full w-full object-cover opacity-80"
                  />
                )}
              </div>
              {activeDragItem.waveform && (
                <div className="absolute bottom-4 left-0 right-0 h-6 flex items-end gap-[1px] px-1 opacity-80 pointer-events-none">
                  {activeDragItem.waveform.map((h: number, i: number) => (
                    <div
                      key={i}
                      style={{ height: `${h * 100}%` }}
                      className="flex-1 bg-white/60 rounded-t-[1px]"
                    />
                  ))}
                </div>
              )}
              <div className="absolute bottom-0 w-full bg-[#20343e] px-2 py-0.5 text-[9px] text-zinc-300 truncate font-mono">
                {activeDragItem.name} ({activeDragItem.duration?.toFixed(2)}s)
              </div>
            </div>
          ) : (
            <div className="w-48 aspect-video rounded-lg overflow-hidden border-2 border-[#D2FF44] shadow-xl cursor-grabbing bg-zinc-900 opacity-90">
              {activeDragItem.previewBase64 && (
                <img
                  src={activeDragItem.previewBase64}
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute bottom-0 w-full bg-black/60 p-1 text-[10px] text-white truncate">
                {activeDragItem.name}
              </div>
            </div>
          )
        ) : null}
      </DragOverlay>

      {/* PROFESSIONAL EXPORT MODAL */}
      {showExportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="bg-[#121214] border border-zinc-800 rounded-xl shadow-2xl w-[800px] overflow-hidden flex flex-col">
            {/* HEADER */}
            <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-[#18181b]">
              <div className="flex items-center gap-2">
                <Download size={18} className="text-[#D2FF44]" />
                <h2 className="font-bold text-zinc-100 tracking-wide">
                  Export Project
                </h2>
              </div>
              <button
                onClick={() => !isExporting && setShowExportModal(false)}
                className="text-zinc-500 hover:text-white transition-colors"
                disabled={isExporting}
              >
                <X size={20} />
              </button>
            </div>

            {isExporting ? (
              /* RENDERING STATE */
              <div className="p-12 flex flex-col items-center justify-center gap-8 min-h-[400px]">
                <div className="relative">
                  <div className="absolute inset-0 bg-[#D2FF44] blur-xl opacity-20 rounded-full animate-pulse" />
                  <Loader2
                    className="animate-spin text-[#D2FF44] relative z-10"
                    size={64}
                  />
                </div>

                <div className="text-center space-y-2 w-full max-w-md">
                  <h3 className="text-2xl font-bold text-white">
                    Rendering Video...
                  </h3>
                  <div className="flex justify-between text-xs font-mono text-zinc-400 uppercase tracking-widest">
                    <span>Processing</span>
                    <span>{exportProgress}%</span>
                  </div>

                  {/* Custom Progress Bar */}
                  <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#D2FF44] to-[#a3d616] transition-all duration-300 ease-out shadow-[0_0_10px_#D2FF44]"
                      style={{ width: `${exportProgress}%` }}
                    />
                  </div>

                  <p className="text-xs text-zinc-500 font-mono mt-4 border border-zinc-800/50 bg-black/20 p-2 rounded text-center">
                    {exportStatus || "Initializing engine..."}
                  </p>
                </div>
              </div>
            ) : (
              /* SETTINGS STATE */
              <div className="flex h-[450px]">
                {/* LEFT COLUMN: CONTROLS */}
                <div className="w-[60%] p-8 flex flex-col gap-8">
                  {/* Preset Buttons */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                      Quick Presets
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "web", label: "Web (MP4)", fmt: "mp4" },
                        { id: "master", label: "Master (MOV)", fmt: "mov" },
                        { id: "audio", label: "Audio Only", fmt: "mp3" },
                      ].map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() =>
                            setExportOptions((prev) => ({
                              ...prev,
                              format: preset.fmt,
                              includeVideo: preset.fmt !== "mp3",
                              includeAudio: true,
                            }))
                          }
                          className={`py-2 px-3 rounded border text-xs font-bold transition-all ${exportOptions.format === preset.fmt
                            ? "bg-[#D2FF44]/10 border-[#D2FF44] text-[#D2FF44]"
                            : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                            }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Manual Controls */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                        Format
                      </label>
                      <select
                        value={exportOptions.format}
                        onChange={(e) =>
                          setExportOptions({
                            ...exportOptions,
                            format: e.target.value,
                          })
                        }
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-md p-2.5 text-sm text-white focus:border-[#D2FF44] focus:ring-1 focus:ring-[#D2FF44] outline-none"
                      >
                        <option value="mp4">MP4 (H.264)</option>
                        <option value="mov">MOV (ProRes 422)</option>
                        <option value="mkv">MKV (Matroska)</option>
                        <option value="mp3">MP3 (Audio)</option>
                        <option value="wav">WAV (Lossless)</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                        Quality
                      </label>
                      <select
                        value={exportOptions.quality}
                        onChange={(e) =>
                          setExportOptions({
                            ...exportOptions,
                            quality: e.target.value,
                          })
                        }
                        disabled={
                          exportOptions.format === "mp3" ||
                          exportOptions.format === "wav"
                        }
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-md p-2.5 text-sm text-white focus:border-[#D2FF44] focus:ring-1 focus:ring-[#D2FF44] outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="high">High (Best Quality)</option>
                        <option value="medium">Medium (Balanced)</option>
                        <option value="low">Low (Draft / Small)</option>
                      </select>
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                      Streams
                    </label>
                    <div className="flex flex-col gap-3 bg-zinc-900/50 p-4 rounded-lg border border-zinc-800">
                      <label className="flex items-center justify-between cursor-pointer group">
                        <span className="text-sm text-zinc-300 font-medium group-hover:text-white transition-colors">
                          Export Video
                        </span>
                        <input
                          type="checkbox"
                          checked={exportOptions.includeVideo}
                          disabled={
                            exportOptions.format === "mp3" ||
                            exportOptions.format === "wav"
                          }
                          onChange={(e) =>
                            setExportOptions({
                              ...exportOptions,
                              includeVideo: e.target.checked,
                            })
                          }
                          className="accent-[#D2FF44] h-4 w-4"
                        />
                      </label>
                      <div className="h-px bg-zinc-800" />
                      <label className="flex items-center justify-between cursor-pointer group">
                        <span className="text-sm text-zinc-300 font-medium group-hover:text-white transition-colors">
                          Export Audio
                        </span>
                        <input
                          type="checkbox"
                          checked={exportOptions.includeAudio}
                          onChange={(e) =>
                            setExportOptions({
                              ...exportOptions,
                              includeAudio: e.target.checked,
                            })
                          }
                          className="accent-[#D2FF44] h-4 w-4"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN: SUMMARY */}
                <div className="w-[40%] bg-[#0d0d10] border-l border-zinc-800 p-8 flex flex-col justify-between">
                  <div className="space-y-6">
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest border-b border-zinc-800 pb-2">
                      Summary
                    </h3>

                    {/* Stat Grid */}
                    <div className="grid grid-cols-1 gap-4">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-500">Duration</span>
                        <span className="text-sm font-mono text-zinc-200">
                          {formatTime(totalDuration)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-500">
                          Resolution
                        </span>
                        <span className="text-sm font-mono text-zinc-200">
                          1920 x 1080
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-500">
                          Frame Rate
                        </span>
                        <span className="text-sm font-mono text-zinc-200">
                          24 FPS
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-500">Codec</span>
                        <span className="text-sm font-mono text-zinc-200 uppercase">
                          {exportOptions.format === "mov"
                            ? "ProRes 422"
                            : "H.264 / AAC"}
                        </span>
                      </div>
                    </div>

                    <div className="bg-zinc-900/50 p-4 rounded border border-dashed border-zinc-800">
                      <div className="flex justify-between items-end">
                        <span className="text-xs text-zinc-500">
                          Est. File Size
                        </span>
                        <span className="text-lg font-bold text-[#D2FF44]">
                          ~
                          {estimateFileSize(
                            totalDuration,
                            exportOptions.format,
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* ACTION BUTTONS */}
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={handleExport}
                      disabled={isExporting}
                      className="w-full py-3 bg-[#D2FF44] hover:bg-[#b8e635] text-black font-bold rounded-lg transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      <Download size={18} />
                      Render Video
                    </button>
                    <button
                      onClick={() => setShowExportModal(false)}
                      className="w-full py-2 text-xs font-bold text-zinc-500 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </DndContext>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={<div className="p-10 text-[#D2FF44]">Loading...</div>}>
      <WailsGuard>
        <StudioContent />
      </WailsGuard>
    </Suspense>
  );
}
