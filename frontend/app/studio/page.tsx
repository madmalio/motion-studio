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

// --- COMPONENTS ---
import GeneratorPanel from "../../components/studio/GeneratorPanel";
import LibraryPanel from "../../components/studio/LibraryPanel";
import ViewerPanel from "../../components/studio/ViewerPanel";
import TimelinePanel from "../../components/studio/TimelinePanel";
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
  const [isRendering, setIsRendering] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const [exportOptions, setExportOptions] = useState({
    format: "mp4",
    includeVideo: true,
    includeAudio: true,
  });

  // Timeline & Playback State
  const [tracks, setTracks] = useState<TimelineItem[][]>([[], []]);
  const [trackSettings, setTrackSettings] = useState<
    {
      locked: boolean;
      visible: boolean;
      name: string;
      height?: number;
      type?: "video" | "audio";
    }[]
  >([
    { locked: false, visible: true, name: "V1", height: 48, type: "video" },
    { locked: false, visible: true, name: "A1", height: 48, type: "audio" },
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

  // --- UNDO / REDO ---
  const [history, setHistory] = useState<any[]>([]);
  const [redoStack, setRedoStack] = useState<any[]>([]);

  const recordHistory = () => {
    setHistory((prev) => [
      ...prev,
      {
        tracks: JSON.parse(JSON.stringify(tracks)),
        shots: JSON.parse(JSON.stringify(shots)),
        trackSettings: JSON.parse(JSON.stringify(trackSettings)),
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
        trackSettings: JSON.parse(JSON.stringify(trackSettings)),
      },
    ]);
    setHistory(newHistory);
    setTracks(previous.tracks);
    setShots(previous.shots);
    setTrackSettings(previous.trackSettings);
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
        trackSettings: JSON.parse(JSON.stringify(trackSettings)),
      },
    ]);
    setRedoStack(newRedo);
    setTracks(next.tracks);
    setShots(next.shots);
    setTrackSettings(next.trackSettings);
  };

  const totalDuration = Math.max(
    0,
    ...tracks.map((t) =>
      t.reduce((acc, s) => Math.max(acc, s.startTime + (s.duration || 4)), 0),
    ),
  );

  // --- ENGINE STATE ---
  const playbackTracks = useMemo(() => {
    return tracks.map((track, index) => {
      if (trackSettings[index] && !trackSettings[index].visible) {
        return [];
      }
      return track;
    });
  }, [tracks, trackSettings]);

  const {
    primaryVideoRef,
    secondaryVideoRef,
    canvasRef,
    isPlaying,
    setIsPlaying,
    togglePlay,
    currentTime,
    seekTo,
  } = useGaplessPlayback({
    tracks: playbackTracks,
    trackSettings,
    totalDuration,
    videoBlobs,
    volume: masterVolume,
  });

  // --- AUTO-SAVE ---
  useEffect(() => {
    if (projectId && sceneId && initialized.current && shots.length > 0) {
      const cleanShots = shots.map(({ previewBase64, ...keep }) => keep);
      SaveShots(projectId, sceneId, cleanShots as any);
    }
  }, [shots, projectId, sceneId]);

  // --- AUTO-SAVE TIMELINE ---
  useEffect(() => {
    if (projectId && sceneId && initialized.current) {
      const cleanTracks = tracks.map((track) =>
        track.map(({ previewBase64, ...rest }) => rest),
      );
      SaveTimeline(projectId, sceneId, {
        tracks: cleanTracks,
        trackSettings,
      } as any);
    }
  }, [tracks, trackSettings, projectId, sceneId]);

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
            } catch (e) {}
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
      setShots((prev) =>
        prev.map((s) => (s.id === shotId ? { ...s, waveform: peaks } : s)),
      );
      setTracks((prev) =>
        prev.map((track) =>
          track.map((item) =>
            item.id === shotId ? { ...item, waveform: peaks } : item,
          ),
        ),
      );
    }
  };

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

        hydratedShots.forEach((shot) => {
          const path = shot.outputVideo || shot.audioPath;
          if (path && (!shot.waveform || shot.waveform.length === 0)) {
            generateWaveform(shot.id, path);
          }
        });
      }

      try {
        const timelineData = await GetTimeline(pId, sId);
        if (timelineData && timelineData.tracks) {
          const hydratedTracks = await Promise.all(
            timelineData.tracks.map(async (track: any[]) => {
              return Promise.all(
                track.map(async (item: any) => {
                  const src = item.sourceImage;
                  if (src) {
                    const b64 = await ReadImageBase64(src);
                    return { ...item, previewBase64: b64 };
                  }
                  return item;
                }),
              );
            }),
          );
          setTracks(hydratedTracks);

          // --- FIX: Force Sync trackSettings to match tracks length ---
          const savedSettings = timelineData.trackSettings || [];
          const syncedSettings = hydratedTracks.map((_, i) => {
            // Use existing or create default
            if (savedSettings[i]) {
              const setting = { ...savedSettings[i] } as any;
              // Ensure type is set so renaming doesn't break playback/logic
              if (!setting.type) {
                setting.type = (setting.name || "")
                  .trim()
                  .toUpperCase()
                  .startsWith("A")
                  ? "audio"
                  : "video";
              }
              if (setting.name === "V1") {
                return { ...setting, visible: true };
              }
              return setting;
            }

            // Heuristic defaults
            return {
              locked: false,
              visible: true,
              name: i >= 1 ? `A${i}` : `V1`, // Simple default
              height: 64,
              type: (i >= 1 ? "audio" : "video") as "audio" | "video",
            };
          });
          setTrackSettings(syncedSettings);

          const uniquePaths = new Set<string>();
          hydratedTracks.flat().forEach((item: any) => {
            if (item.outputVideo) uniquePaths.add(item.outputVideo);
          });
          const blobMap = new Map<string, string>();
          await Promise.all(
            Array.from(uniquePaths).map(async (path) => {
              try {
                const url = `http://localhost:3456/video/${path.replace(/\\/g, "/")}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                blobMap.set(path, URL.createObjectURL(blob));
              } catch (e) {
                console.error("Failed to preload clip:", path, e);
              }
            }),
          );
          setVideoBlobs(blobMap);
        } else {
          setTracks([[], []]);
          setTrackSettings([
            {
              locked: false,
              visible: true,
              name: "V1",
              height: 48,
              type: "video",
            },
            {
              locked: false,
              visible: true,
              name: "A1",
              height: 48,
              type: "audio",
            },
          ]);
        }
      } catch (e) {
        setTracks([[], []]);
        setTrackSettings([
          {
            locked: false,
            visible: true,
            name: "V1",
            height: 48,
            type: "video",
          },
          {
            locked: false,
            visible: true,
            name: "A1",
            height: 48,
            type: "audio",
          },
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

  const handleAddShot = () => {
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
  };

  const handleExtendShot = async (originalShot: Shot) => {
    const sourcePath = originalShot.outputVideo || originalShot.sourceImage;
    if (!sourcePath) return alert("Select source first");
    const lastFramePath = await ExtractLastFrame(sourcePath);
    if (!lastFramePath) return;
    const b64 = await ReadImageBase64(lastFramePath);
    recordHistory();
    const newId = crypto.randomUUID();
    setShots((prev) => {
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
      };
      return [...prev, newShot];
    });
    setActiveShotId(newId);
  };

  const handleDeleteShot = (e: React.MouseEvent, id: string) => {
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
  };

  const updateActiveShot = (updates: Partial<Shot>) => {
    if (!activeShotId) return;
    const shot = shots.find((s) => s.id === activeShotId);
    if (shot) {
      if (updates.outputVideo && updates.outputVideo !== shot.outputVideo) {
        generateWaveform(shot.id, updates.outputVideo);
      }
      if (updates.audioPath && updates.audioPath !== shot.audioPath) {
        generateWaveform(shot.id, updates.audioPath);
      }
    }
    setShots((prev) =>
      prev.map((s) => (s.id === activeShotId ? { ...s, ...updates } : s)),
    );
    setTracks((prev) =>
      prev.map((track) =>
        track.map((item) =>
          item.id === activeShotId ? { ...item, ...updates } : item,
        ),
      ),
    );
  };

  const handleUpdateItem = (id: string, updates: Partial<TimelineItem>) => {
    recordHistory();
    setTracks((prev) =>
      prev.map((track) =>
        track.map((item) =>
          item.timelineId === id ? { ...item, ...updates } : item,
        ),
      ),
    );
  };

  const handleSplit = (itemId: string, splitTime: number) => {
    if (!itemId || splitTime === undefined) return;
    recordHistory();

    setTracks((prev) => {
      const newTracks = [...prev];
      let targetTrackIndex = -1;
      let targetItemIndex = -1;

      for (let t = 0; t < newTracks.length; t++) {
        const idx = newTracks[t].findIndex(
          (item) => item.timelineId === itemId,
        );
        if (idx !== -1) {
          targetTrackIndex = t;
          targetItemIndex = idx;
          break;
        }
      }

      if (targetTrackIndex !== -1 && targetItemIndex !== -1) {
        const track = newTracks[targetTrackIndex];
        const item = track[targetItemIndex];
        if (
          splitTime <= item.startTime + 0.05 ||
          splitTime >= item.startTime + (item.duration || 0) - 0.05
        ) {
          return prev;
        }
        const splitOffset = splitTime - item.startTime;
        const leftItem = { ...item, duration: splitOffset };
        const rightItem: TimelineItem = {
          ...item,
          timelineId: crypto.randomUUID(),
          startTime: splitTime,
          duration: (item.duration || 0) - splitOffset,
          trimStart: (item.trimStart || 0) + splitOffset,
        };
        const newTrack = [...track];
        newTrack[targetItemIndex] = leftItem;
        newTrack.splice(targetItemIndex + 1, 0, rightItem);
        newTracks[targetTrackIndex] = newTrack;
        return newTracks;
      }
      return prev;
    });
  };

  // --- TRACK MANAGEMENT ---
  const handleAddAudioTrack = () => {
    recordHistory();
    setTracks((prevTracks) => [...prevTracks, []]);

    setTrackSettings((prevSettings) => {
      // AUTO-HEAL: Ensure we start with a clean list matched to current tracks
      const validSettings = prevSettings.slice(0, tracks.length);

      const audioTracks = validSettings.filter((t) => {
        if (t.type) return t.type === "audio";
        return (t.name || "").trim().toUpperCase().match(/^A\d+/);
      });

      let nextNum = 1;
      if (audioTracks.length > 0) {
        const lastTrack = audioTracks[audioTracks.length - 1];
        const match = (lastTrack.name || "").match(/(\d+)/);
        if (match) {
          nextNum = parseInt(match[1], 10) + 1;
        } else {
          nextNum = audioTracks.length + 1;
        }
      }
      const name = `A${nextNum}`;
      return [
        ...validSettings,
        { locked: false, visible: true, name, height: 64, type: "audio" },
      ];
    });
  };

  const handleAddTrack = () => {
    recordHistory();

    // We want new video tracks to appear ABOVE V1 in the UI.
    // Your UI currently renders earlier tracks "higher", so we insert at the top of the VIDEO stack.
    // That means: insert at index 0 (before all existing tracks).
    const insertIndex = 0;

    setTracks((prevTracks) => {
      const next = [...prevTracks];
      next.splice(insertIndex, 0, []);
      return next;
    });

    setTrackSettings((prevSettings) => {
      // Keep settings aligned to tracks length before we add the new one
      const validSettings = prevSettings.slice(0, tracks.length);

      // Count existing video tracks by name (V1, V2, ...)
      const videoCount = validSettings.filter((s) => {
        if (s.type) return s.type === "video";
        return (s?.name || "").trim().toUpperCase().startsWith("V");
      }).length;

      const name = `V${videoCount + 1}`;

      const next = [...validSettings];
      next.splice(insertIndex, 0, {
        locked: false,
        visible: true,
        name,
        height: 48,
        type: "video",
      });

      return next;
    });
  };

  const handleDeleteTrack = (index: number) => {
    recordHistory();
    setTracks((prev) => prev.filter((_, i) => i !== index));
    setTrackSettings((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRenameTrack = (index: number, newName: string) => {
    setTrackSettings((prev) =>
      prev.map((s, i) => (i === index ? { ...s, name: newName } : s)),
    );
  };

  const handleResizeTrack = (index: number, newHeight: number) => {
    setTrackSettings((prev) =>
      prev.map((s, i) => (i === index ? { ...s, height: newHeight } : s)),
    );
  };

  const handleToggleTrackLock = (index: number) => {
    setTrackSettings((prev) =>
      prev.map((s, i) => (i === index ? { ...s, locked: !s.locked } : s)),
    );
  };

  const handleToggleTrackVisibility = (index: number) => {
    setTrackSettings((prev) => {
      const newSettings = [...prev];
      // Safety check: ensure the setting exists before toggling
      if (!newSettings[index]) {
        newSettings[index] = {
          locked: false,
          visible: true,
          name: `Track ${index + 1}`,
          height: 64,
        };
      }
      newSettings[index] = {
        ...newSettings[index],
        visible: !newSettings[index].visible,
      };
      return newSettings;
    });
  };

  // --- DND LOGIC ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.shot) {
      setActiveDragItem(event.active.data.current.shot);
    } else {
      const shot = shots.find((s) => s.id === event.active.id);
      if (shot) {
        setActiveDragItem(shot);
        return;
      }
      for (const track of tracks) {
        const item = track.find((i) => i.timelineId === event.active.id);
        if (item) setActiveDragItem(item);
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
    if (!over) return;

    const dropContainer = findContainer(over.id as string, tracks);
    if (!dropContainer) return;

    const overId = over.id as string;
    const overType = over.data.current?.type;
    if (overType !== "track" && overType !== "timeline-item") return;

    const targetTrackIndex = parseInt(
      dropContainer.replace("timeline-track-", ""),
    );
    const trackIsAudio = (idx: number) => {
      const t = trackSettings?.[idx];
      if (t?.type) return t.type === "audio";
      return (t?.name || "").trim().toUpperCase().startsWith("A");
    };

    const targetIsAudio = trackIsAudio(targetTrackIndex);

    const activeRect = active.rect.current.translated;
    const overRect = over.rect;

    let newStartTime = 0;
    if (activeRect && overRect) {
      const relativeX = activeRect.left - overRect.left;
      const rawTime = Math.max(0, relativeX / zoom);

      newStartTime = rawTime;
      if (!isCtrlPressed.current) {
        const SNAP_THRESHOLD_PX = 15;
        const snapThreshold = SNAP_THRESHOLD_PX / zoom;
        let activeDuration = 4;
        let foundItem: any;
        for (const t of tracks) {
          const i = t.find((it) => it.timelineId === active.id);
          if (i) {
            foundItem = i;
            break;
          }
        }
        if (!foundItem) {
          foundItem = shots.find((s) => s.id === active.id);
        }
        if (foundItem) {
          activeDuration = foundItem.duration || 4;
        }
        let minDiff = snapThreshold;
        if (Math.abs(rawTime - 0) < minDiff) {
          newStartTime = 0;
          minDiff = Math.abs(rawTime - 0);
        }
        if (Math.abs(rawTime - currentTime) < minDiff) {
          newStartTime = currentTime;
          minDiff = Math.abs(rawTime - currentTime);
        }
        if (Math.abs(rawTime + activeDuration - currentTime) < minDiff) {
          newStartTime = Math.max(0, currentTime - activeDuration);
          minDiff = Math.abs(rawTime + activeDuration - currentTime);
        }
        tracks.forEach((track) => {
          track.forEach((item) => {
            if (item.timelineId === active.id) return;
            const itemStart = item.startTime;
            const itemEnd = item.startTime + (item.duration || 4);
            const diffStartStart = Math.abs(rawTime - itemStart);
            if (diffStartStart < minDiff) {
              newStartTime = itemStart;
              minDiff = diffStartStart;
            }
            const diffStartEnd = Math.abs(rawTime - itemEnd);
            if (diffStartEnd < minDiff) {
              newStartTime = itemEnd;
              minDiff = diffStartEnd;
            }
            const myEnd = rawTime + activeDuration;
            const diffEndStart = Math.abs(myEnd - itemStart);
            if (diffEndStart < minDiff) {
              newStartTime = Math.max(0, itemStart - activeDuration);
              minDiff = diffEndStart;
            }
            const diffEndEnd = Math.abs(myEnd - itemEnd);
            if (diffEndEnd < minDiff) {
              newStartTime = Math.max(0, itemEnd - activeDuration);
              minDiff = diffEndEnd;
            }
          });
        });
      }
    }

    const applyOverwrite = (
      trackItems: TimelineItem[],
      newItem: TimelineItem,
    ) => {
      const result: TimelineItem[] = [];
      const start = newItem.startTime;
      const end = newItem.startTime + (newItem.duration || 0);
      for (const item of trackItems) {
        if (item.timelineId === newItem.timelineId) continue;
        const itemStart = item.startTime;
        const itemEnd = item.startTime + (item.duration || 0);
        if (start < itemEnd && end > itemStart) {
          if (start <= itemStart && end >= itemEnd) {
            continue;
          } else if (start > itemStart && end < itemEnd) {
            result.push({ ...item, duration: start - itemStart });
            result.push({
              ...item,
              timelineId: crypto.randomUUID(),
              startTime: end,
              duration: itemEnd - end,
              trimStart: (item.trimStart || 0) + (end - itemStart),
            });
          } else if (start > itemStart && start < itemEnd) {
            result.push({ ...item, duration: start - itemStart });
          } else if (end > itemStart && end < itemEnd) {
            const cut = end - itemStart;
            result.push({
              ...item,
              startTime: end,
              duration: (item.duration || 0) - cut,
              trimStart: (item.trimStart || 0) + cut,
            });
          }
        } else {
          result.push(item);
        }
      }
      result.push(newItem);
      return result;
    };

    const isLibraryItem =
      active.data.current?.type === "shot" ||
      shots.some((s) => s.id === active.id);
    if (isLibraryItem) {
      if (targetIsAudio) return;
      const shotData =
        active.data.current?.shot || shots.find((s) => s.id === active.id);
      if (!shotData) return;
      const newItem: TimelineItem = {
        ...shotData,
        timelineId: crypto.randomUUID(),
        pairId: crypto.randomUUID(),
        duration: shotData.duration || 4,
        trackIndex: targetTrackIndex,
        maxDuration: shotData.duration || 4,
        startTime: newStartTime,
        volume: 1,
        muted: false,
      };
      recordHistory();
      setTracks((prev) => {
        let newTracks = [...prev];
        newTracks[targetTrackIndex] = applyOverwrite(
          newTracks[targetTrackIndex],
          newItem,
        );

        // Auto-pair Audio Track (V3 -> A3)
        const targetTrackName = trackSettings[targetTrackIndex]?.name || "V1";
        const match = targetTrackName.match(/V(\d+)/i);
        const trackNum = match ? match[1] : "1";
        const targetAudioName = `A${trackNum}`;

        let audioTrackIndex = trackSettings.findIndex(
          (t) =>
            (t.name || "").trim().toUpperCase() ===
            targetAudioName.toUpperCase(),
        );

        if (audioTrackIndex === -1) {
          newTracks = [...newTracks, []];
          audioTrackIndex = newTracks.length - 1;
          setTrackSettings((prevSettings) => [
            ...prevSettings,
            {
              locked: false,
              visible: true,
              name: targetAudioName,
              height: 64,
              type: "audio",
            },
          ]);
        }
        const audioItem: TimelineItem = {
          ...newItem,
          timelineId: crypto.randomUUID(),
          pairId: newItem.pairId,
          trackIndex: audioTrackIndex,
          previewBase64: undefined,
          name: `AUDIO: ${newItem.name}`,
        };
        newTracks[audioTrackIndex] = applyOverwrite(
          newTracks[audioTrackIndex],
          audioItem,
        );
        return newTracks;
      });
      return;
    }

    const activeContainer = findContainer(active.id as string, tracks);
    if (activeContainer) {
      const sourceTrackIndex = parseInt(
        activeContainer.replace("timeline-track-", ""),
      );
      const sourceIsAudio = trackIsAudio(sourceTrackIndex);
      if (sourceIsAudio !== targetIsAudio) return;
      recordHistory();
      setTracks((prev) => {
        const newTracks = [...prev];
        if (!newTracks[sourceTrackIndex]) return prev;
        const sourceTrack = [...newTracks[sourceTrackIndex]];
        const itemIndex = sourceTrack.findIndex(
          (i) => i.timelineId === active.id,
        );
        if (itemIndex === -1) return prev;
        const [movedItem] = sourceTrack.splice(itemIndex, 1);
        newTracks[sourceTrackIndex] = sourceTrack;
        movedItem.trackIndex = targetTrackIndex;
        movedItem.startTime = newStartTime;

        if (sourceIsAudio && movedItem.pairId) {
          let videoTrackIndex = -1;
          let videoItemIndex = -1;
          for (let ti = 0; ti < newTracks.length; ti++) {
            const trackName = (trackSettings?.[ti]?.name || "")
              .trim()
              .toUpperCase();
            if (trackName.startsWith("A")) continue;
            const idx = newTracks[ti].findIndex(
              (it: any) => it.pairId === movedItem.pairId,
            );
            if (idx !== -1) {
              videoTrackIndex = ti;
              videoItemIndex = idx;
              break;
            }
          }
          if (videoTrackIndex !== -1 && videoItemIndex !== -1) {
            const videoTrack = [...newTracks[videoTrackIndex]];
            const [videoItem] = videoTrack.splice(videoItemIndex, 1);
            newTracks[videoTrackIndex] = videoTrack;
            const movedVideoItem = {
              ...videoItem,
              startTime: newStartTime,
              trackIndex: videoTrackIndex,
            };
            newTracks[videoTrackIndex] = applyOverwrite(
              newTracks[videoTrackIndex],
              movedVideoItem,
            );
          }
        }
        if (movedItem.pairId) {
          const videoIndices = trackSettings
            .map((t, i) => ({ ...t, index: i }))
            .filter((t) => !(t.name || "").trim().toUpperCase().startsWith("A"))
            .map((t) => t.index);
          const audioIndices = trackSettings
            .map((t, i) => ({ ...t, index: i }))
            .filter((t) => (t.name || "").trim().toUpperCase().startsWith("A"))
            .map((t) => t.index);
          const targetVideoOrder = videoIndices.indexOf(targetTrackIndex);
          let targetAudioIndex = -1;
          if (targetVideoOrder !== -1 && audioIndices.length > 0) {
            const invertedOrder = videoIndices.length - 1 - targetVideoOrder;
            const safeOrder = Math.min(invertedOrder, audioIndices.length - 1);
            targetAudioIndex = audioIndices[safeOrder];
          }
          if (targetAudioIndex !== -1) {
            let sourceAudioTrackIndex = -1;
            let sourceAudioItemIndex = -1;
            for (const idx of audioIndices) {
              const trk = newTracks[idx];
              if (!trk) continue;
              const found = trk.findIndex(
                (it: any) => it.pairId === movedItem.pairId,
              );
              if (found !== -1) {
                sourceAudioTrackIndex = idx;
                sourceAudioItemIndex = found;
                break;
              }
            }
            if (sourceAudioTrackIndex !== -1) {
              const sourceTrack = [...newTracks[sourceAudioTrackIndex]];
              const [audioItem] = sourceTrack.splice(sourceAudioItemIndex, 1);
              newTracks[sourceAudioTrackIndex] = sourceTrack;
              const movedAudio = {
                ...audioItem,
                startTime: newStartTime,
                trackIndex: targetAudioIndex,
              };
              newTracks[targetAudioIndex] = applyOverwrite(
                newTracks[targetAudioIndex] || [],
                movedAudio,
              );
            }
          }
        }
        newTracks[targetTrackIndex] = applyOverwrite(
          newTracks[targetTrackIndex],
          movedItem,
        );
        return newTracks;
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
          setVideoSrc={() => {}}
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
                  isPlaying={isPlaying}
                  onTogglePlay={togglePlay}
                  primaryVideoRef={primaryVideoRef}
                  secondaryVideoRef={secondaryVideoRef}
                  canvasRef={canvasRef}
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
              <TimelinePanel
                tracks={tracks}
                onRemoveItem={(id: string) => {
                  recordHistory();
                  const target = tracks.flat().find((i) => i.timelineId === id);
                  const pairId = target?.pairId;
                  setTracks((prev) => {
                    if (!pairId) {
                      return prev.map((t) =>
                        t.filter((i) => i.timelineId !== id),
                      );
                    }
                    return prev.map((t) =>
                      t.filter((i) => i.pairId !== pairId),
                    );
                  });
                  if (isPlaying) {
                    togglePlay();
                  }
                }}
                onUpdateItem={handleUpdateItem}
                onAddVideoTrack={handleAddTrack}
                onAddAudioTrack={handleAddAudioTrack}
                isPlaying={isPlaying}
                togglePlay={togglePlay}
                onStop={() => {
                  if (isPlaying) togglePlay();
                }}
                currentTime={currentTime}
                duration={totalDuration}
                seekTo={seekTo}
                activeShotId={activeShotId ?? undefined}
                onShotClick={(id: string) => setActiveShotId(id)}
                shots={[]}
                zoom={zoom}
                setZoom={setZoom}
                onSplit={handleSplit}
                onUndo={undo}
                onRedo={redo}
                canUndo={history.length > 0}
                canRedo={redoStack.length > 0}
                trackSettings={trackSettings}
                onDeleteTrack={handleDeleteTrack}
                onRenameTrack={handleRenameTrack}
                onResizeTrack={handleResizeTrack}
                onToggleTrackLock={handleToggleTrackLock}
                onToggleTrackVisibility={handleToggleTrackVisibility}
                videoBlobs={videoBlobs}
                onVolumeChange={handleVolumeChange}
              />
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

      {/* EXPORT MODAL */}
      {showExportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#18181b] border border-zinc-800 rounded-lg shadow-2xl w-[450px] p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Export Timeline</h2>
              <button
                onClick={() => setShowExportModal(false)}
                disabled={isExporting}
                className="text-zinc-500 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {isExporting ? (
              <div className="flex flex-col gap-4 py-4">
                <div className="flex items-center gap-3 text-[#D2FF44]">
                  <Loader2 className="animate-spin" size={24} />
                  <span className="font-bold text-lg">Rendering...</span>
                </div>
                <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#D2FF44] transition-all duration-300"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
                <div className="text-xs font-mono text-zinc-400 truncate">
                  {exportStatus}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-zinc-500">
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
                      className="bg-zinc-900 border border-zinc-700 rounded p-2 text-sm text-white focus:border-[#D2FF44] outline-none"
                    >
                      <option value="mp4">MP4 (H.264)</option>
                      <option value="mov">MOV (ProRes-ish)</option>
                      <option value="mkv">MKV</option>
                      <option value="mp3">MP3 (Audio Only)</option>
                      <option value="wav">WAV (Audio Only)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-zinc-500">
                      Streams
                    </label>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={exportOptions.includeVideo}
                          onChange={(e) =>
                            setExportOptions({
                              ...exportOptions,
                              includeVideo: e.target.checked,
                            })
                          }
                          disabled={
                            exportOptions.format === "mp3" ||
                            exportOptions.format === "wav"
                          }
                        />
                        Video
                      </label>
                      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={exportOptions.includeAudio}
                          onChange={(e) =>
                            setExportOptions({
                              ...exportOptions,
                              includeAudio: e.target.checked,
                            })
                          }
                        />
                        Audio
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowExportModal(false)}
                disabled={isExporting}
                className="px-4 py-2 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="px-4 py-2 rounded bg-[#D2FF44] text-black font-bold hover:bg-[#b8e635] text-sm flex items-center gap-2"
              >
                Export
              </button>
            </div>
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
