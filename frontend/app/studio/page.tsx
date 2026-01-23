"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useRef } from "react";
import { useConfirm } from "../../components/ConfirmProvider";
import { Loader2 } from "lucide-react";

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
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useGaplessPlayback } from "../../hooks/useGaplessPlayback";

// --- COMPONENTS ---
import GeneratorPanel from "../../components/studio/GeneratorPanel";
import LibraryPanel from "../../components/studio/LibraryPanel";
import ViewerPanel from "../../components/studio/ViewerPanel";
import TimelinePanel from "../../components/studio/TimelinePanel";

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
} from "../../wailsjs/go/main/App";

// --- TYPES ---
interface Shot {
  id: string;
  sceneId: string;
  name: string;
  sourceImage: string;
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
  trackIndex?: number;
  startTime: number;
  maxDuration?: number;
  trimStart?: number;
}

// --- HELPERS ---
const findContainer = (id: string, tracks: TimelineItem[][]) => {
  // ✅ ONLY timeline tracks count
  if (id.toString().startsWith("timeline-track-")) return id;

  // ✅ OR an existing timeline clip (timelineId) inside a track
  for (let i = 0; i < tracks.length; i++) {
    const item = tracks[i].find((s) => s.timelineId === id);
    if (item) return `timeline-track-${i}`;
  }

  return undefined;
};

