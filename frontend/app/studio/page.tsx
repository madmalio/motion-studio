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
import { useStudio } from "../../components/StudioProvider";
import { Loader2, PanelLeft, PanelTop, Download, X } from "lucide-react";
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

const round = (n: number) => Math.round(n * 10000) / 10000;

// --- COMPONENTS ---
import GeneratorPanel from "../../components/studio/GeneratorPanel";
import LibraryPanel from "../../components/studio/LibraryPanel";
import ViewerPanel from "../../components/studio/ViewerPanel";
import AssetLibraryModal from "../../components/studio/AssetLibraryModal";
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
          SanitizeLocalFile: (path: string) => Promise<string>;
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
  audioStart?: number;
  audioDuration?: number;
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
  fps?: number;
}

interface Scene {
  id: string;
  name: string;
}

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
  const { isExportModalOpen, closeExportModal, isAssetLibraryOpen, closeAssetLibrary } = useStudio();

  // --- STATE ---
  const [project, setProject] = useState<Project | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [activeShotId, setActiveShotId] = useState<string | null>(null);

  // PREVIEW STATE
  const [previewingShotId, setPreviewingShotId] = useState<string | null>(null);

  const [isRendering, setIsRendering] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const [exportOptions, setExportOptions] = useState({
    format: "mp4",
    includeVideo: true,
    includeAudio: true,
    quality: "medium",
  });

  const [currentTime, setCurrentTime] = useState(0);     // Global Timeline
  const [previewTime, setPreviewTime] = useState(0);     // Isolated Library Preview
  const [isPlaying, setIsPlaying] = useState(false);
  const [projectFps, setProjectFps] = useState(30);

  // --- REAL TIMELINE STATE ---
  const [tracks, setTracks] = useState<TimelineTrack[]>([
    { id: "t1", name: "Video 1", type: "video", clips: [], isMuted: false, isHidden: false, isLocked: false },
    { id: "t2", name: "Audio 1", type: "audio", clips: [], isMuted: false, isHidden: false, isLocked: false },
  ]);

  const [activeDragItem, setActiveDragItem] = useState<any>(null);
  const [dragContext, setDragContext] = useState<{ cursorOffsetX: number, cursorOffsetY: number } | null>(null);
  const [zoom, setZoom] = useState(11);
  const [masterVolume, setMasterVolume] = useState(1);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

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

  useEffect(() => {
    const saved = localStorage.getItem("motion-studio-layout-full");
    if (saved !== null) setIsGeneratorFullHeight(saved === "true");
    setIsLayoutLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLayoutLoaded) return;
    localStorage.setItem("motion-studio-layout-full", String(isGeneratorFullHeight));
  }, [isGeneratorFullHeight, isLayoutLoaded]);

  useEffect(() => {
    generatorWidthRef.current = generatorWidth;
  }, [generatorWidth]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (isResizingGen.current) {
        setGeneratorWidth(Math.max(200, Math.min(600, e.clientX)));
        document.body.style.cursor = "col-resize";
      }
      if (isResizingLib.current) {
        setLibraryWidth(Math.max(200, Math.min(800, e.clientX - generatorWidthRef.current)));
        document.body.style.cursor = "col-resize";
      }
      if (isResizingTime.current) {
        setTimelineHeight(Math.max(150, Math.min(800, window.innerHeight - e.clientY)));
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

  // --- REFS FOR STABLE HANDLERS ---
  const tracksRef = useRef(tracks);
  const shotsRef = useRef(shots);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  // --- UNDO / REDO ---
  const [history, setHistory] = useState<any[]>([]);
  const [redoStack, setRedoStack] = useState<any[]>([]);

  // --- FAST DEEP CLONE HELPER ---
  // Avoids JSON.parse(JSON.stringify) which completely freezes the UI for seconds when processing multi-megabyte base64 thumbnails!
  const cloneProjectState = (currentTracks: TimelineTrack[], currentShots: Shot[]) => {
    return {
      tracks: currentTracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({ ...c }))
      })),
      shots: currentShots.map((s) => ({
        ...s,
        waveform: s.waveform ? [...s.waveform] : undefined
      }))
    };
  };

  const recordHistory = () => {
    setHistory((prev) => [...prev, cloneProjectState(tracks, shots)]);
    setRedoStack([]);
  };

  const undo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setRedoStack((prev) => [...prev, cloneProjectState(tracks, shots)]);
    setHistory(history.slice(0, -1));
    setTracks(previous.tracks);
    setShots(previous.shots);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory((prev) => [...prev, cloneProjectState(tracks, shots)]);
    setRedoStack(redoStack.slice(0, -1));
    setTracks(next.tracks);
    setShots(next.shots);
  };

  // --- PLAYBACK ROUTING ---
  const totalDuration = Math.max(0, ...tracks.map((t) => t.clips.reduce((acc, s) => Math.max(acc, s.start + (s.duration || 4)), 0)));

  // Derived Preview State (Tricks ViewerPanel into playing only the requested shot)
  const previewShotObj = useMemo(() => shots.find(s => s.id === previewingShotId), [shots, previewingShotId]);

  const displayTracks = useMemo(() => {
    if (previewShotObj) {
      return [
        {
          id: "preview-track",
          name: "Preview",
          type: "video" as const,
          clips: [
            {
              id: previewShotObj.id,
              type: previewShotObj.outputVideo ? "video" : (previewShotObj.audioPath ? "audio" : "video") as "video" | "audio",
              name: previewShotObj.name,
              src: previewShotObj.outputVideo || previewShotObj.audioPath || previewShotObj.sourceImage || "",
              start: 0,
              duration: previewShotObj.duration || 4,
              offset: 0,
              color: "bg-blue-600",
              thumbnail: previewShotObj.previewBase64,
            }
          ],
          isMuted: false,
          isHidden: false,
          isLocked: false
        }
      ];
    }
    return tracks;
  }, [tracks, previewShotObj]);

  const displayDuration = previewShotObj ? (previewShotObj.duration || 4) : totalDuration;

  // Decide which time state the player should use
  const activeTime = previewingShotId ? previewTime : currentTime;
  const setActiveTime = previewingShotId ? setPreviewTime : setCurrentTime;

  // Updated Toggles
  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev) {
        if (previewingShotId && previewTime >= displayDuration) setPreviewTime(0);
        else if (!previewingShotId && currentTime >= totalDuration) setCurrentTime(0);
      }
      return !prev;
    });
  }, [currentTime, totalDuration, previewingShotId, displayDuration, previewTime]);

  // Break out of Preview mode if the user clicks the global timeline
  const handleTimelineTimeChange: React.Dispatch<React.SetStateAction<number>> = useCallback((value) => {
    if (previewingShotId) {
      setPreviewingShotId(null);
      setIsPlaying(false);
    }
    setCurrentTime(value);
  }, [previewingShotId]);

  const handlePlayShot = useCallback(
    async (shot: Shot) => {
      // Toggle off
      if (previewingShotId === shot.id) {
        setPreviewingShotId(null);
        setIsPlaying(false);
        setPreviewTime(0);
        return;
      }
      // Toggle on
      setPreviewingShotId(shot.id);
      setPreviewTime(0); // Instantly seek to 0:00 for the preview
      setIsPlaying(true);
    },
    [previewingShotId],
  );

  // --- AUTO-CLEAR PREVIEW WHEN VIDEO ENDS ---
  // If the ViewerPanel reaches the end of the clip, it calls setIsPlaying(false).
  // We need to catch that and officially exit Preview Mode so the timeline works again!
  useEffect(() => {
    if (previewingShotId && !isPlaying) {
      setPreviewingShotId(null);
      setPreviewTime(0);
    }
  }, [isPlaying, previewingShotId]);

  const generateWaveform = useCallback(async (shotId: string, filePath: string) => {
    if (!filePath) return;
    const peaks = await ExtractAudioPeaks(filePath, 20);
    if (peaks && peaks.length > 0) {
      setShots((prev) => prev.map((s) => (s.id === shotId ? { ...s, waveform: peaks } : s)));
      setTracks((prev) =>
        prev.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === shotId ? { ...clip, waveform: peaks } : clip) })),
      );
    }
  }, []);

  const refreshVideoBlob = useCallback(async (path: string) => {
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
  }, []);

  const loadData = async (pId: string, sId: string) => {
    setIsLoading(true);
    try {
      const p = await GetProject(pId);
      setProject(p);
      const sData = await GetScenes(pId);
      const s = sData.find((x: any) => x.id === sId);
      setScene(s || null);

      const savedShots = await GetShots(pId, sId);
      let loadedShots: any[] = [];
      if (savedShots && savedShots.length > 0) {
        loadedShots = await Promise.all(
          savedShots.map(async (shot: any) => {
            if (shot.sourceImage) shot.previewBase64 = await ReadImageBase64(shot.sourceImage);
            return shot;
          }),
        );
        setShots(loadedShots);
        setActiveShotId(loadedShots[0].id);
      }

      try {
        const timelineData = await GetTimeline(pId, sId);
        if (timelineData && timelineData.tracks) {
          const settings = timelineData.trackSettings || [];
          const newTracks: TimelineTrack[] = await Promise.all(
            timelineData.tracks.map(async (rawClips: any[], index: number) => {
              const clips = await Promise.all(
                rawClips.map(async (item: any) => {
                  if (item.sourceImage) await ReadImageBase64(item.sourceImage);
                  return {
                    id: item.timelineId || crypto.randomUUID(),
                    type: item.outputVideo ? "video" : (item.audioPath ? "audio" : "video") as "video" | "audio",
                    name: item.name || "Untitled",
                    src: item.outputVideo || item.audioPath || item.sourceImage || "",
                    start: item.startTime,
                    duration: item.duration,
                    offset: item.trimStart || 0,
                    sourceDuration: item.duration,
                    color: item.audioPath ? "bg-purple-600" : "bg-blue-600",
                  };
                }),
              );

              const setting = settings[index] || {};
              const defaultName = index === 0 ? "Video 1" : `Audio ${index}`;
              const trackName = setting.name || defaultName;
              const trackType = setting.type || (trackName.toUpperCase().startsWith("A") ? "audio" : "video");

              const clipsWithThumbnails = clips.map((clip) => {
                const matchingShot = loadedShots.find((s) => s.outputVideo === clip.src || s.audioPath === clip.src || s.sourceImage === clip.src);
                if (matchingShot && matchingShot.previewBase64) return { ...clip, thumbnail: matchingShot.previewBase64 };
                return clip;
              });

              return {
                id: `track-${index}-${crypto.randomUUID()}`,
                name: trackName,
                type: trackType as "video" | "audio",
                isMuted: false,
                isHidden: !setting.visible,
                isLocked: setting.locked,
                clips: clipsWithThumbnails,
              };
            }),
          );

          const uniquePaths = new Set<string>();
          timelineData.tracks.flat().forEach((item: any) => { if (item.outputVideo) uniquePaths.add(item.outputVideo); });

          // Set initialized to true BEFORE setting tracks so that the useEffect hooks (prerender, auto-save) 
          // can fire when the render commits.
          initialized.current = true;
          setTracks(newTracks);

          // Batch blob updates
          const newBlobs = new Map();
          await Promise.all(
            Array.from(uniquePaths).map(async (path) => {
              try {
                const url = `http://localhost:3456/video/${path.replace(/\\/g, "/")}`;
                const res = await fetch(url);
                if (res.ok) {
                  const blob = await res.blob();
                  newBlobs.set(path, URL.createObjectURL(blob));
                }
              } catch (e) { }
            }),
          );
          
          if (newBlobs.size > 0) {
            setVideoBlobs((prev) => {
              const next = new Map(prev);
              newBlobs.forEach((v, k) => next.set(k, v));
              return next;
            });
          }
        } else {
          initialized.current = true;
          setTracks([{ id: "t1", name: "Video 1", type: "video", clips: [] }, { id: "t2", name: "Audio 1", type: "audio", clips: [] }]);
        }
      } catch (e) {
        initialized.current = true;
        setTracks([{ id: "t1", name: "Video 1", type: "video", clips: [] }, { id: "t2", name: "Audio 1", type: "audio", clips: [] }]);
      }
    } catch (err) { console.error(err); } finally { setIsLoading(false); }
  };

  // --- LOAD DATA ---
  useEffect(() => {
    if (projectId && sceneId) loadData(projectId, sceneId);
  }, [projectId, sceneId]);

  // --- AUTO-SAVE ---
  useEffect(() => {
    if (projectId && sceneId && initialized.current && shots.length > 0) {
      const timer = setTimeout(() => {
        const cleanShots = shots.map(({ previewBase64, ...keep }) => keep);
        SaveShots(projectId, sceneId, cleanShots as any);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [shots, projectId, sceneId]);

  useEffect(() => {
    if (projectId && sceneId && initialized.current) {
      const timer = setTimeout(() => {
        const legacyTracks = tracks.map((t) =>
          t.clips.map((c) => ({
            ...c,
            timelineId: c.id,
            startTime: c.start,
            trimStart: c.offset,
            outputVideo: t.type === "video" ? c.src : undefined,
            audioPath: t.type === "audio" ? c.src : undefined,
          })),
        );
        const legacySettings = tracks.map((t) => ({ name: t.name, type: t.type, visible: !t.isHidden, locked: t.isLocked }));
        SaveTimeline(projectId, sceneId, { tracks: legacyTracks, trackSettings: legacySettings } as any);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [tracks, projectId, sceneId]);

  // --- SYNC NEW VIDEOS TO BLOBS ---
  const fetchedBlobs = useRef<Set<string>>(new Set());

  useEffect(() => {
    shots.forEach((shot) => {
      // If we have a video, and it's not in the Blobs map, and we haven't already tried to fetch it...
      if (shot.outputVideo && !videoBlobs.has(shot.outputVideo) && !fetchedBlobs.current.has(shot.outputVideo)) {
        fetchedBlobs.current.add(shot.outputVideo);
        refreshVideoBlob(shot.outputVideo);
      }
    });
  }, [shots, videoBlobs]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedClipId) {
          e.preventDefault();
          recordHistory();
          setTracks((prev) => prev.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== selectedClipId) })));
          setSelectedClipId(null);
        }
      }

      if (e.code === "Space") {
        if (libraryRef.current?.contains(e.target as Node)) return;
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { window.removeEventListener("keydown", handleKeyDown); };
  }, [history, redoStack, tracks, shots, togglePlay, selectedClipId]);

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
        name: `Shot ${prev.reduce((max, s) => {
          const match = s.name.match(/^Shot (\d+)$/);
          return match ? Math.max(max, parseInt(match[1])) : max;
        }, 0) + 1}`,
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

  const handleDeleteClip = useCallback(
    (clipId: string) => {
      recordHistory();
      setTracks((prev) =>
        prev.map((t) => ({
          ...t,
          clips: t.clips.filter((c) => c.id !== clipId),
        })),
      );
      if (selectedClipId === clipId) setSelectedClipId(null);
    },
    [selectedClipId],
  );

  const createExtensionShot = useCallback(async (originalShot: Shot) => {
    const sourcePath = originalShot.outputVideo || originalShot.sourceImage;
    if (!sourcePath) { alert("Select source first"); return null; }
    const lastFramePath = await ExtractLastFrame(sourcePath);
    if (!lastFramePath) return null;
    const b64 = await ReadImageBase64(lastFramePath);
    return { ...originalShot, id: crypto.randomUUID(), name: `${originalShot.name} (Ext)`, sourceImage: lastFramePath, audioPath: "", waveform: [], previewBase64: b64, status: "DRAFT", outputVideo: "", duration: 4 };
  }, []);

  const handleExtendTimelineClip = useCallback(
    async (trackIndex: number, clipId: string) => {
      const track = tracks[trackIndex];
      if (!track) return;
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) return;

      // Find the shot this clip was likely derived from
      const originalShot = shots.find(
        (s) =>
          s.outputVideo === clip.src ||
          s.sourceImage === clip.src ||
          s.audioPath === clip.src,
      );

      // Synthesize a shot object if not found (needed for createExtensionShot)
      const shotToExtend = originalShot || ({
        id: crypto.randomUUID(),
        name: clip.name,
        sourceImage: clip.type === "image" ? clip.src : "",
        outputVideo: clip.type === "video" ? clip.src : "",
        audioPath: clip.type === "audio" ? clip.src : "",
        duration: clip.duration,
        prompt: "",
        motionStrength: 127,
        seed: 0,
        status: "DONE",
      } as Shot);

      const newShot = await createExtensionShot(shotToExtend);
      if (!newShot) return;

      recordHistory();

      // Add the new shot to the project's shots list
      setShots((prev) => {
        // Try to insert after the original shot if found
        if (originalShot) {
          const idx = prev.findIndex((s) => s.id === originalShot.id);
          const next = [...prev];
          next.splice(idx + 1, 0, newShot);
          return next;
        }
        return [...prev, newShot];
      });

      // Create the new timeline clip
      const newClip: TimelineClip = {
        id: newShot.id,
        type: newShot.outputVideo ? "video" : (newShot.audioPath ? "audio" : "video"),
        name: newShot.name,
        src: newShot.outputVideo || newShot.audioPath || newShot.sourceImage || "",
        start: clip.start + clip.duration, // Place immediately after the original clip
        duration: newShot.duration || 4,
        offset: 0,
        sourceDuration: newShot.duration || 4,
        color: newShot.audioPath ? "bg-purple-600" : "bg-blue-600",
        thumbnail: newShot.previewBase64,
      };

      // Update the tracks state to include the new clip
      setTracks((prev) => {
        const next = [...prev];
        const t = { ...next[trackIndex] };
        // Collision resolution happens on next drag/save or we can trust the user to move it
        t.clips = [...t.clips, newClip];
        next[trackIndex] = t;
        return next;
      });

      // Make the new extension shot active for the generator
      setActiveShotId(newShot.id);
    },
    [tracks, shots, createExtensionShot, recordHistory],
  );

  const handleExtendShot = useCallback(
    async (originalShot: Shot) => {
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
    },
    [shots, createExtensionShot],
  );

  const handleDeleteShot = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    confirm({
      title: "Delete Shot?", message: "This will permanently remove the shot.", variant: "danger",
      onConfirm: async () => {
        recordHistory();
        if (project && scene) await DeleteShot(project.id, scene.id, id);
        setShots((prev) => prev.filter((s) => s.id !== id));
      },
    });
  }, [confirm, project, scene]);

  const updateActiveShot = useCallback((updates: Partial<Shot>) => {
    if (!activeShotId) return;

    const shot = shots.find((s) => s.id === activeShotId);
    if (shot) {
      const isNewRender = updates.status?.toUpperCase() === "DONE";
      const newPath = updates.outputVideo;

      // Force a fresh blob fetch if a new video just finished rendering
      if (newPath && (isNewRender || newPath !== shot.outputVideo)) {
        refreshVideoBlob(newPath);
        generateWaveform(shot.id, newPath);
      }
      if (updates.audioPath && updates.audioPath !== shot.audioPath) {
        generateWaveform(shot.id, updates.audioPath);
      }
    }

    setShots((prev) => prev.map((s) => (s.id === activeShotId ? { ...s, ...updates } : s)));
    setTracks((prev) => prev.map((track) => ({
      ...track, clips: track.clips.map((clip) => {
        if (clip.id === activeShotId) {
          const newItem = { ...clip, ...updates } as any;
          // CRITICAL FIX: The timeline reads 'src', not 'outputVideo'. 
          if (updates.outputVideo) newItem.src = updates.outputVideo;
          if (updates.duration) newItem.duration = updates.duration;
          return newItem;
        }
        return clip;
      })
    })));
  }, [activeShotId, shots]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Enter"], cancel: ["Escape"], end: ["Enter"] } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const activatorEvent = event.activatorEvent as any;
    if (activatorEvent && 'clientX' in activatorEvent && event.active.rect.current.initial) {
      setDragContext({
        cursorOffsetX: activatorEvent.clientX - event.active.rect.current.initial.left,
        cursorOffsetY: activatorEvent.clientY - event.active.rect.current.initial.top,
      });
    } else {
      setDragContext(null);
    }

    if (event.active.data.current?.shot) return setActiveDragItem(event.active.data.current.shot);
    const shot = shots.find((s) => s.id === event.active.id);
    if (shot) return setActiveDragItem(shot);
    for (const track of tracks) {
      const item = track.clips.find((i) => i.id === event.active.id);
      if (item) return setActiveDragItem(item);
    }
  };

  const handleDragOver = (event: DragOverEvent) => { };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over, delta } = event;
    setActiveDragItem(null);
    setDragContext(null);

    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("track-")) return;

    const trackIndex = parseInt(overId.split("-")[1]);

    let shotData = active.data.current?.shot;
    if (!shotData) {
      const activeId = String(active.id).replace("library-", "");
      shotData = shots.find((s) => s.id === activeId);
    }

    if (shotData) {
      recordHistory();
      
      const activatorEvent = event.activatorEvent as MouseEvent;
      const currentMouseX = activatorEvent.clientX + delta.x;
      const dropX = currentMouseX - over.rect.left;

      let duration = shotData.duration || 4;
      
      // Center the clip: start = dropTime - (duration / 2)
      let startTime = Math.max(0, (dropX / zoom) - (duration / 2));

      // --- SNAPPING LOGIC ---
      const snapThreshold = 0.2; // 200ms threshold
      let bestSnapDelta = Infinity;
      let snapTarget = null;

      const track = tracks[trackIndex];
      const candidates = [0]; // Always snap to 0
      track.clips.forEach(c => {
        candidates.push(c.start);
        candidates.push(c.start + c.duration);
      });

      // Check for snap on START
      candidates.forEach(pt => {
        const delta = pt - startTime;
        if (Math.abs(delta) < snapThreshold && Math.abs(delta) < Math.abs(bestSnapDelta)) {
          bestSnapDelta = delta;
          snapTarget = pt;
        }
      });

      // Check for snap on END
      const endTime = startTime + duration;
      candidates.forEach(pt => {
        const delta = pt - endTime;
        if (Math.abs(delta) < snapThreshold && Math.abs(delta) < Math.abs(bestSnapDelta)) {
          bestSnapDelta = delta;
          snapTarget = pt - duration; // Adjust start time to align end
        }
      });

      if (snapTarget !== null) {
        startTime = snapTarget;
      }

      // Quantize to frame (if not snapped, or even if snapped to align perfectly)
      const fps = project?.fps || 30; // Use project FPS
      startTime = Math.round(startTime * fps) / fps;

      // --- DURATION FIX: Load Metadata ---
      const src = shotData.outputVideo || shotData.audioPath || shotData.sourceImage || "";
      const isVideoOrAudio = shotData.outputVideo || shotData.audioPath;

      if (isVideoOrAudio && src) {
        try {
          // --- PROXY ENGINE: Sanitize Dropped File ---
          // This ensures local files get the same "Fast Decode" treatment as generated ones.
          // Note: This operation might take a moment for large files. 
          // Ideally we show a spinner, but for now we await it to guarantee stability.
          console.log("Sanitizing/Proxying file...", src);
          // @ts-ignore
          await window.go.main.App.SanitizeLocalFile(src);
          console.log("Sanitization complete.");

          // Helper to get safe URL (local server)
          const getSafeUrl = (filePath: string) => {
            if (!filePath) return "";
            if (filePath.startsWith("http") || filePath.startsWith("blob")) return filePath;
            return `http://localhost:3456/video/${encodeURIComponent(filePath.replace(/\\/g, "/"))}`;
          };

          const mediaUrl = getSafeUrl(src);
          const element = document.createElement(shotData.audioPath ? 'audio' : 'video');
          element.src = mediaUrl;

          await new Promise((resolve) => {
            element.onloadedmetadata = () => {
              if (element.duration && isFinite(element.duration)) {
                duration = element.duration;
              }
              resolve(true);
            };
            element.onerror = () => resolve(false);
            // Timeout to prevent hanging
            setTimeout(() => resolve(false), 2000);
          });
        } catch (e) {
          console.error("Failed to load metadata or sanitize:", e);
        }
      }

      const newClip: TimelineClip = {
        id: crypto.randomUUID(),
        type: shotData.outputVideo ? "video" : (shotData.audioPath ? "audio" : "video"),
        name: shotData.name,
        src: src,
        start: startTime,
        duration: duration,
        offset: 0,
        sourceDuration: duration,
        color: shotData.audioPath ? "bg-purple-600" : "bg-blue-600",
        thumbnail: shotData.previewBase64,
      };

      setTracks((prev) => {
        const next = [...prev];
        if (next[trackIndex]) {
          next[trackIndex] = { ...next[trackIndex], clips: [...next[trackIndex].clips, newClip] };
        }
        return next;
      });
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportProgress(0);
    setExportStatus("Initializing...");

    const cleanupStatus = (window as any).runtime.EventsOn("export:status", (msg: string) => setExportStatus(msg));
    const cleanupProgress = (window as any).runtime.EventsOn("export:progress", (pct: number) => setExportProgress(pct));

    try {
      const result = await (window as any).go.main.App.ExportVideo(project?.id, scene?.id, exportOptions);
      if (result !== "Success" && result !== "Cancelled") alert("Export failed: " + result);
    } finally {
      cleanupStatus();
      cleanupProgress();
      setIsExporting(false);
      closeExportModal();
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
        <button onClick={() => setIsGeneratorFullHeight(!isGeneratorFullHeight)} className="text-zinc-400 hover:text-white" title={isGeneratorFullHeight ? "Switch to Classic View" : "Switch to Full Height"}>
          {isGeneratorFullHeight ? <PanelTop size={14} /> : <PanelLeft size={14} />}
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <GeneratorPanel
          activeShot={activeShot}
          updateActiveShot={updateActiveShot}
          project={project}
          scene={scene}
          shots={shots}
          isRendering={isRendering}
          setIsRendering={setIsRendering}
          setVideoCache={(id: string, b64: string) => videoCache.current.set(id, b64)}
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
        <div className="flex-1 flex overflow-hidden">
          {isGeneratorFullHeight && (
            <>
              <div style={{ width: generatorWidth }} className="border-r border-zinc-800 bg-[#09090b] flex flex-col min-h-0 shrink-0">{generatorContent}</div>
              <div className="w-1 hover:w-1.5 bg-zinc-900 hover:bg-[#D2FF44] cursor-col-resize transition-all z-50 flex-shrink-0" onPointerDown={(e) => { isResizingGen.current = true; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)} />
            </>
          )}

          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex-1 flex overflow-hidden min-h-0">
              {!isGeneratorFullHeight && (
                <>
                  <div style={{ width: generatorWidth }} className="border-r border-zinc-800 bg-[#09090b] flex flex-col min-h-0 shrink-0">{generatorContent}</div>
                  <div className="w-1 hover:w-1.5 bg-zinc-900 hover:bg-[#D2FF44] cursor-col-resize transition-all z-50 flex-shrink-0" onPointerDown={(e) => { isResizingGen.current = true; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)} />
                </>
              )}
              <div ref={libraryRef} style={{ width: libraryWidth }} className="border-r border-zinc-800 bg-[#09090b] flex flex-col min-h-0 shrink-0">
                <LibraryPanel
                  shots={shots}
                  activeShotId={activeShotId}
                  setActiveShotId={setActiveShotId}
                  handleAddShot={handleAddShot}
                  handleExtendShot={handleExtendShot}
                  handleDeleteShot={handleDeleteShot}
                  handlePlayShot={handlePlayShot}
                  previewingShotId={previewingShotId}
                />
              </div>
              <div className="w-1 hover:w-1.5 bg-zinc-900 hover:bg-[#D2FF44] cursor-col-resize transition-all z-50 flex-shrink-0" onPointerDown={(e) => { isResizingLib.current = true; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)} />

              <div className="flex-1 min-w-0 bg-black min-h-0 relative">
                {/* ViewerPanel receives the dynamically determined "active time".
                  If previewing, it runs on 'previewTime' (starts at 0).
                  If normal, it runs on 'currentTime' (global timeline).
                */}
                <ViewerPanel
                  tracks={displayTracks}
                  totalDuration={displayDuration}
                  currentTime={activeTime}
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                  setCurrentTime={setActiveTime}
                  projectFps={projectFps}
                  volume={masterVolume}
                  videoBlobs={videoBlobs}
                />
              </div>

            </div>
            <div className="h-1 hover:h-1.5 bg-zinc-900 hover:bg-[#D2FF44] cursor-row-resize transition-all z-50 shrink-0" onPointerDown={(e) => { isResizingTime.current = true; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)} />

            <div style={{ height: timelineHeight }} className="border-t border-zinc-800 bg-[#1e1e20] shrink-0">
              <div style={{ height: timelineHeight }} className="shrink-0">
                <SimpleTimeline
                  tracks={tracks}
                  setTracks={setTracks}

                  // Timeline always listens to the global currentTime
                  currentTime={currentTime}

                  // If the user clicks the timeline to seek, instantly exit preview mode
                  setCurrentTime={handleTimelineTimeChange}

                  zoom={zoom}
                  setZoom={setZoom}

                  // It can still toggle play/pause globally
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}

                  onUndo={undo}
                  onRedo={redo}
                  volume={masterVolume}
                  onVolumeChange={handleVolumeChange}
                  selectedClipId={selectedClipId}
                  onSelectClip={setSelectedClipId}
                  onDeleteClip={handleDeleteClip}
                  onExtendClip={handleExtendTimelineClip}
                  onRegisterHistory={recordHistory}
                  fps={projectFps}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <DragOverlay
        modifiers={[
          ({ transform, activeNodeRect, activatorEvent }) => {
            if (!activeNodeRect || !activatorEvent) return transform;
            const e = activatorEvent as any;
            const isShot = activeDragItem && !("timelineId" in activeDragItem);
            
            if (isShot) {
              // Calculate the rendered width of the overlay
              const duration = activeDragItem.duration || 4;
              const overlayWidth = duration * zoom;
              const halfOverlayWidth = overlayWidth / 2;
              const overlayHeight = 48; // TRACK_HEIGHT
              const halfOverlayHeight = overlayHeight / 2;

              // Calculate current cursor position based on initial click + delta
              // e.clientX is the INITIAL click X
              const currentCursorX = e.clientX + transform.x;
              const currentCursorY = e.clientY + transform.y;

              // We want to center the overlay on the CURRENT cursor.
              // dnd-kit positions relative to the INITIAL element rect (activeNodeRect.left/top).
              // transform = TargetScreenPos - InitialRectPos
              
              const newTransformX = currentCursorX - halfOverlayWidth - activeNodeRect.left;
              const newTransformY = currentCursorY - halfOverlayHeight - activeNodeRect.top;

              return {
                ...transform,
                x: newTransformX,
                y: newTransformY,
              };
            }

            // Normal logic for timeline clips (grabbing center logic)
            const grabOffsetX = e.clientX - activeNodeRect.left;
            const halfWidth = activeNodeRect.width / 2;
            
            return {
              ...transform,
              x: transform.x + grabOffsetX - halfWidth,
            };
          }
        ]}
        dropAnimation={activeDragItem && "timelineId" in activeDragItem ? { sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.5" } } }) } : null}
      >
        {activeDragItem ? (
          "timelineId" in activeDragItem ? (
            <div style={{ width: (activeDragItem.duration || 4) * zoom, height: "96px" }} className="relative flex flex-col overflow-hidden bg-[#375a6c] border border-[#213845] rounded-sm shadow-xl cursor-grabbing">
              <div className="flex-1 relative overflow-hidden flex">
                {activeDragItem.previewBase64 && <img src={activeDragItem.previewBase64} className="h-full w-full object-cover" />}
              </div>
              <div className="absolute bottom-0 w-full bg-[#20343e] px-2 py-0.5 text-[9px] text-zinc-300 truncate font-mono">{activeDragItem.name} ({activeDragItem.duration?.toFixed(2)}s)</div>
            </div>
          ) : (
            <div
              style={{
                width: ((activeDragItem.duration || 4) * zoom),
                height: 48, // TRACK_HEIGHT
              }}
              className={`relative flex flex-col overflow-hidden border rounded-sm shadow-2xl cursor-grabbing
                ${activeDragItem.audioPath && !activeDragItem.outputVideo ? "bg-[#1a1a1c] border-white/10" : "bg-[#375a6c] border-[#213845]"}
              `}
            >
              {/* VERTICAL ALIGNMENT LINE */}
              <div className="absolute top-0 bottom-0 left-0 w-0.5 bg-[#D2FF44] z-50" />
              
              {/* CONTENT */}
              {!(activeDragItem.audioPath && !activeDragItem.outputVideo) && (
                <div className="flex-1 relative overflow-hidden flex bg-zinc-800">
                  {activeDragItem.previewBase64 && (
                    <img
                      src={activeDragItem.previewBase64}
                      className="w-full h-full object-cover opacity-90 pointer-events-none"
                    />
                  )}
                  <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent px-2 py-0.5 text-[9px] text-zinc-300 truncate font-mono pointer-events-none z-10">
                    {activeDragItem.name}
                  </div>
                </div>
              )}
              {(activeDragItem.audioPath && !activeDragItem.outputVideo) && (
                <div className="relative overflow-hidden shrink-0 flex items-center flex-1 w-full bg-[#101012]">
                  <div className="w-full h-px bg-[#D2FF44]/30" />
                  <div className="absolute top-1 left-2 text-[9px] text-zinc-400 font-mono pointer-events-none">
                    {activeDragItem.name}
                  </div>
                </div>
              )}
            </div>
          )
        ) : null}
      </DragOverlay>

      {/* EXPORT MODAL */}
      {isExportModalOpen && (
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
              <button onClick={() => !isExporting && closeExportModal()} className="text-zinc-500 hover:text-white transition-colors" disabled={isExporting}>
                <X size={20} />
              </button>
            </div>

            {isExporting ? (
              <div className="p-12 flex flex-col items-center justify-center gap-8 min-h-[400px]">
                <div className="relative">
                  <div className="absolute inset-0 bg-[#D2FF44] blur-xl opacity-20 rounded-full animate-pulse" />
                  <Loader2 className="animate-spin text-[#D2FF44] relative z-10" size={64} />
                </div>

                <div className="text-center space-y-2 w-full max-w-md">
                  <h3 className="text-2xl font-bold text-white">Rendering Video...</h3>
                  <div className="flex justify-between text-xs font-mono text-zinc-400 uppercase tracking-widest">
                    <span>Processing</span>
                    <span>{exportProgress}%</span>
                  </div>
                  <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#D2FF44] to-[#a3d616] transition-all duration-300 ease-out shadow-[0_0_10px_#D2FF44]" style={{ width: `${exportProgress}%` }} />
                  </div>
                  <p className="text-xs text-zinc-500 font-mono mt-4 border border-zinc-800/50 bg-black/20 p-2 rounded text-center">
                    {exportStatus || "Initializing engine..."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-[450px]">
                <div className="w-[60%] p-8 flex flex-col gap-8">
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Quick Presets</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[{ id: "web", label: "Web (MP4)", fmt: "mp4" }, { id: "master", label: "Master (MOV)", fmt: "mov" }, { id: "audio", label: "Audio Only", fmt: "mp3" }].map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => setExportOptions((prev) => ({ ...prev, format: preset.fmt, includeVideo: preset.fmt !== "mp3", includeAudio: true }))}
                          className={`py-2 px-3 rounded border text-xs font-bold transition-all ${exportOptions.format === preset.fmt ? "bg-[#D2FF44]/10 border-[#D2FF44] text-[#D2FF44]" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"}`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Format</label>
                      <select value={exportOptions.format} onChange={(e) => setExportOptions({ ...exportOptions, format: e.target.value })} className="w-full bg-zinc-900 border border-zinc-700 rounded-md p-2.5 text-sm text-white focus:border-[#D2FF44] focus:ring-1 focus:ring-[#D2FF44] outline-none">
                        <option value="mp4">MP4 (H.264)</option>
                        <option value="mov">MOV (ProRes 422)</option>
                        <option value="mkv">MKV (Matroska)</option>
                        <option value="mp3">MP3 (Audio)</option>
                        <option value="wav">WAV (Lossless)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Quality</label>
                      <select value={exportOptions.quality} onChange={(e) => setExportOptions({ ...exportOptions, quality: e.target.value })} disabled={exportOptions.format === "mp3" || exportOptions.format === "wav"} className="w-full bg-zinc-900 border border-zinc-700 rounded-md p-2.5 text-sm text-white focus:border-[#D2FF44] focus:ring-1 focus:ring-[#D2FF44] outline-none disabled:opacity-50 disabled:cursor-not-allowed">
                        <option value="high">High (Best Quality)</option>
                        <option value="medium">Medium (Balanced)</option>
                        <option value="low">Low (Draft / Small)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Streams</label>
                    <div className="flex flex-col gap-3 bg-zinc-900/50 p-4 rounded-lg border border-zinc-800">
                      <label className="flex items-center justify-between cursor-pointer group">
                        <span className="text-sm text-zinc-300 font-medium group-hover:text-white transition-colors">Export Video</span>
                        <input type="checkbox" checked={exportOptions.includeVideo} disabled={exportOptions.format === "mp3" || exportOptions.format === "wav"} onChange={(e) => setExportOptions({ ...exportOptions, includeVideo: e.target.checked })} className="accent-[#D2FF44] h-4 w-4" />
                      </label>
                      <div className="h-px bg-zinc-800" />
                      <label className="flex items-center justify-between cursor-pointer group">
                        <span className="text-sm text-zinc-300 font-medium group-hover:text-white transition-colors">Export Audio</span>
                        <input type="checkbox" checked={exportOptions.includeAudio} onChange={(e) => setExportOptions({ ...exportOptions, includeAudio: e.target.checked })} className="accent-[#D2FF44] h-4 w-4" />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="w-[40%] bg-[#0d0d10] border-l border-zinc-800 p-8 flex flex-col justify-between">
                  <div className="space-y-6">
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest border-b border-zinc-800 pb-2">Summary</h3>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="flex justify-between items-center"><span className="text-xs text-zinc-500">Duration</span><span className="text-sm font-mono text-zinc-200">{formatTime(totalDuration)}</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs text-zinc-500">Resolution</span><span className="text-sm font-mono text-zinc-200">1920 x 1080</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs text-zinc-500">Frame Rate</span><span className="text-sm font-mono text-zinc-200">24 FPS</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs text-zinc-500">Codec</span><span className="text-sm font-mono text-zinc-200 uppercase">{exportOptions.format === "mov" ? "ProRes 422" : "H.264 / AAC"}</span></div>
                    </div>
                    <div className="bg-zinc-900/50 p-4 rounded border border-dashed border-zinc-800">
                      <div className="flex justify-between items-end">
                        <span className="text-xs text-zinc-500">Est. File Size</span>
                        <span className="text-lg font-bold text-[#D2FF44]">~{estimateFileSize(totalDuration, exportOptions.format)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <button onClick={handleExport} disabled={isExporting} className="w-full py-3 bg-[#D2FF44] hover:bg-[#b8e635] text-black font-bold rounded-lg transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2">
                      <Download size={18} /> Render Video
                    </button>
                    <button onClick={() => closeExportModal()} className="w-full py-2 text-xs font-bold text-zinc-500 hover:text-white transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ASSET LIBRARY MODAL */}
      <AssetLibraryModal
        isOpen={isAssetLibraryOpen}
        onClose={closeAssetLibrary}
        project={project}
      />
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