// ✅ NEW: allow drop only if over target is a real timeline track or existing timeline item
const isTimelineDropTarget = (overId: string, tracks: TimelineItem[][]) => {
  if (overId.startsWith("track-")) return true;
  return tracks.some((t) => t.some((item) => item.timelineId === overId));
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
  const [isRendering, setIsRendering] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Timeline & Playback State
  const [tracks, setTracks] = useState<TimelineItem[][]>([[]]);
  const [trackSettings, setTrackSettings] = useState<
    { locked: boolean; visible: boolean; name: string; height?: number }[]
  >([{ locked: false, visible: true, name: "Track 1", height: 96 }]);
  const [activeDragItem, setActiveDragItem] = useState<any>(null);
  const [zoom, setZoom] = useState(10); // px/second

  // --- LAYOUT STATE ---
  const [generatorWidth, setGeneratorWidth] = useState(320);
  const [libraryWidth, setLibraryWidth] = useState(320);
  const [timelineHeight, setTimelineHeight] = useState(300);

  const isResizingGen = useRef(false);
  const isResizingLib = useRef(false);
  const isResizingTime = useRef(false);
  const generatorWidthRef = useRef(generatorWidth);

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
  const [history, setHistory] = useState<
    {
      tracks: TimelineItem[][];
      shots: Shot[];
      trackSettings: {
        locked: boolean;
        visible: boolean;
        name: string;
        height?: number;
      }[];
    }[]
  >([]);
  const [redoStack, setRedoStack] = useState<
    {
      tracks: TimelineItem[][];
      shots: Shot[];
      trackSettings: {
        locked: boolean;
        visible: boolean;
        name: string;
        height?: number;
      }[];
    }[]
  >([]);

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

  // Keep your existing behavior here
  const totalDuration = Math.max(
    0,
    ...tracks.map((t) =>
      t.reduce((acc, s) => Math.max(acc, s.startTime + (s.duration || 4)), 0),
    ),
  );

  // --- ENGINE STATE ---
  const {
    primaryVideoRef,
    secondaryVideoRef,
    canvasRef,
    isPlaying,
    togglePlay,
    currentTime,
    seekTo,
  } = useGaplessPlayback({
    tracks,
    trackSettings,
    totalDuration,
    videoBlobs,
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
  }, [history, redoStack, tracks, shots]);

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

      // 1. Hydrate Shots
      if (savedShots && savedShots.length > 0) {
        const hydratedShots = await Promise.all(
          savedShots.map(async (shot: any) => {
            if (shot.sourceImage) {
              const b64 = await ReadImageBase64(shot.sourceImage);
              return { ...shot, previewBase64: b64 };
            }
            return shot;
          }),
        );

        setShots(hydratedShots);
        setActiveShotId(hydratedShots[0].id);
      }

      // 2. Load Timeline
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
          if (timelineData.trackSettings) {
            setTrackSettings(timelineData.trackSettings);
          }

          // 3. Pre-load Video Clips (Fix Black Flashes)
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
                const blob = await res.blob();
                blobMap.set(path, URL.createObjectURL(blob));
              } catch (e) {
                console.error("Failed to preload clip:", path, e);
              }
            }),
          );
          setVideoBlobs(blobMap);
        } else {
          setTracks([[]]);
          setTrackSettings([
            { locked: false, visible: true, name: "Track 1", height: 96 },
          ]);
        }
      } catch (e) {
        setTracks([[]]);
        setTrackSettings([
          { locked: false, visible: true, name: "Track 1", height: 96 },
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
    setShots((prev) => {
      const newShot: Shot = {
        id: crypto.randomUUID(),
        sceneId: sceneId,
        name: `Shot ${prev.length + 1}`,
        sourceImage: "",
        prompt: "",
        motionStrength: 127,
        seed: Math.floor(Math.random() * 1000000),
        duration: 4,
        status: "DRAFT",
        outputVideo: "",
      };
      setActiveShotId((current) => current || newShot.id);
      return [...prev, newShot];
    });
  };

  const handleExtendShot = async (originalShot: Shot) => {
    const sourcePath = originalShot.outputVideo || originalShot.sourceImage;
    if (!sourcePath) return alert("Select source first");
    const lastFramePath = await ExtractLastFrame(sourcePath);
    if (!lastFramePath) return;
    const b64 = await ReadImageBase64(lastFramePath);
    recordHistory();
    setShots((prev) => {
      const newShot: Shot = {
        ...originalShot,
        id: crypto.randomUUID(),
        name: `${originalShot.name} (Ext)`,
        sourceImage: lastFramePath,
        previewBase64: b64,
        status: "DRAFT",
        outputVideo: "",
      };
      setActiveShotId(newShot.id);
      return [...prev, newShot];
    });
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
    setShots((prev) =>
      prev.map((s) => (s.id === activeShotId ? { ...s, ...updates } : s)),
    );
    // Update Timeline Tracks to reflect changes (like duration)
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

      // Find the specific item by timelineId
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

      // Perform Split
      if (targetTrackIndex !== -1 && targetItemIndex !== -1) {
        const track = newTracks[targetTrackIndex];
        const item = track[targetItemIndex];

        // Validate split time (must be within clip with buffer)
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
  const handleAddTrack = () => {
    recordHistory();
    setTracks((prev) => [...prev, []]);
    setTrackSettings((prev) => [
      ...prev,
      {
        locked: false,
        visible: true,
        name: `Track ${prev.length + 1}`,
        height: 96,
      },
    ]);
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
    setTrackSettings((prev) =>
      prev.map((s, i) => (i === index ? { ...s, visible: !s.visible } : s)),
    );
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
      // Fallback: find in library shots
      const shot = shots.find((s) => s.id === event.active.id);
      if (shot) {
        setActiveDragItem(shot);
        return;
      }
      // Fallback: find in timeline tracks
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

    // Removed list sorting logic since we now use absolute positioning
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragItem(null);
    if (!over) return;

    const dropContainer = findContainer(over.id as string, tracks);
    if (!dropContainer) return; // ✅ only timeline accepts drop

    const overId = over.id as string;

    // ✅ Only allow dropping on the timeline (track background or timeline clip)
    const overType = over.data.current?.type;
    if (overType !== "track" && overType !== "timeline-item") return;

    // --- CALCULATE DROP TIME & SNAPPING ---
    const targetTrackIndex = parseInt(
      dropContainer.replace("timeline-track-", ""),
    );
    const activeRect = active.rect.current.translated;
    const overRect = over.rect;

    let newStartTime = 0;
    if (activeRect && overRect) {
      // Calculate X relative to the track container
      const relativeX = activeRect.left - overRect.left;
      const rawTime = Math.max(0, relativeX / zoom);

      newStartTime = rawTime;

      if (!isCtrlPressed.current) {
        // Snapping Logic
        const SNAP_THRESHOLD_PX = 15;
        const snapThreshold = SNAP_THRESHOLD_PX / zoom;

        // Determine active item duration for end-snapping
        let activeDuration = 4;
        let foundItem: any;

        // Check tracks first (moving existing item)
        for (const t of tracks) {
          const i = t.find((it) => it.timelineId === active.id);
          if (i) {
            foundItem = i;
            break;
          }
        }
        // Check shots if not found (dragging from library)
        if (!foundItem) {
          foundItem = shots.find((s) => s.id === active.id);
        }

        if (foundItem) {
          activeDuration = foundItem.duration || 4;
        }

        let minDiff = snapThreshold;

        // Snap to 0
        if (Math.abs(rawTime - 0) < minDiff) {
          newStartTime = 0;
          minDiff = Math.abs(rawTime - 0);
        }

        // Snap to Playhead (Start)
        if (Math.abs(rawTime - currentTime) < minDiff) {
          newStartTime = currentTime;
          minDiff = Math.abs(rawTime - currentTime);
        }

        // Snap to Playhead (End)
        if (Math.abs(rawTime + activeDuration - currentTime) < minDiff) {
          newStartTime = Math.max(0, currentTime - activeDuration);
          minDiff = Math.abs(rawTime + activeDuration - currentTime);
        }

        // Snap to other clips on ALL tracks
        tracks.forEach((track) => {
          track.forEach((item) => {
            if (item.timelineId === active.id) return; // Don't snap to self

            const itemStart = item.startTime;
            const itemEnd = item.startTime + (item.duration || 4);

            // 1. Snap My Start to Their Start
            const diffStartStart = Math.abs(rawTime - itemStart);
            if (diffStartStart < minDiff) {
              newStartTime = itemStart;
              minDiff = diffStartStart;
            }

            // 2. Snap My Start to Their End
            const diffStartEnd = Math.abs(rawTime - itemEnd);
            if (diffStartEnd < minDiff) {
              newStartTime = itemEnd;
              minDiff = diffStartEnd;
            }

            // 3. Snap My End to Their Start
            const myEnd = rawTime + activeDuration;
            const diffEndStart = Math.abs(myEnd - itemStart);
            if (diffEndStart < minDiff) {
              newStartTime = Math.max(0, itemStart - activeDuration);
              minDiff = diffEndStart;
            }

            // 4. Snap My End to Their End
            const diffEndEnd = Math.abs(myEnd - itemEnd);
            if (diffEndEnd < minDiff) {
              newStartTime = Math.max(0, itemEnd - activeDuration);
              minDiff = diffEndEnd;
            }
          });
        });
      }
    }

    // Helper: Apply Overwrite Logic (Dominate Clip)
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

        // Check overlap
        if (start < itemEnd && end > itemStart) {
          // 1. Enveloped (New covers Old completely)
          if (start <= itemStart && end >= itemEnd) {
            continue; // Delete old
          }
          // 2. Split (New is inside Old)
          else if (start > itemStart && end < itemEnd) {
            result.push({ ...item, duration: start - itemStart });
            result.push({
              ...item,
              timelineId: crypto.randomUUID(),
              startTime: end,
              duration: itemEnd - end,
              trimStart: (item.trimStart || 0) + (end - itemStart),
            });
          }
          // 3. Overlap Tail (New covers end of Old)
          else if (start > itemStart && start < itemEnd) {
            result.push({ ...item, duration: start - itemStart });
          }
          // 4. Overlap Head (New covers start of Old)
          else if (end > itemStart && end < itemEnd) {
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

    // ✅ Library -> Timeline: ALWAYS APPEND to end of target track
    const isLibraryItem =
      active.data.current?.type === "shot" ||
      shots.some((s) => s.id === active.id);
    if (isLibraryItem) {
      const shotData =
        active.data.current?.shot || shots.find((s) => s.id === active.id);
      if (!shotData) return;

      const newItem: TimelineItem = {
        ...shotData,
        timelineId: crypto.randomUUID(),
        duration: shotData.duration || 4,
        trackIndex: targetTrackIndex,
        maxDuration: shotData.duration || 4, // Set limit to original duration
        startTime: newStartTime, // Use calculated time
      };

      recordHistory();
      setTracks((prev) => {
        const newTracks = [...prev];
        newTracks[targetTrackIndex] = applyOverwrite(
          newTracks[targetTrackIndex],
          newItem,
        );
        return newTracks;
      });

      return;
    }

    // Timeline Move (Same or Different Track)
    const activeContainer = findContainer(active.id as string, tracks);

    if (activeContainer) {
      const sourceTrackIndex = parseInt(
        activeContainer.replace("timeline-track-", ""),
      );

      recordHistory();
      setTracks((prev) => {
        const newTracks = [...prev];
        // Remove from source
        if (!newTracks[sourceTrackIndex]) return prev;
        const sourceTrack = [...newTracks[sourceTrackIndex]];
        const itemIndex = sourceTrack.findIndex(
          (i) => i.timelineId === active.id,
        );
        if (itemIndex === -1) return prev;

        const [movedItem] = sourceTrack.splice(itemIndex, 1);
        newTracks[sourceTrackIndex] = sourceTrack;

        // Add to target with new time
        movedItem.trackIndex = targetTrackIndex;
        movedItem.startTime = newStartTime;

        // Ensure target track array exists (it should)
        newTracks[targetTrackIndex] = applyOverwrite(
          newTracks[targetTrackIndex],
          movedItem,
        );

        return newTracks;
      });
    }
  };

  if (isLoading || !project || !scene)
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#09090b] text-[#D2FF44] gap-2">
        <Loader2 className="animate-spin" /> Loading Studio...
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
        {/* HEADER */}
        <header className="h-10 w-full border-b border-zinc-800 bg-[#09090b] flex items-center justify-between px-4 shrink-0">
          <h1 className="text-sm font-bold text-white flex items-center gap-2">
            {scene.name} <span className="text-zinc-600">/</span>{" "}
            <span className="text-zinc-500 font-normal">{project.name}</span>
          </h1>
        </header>

        {/* WORKSPACE */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* GENERATOR */}
            <div
              style={{ width: generatorWidth }}
              className="border-r border-zinc-800 bg-[#09090b] flex flex-col min-h-0 shrink-0"
            >
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

            {/* RESIZE HANDLE GEN */}
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

            {/* LIBRARY */}
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

            {/* RESIZE HANDLE LIB */}
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

            {/* VIEWER */}
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

          {/* RESIZE HANDLE TIMELINE */}
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

          {/* TIMELINE */}
          <div
            style={{ height: timelineHeight }}
            className="border-t border-zinc-800 bg-[#1e1e20] shrink-0"
          >
            <TimelinePanel
              tracks={tracks}
              onRemoveItem={(id: string) => {
                recordHistory();
                setTracks((prev) =>
                  prev.map((t) => t.filter((i) => i.timelineId !== id)),
                );
                if (isPlaying) togglePlay();
              }}
              onUpdateItem={handleUpdateItem}
              onAddTrack={handleAddTrack}
              isPlaying={isPlaying}
              togglePlay={togglePlay}
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
            />
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
                height: "96px", // Match track height (h-24)
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
    </DndContext>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={<div className="p-10 text-[#D2FF44]">Loading...</div>}>
      <StudioContent />
    </Suspense>
  );
}
