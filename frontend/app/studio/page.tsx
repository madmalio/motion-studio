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
  UpdateTimeline,
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

  // Timeline & Playback State
  const [tracks, setTracks] = useState<TimelineItem[][]>([[]]);
  const [activeDragItem, setActiveDragItem] = useState<any>(null);
  const [zoom, setZoom] = useState(10); // px/second

  const initialized = useRef(false);
  const videoCache = useRef<Map<string, string>>(new Map());

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
    isPlaying,
    togglePlay,
    currentTime,
    seekTo,
  } = useGaplessPlayback({
    tracks,
    totalDuration,
  });

  // --- AUTO-SAVE ---
  useEffect(() => {
    if (projectId && sceneId && initialized.current && shots.length > 0) {
      const cleanShots = shots.map(({ previewBase64, ...keep }) => keep);
      SaveShots(projectId, sceneId, cleanShots as any);
    }
  }, [shots, projectId, sceneId]);

  // --- LOAD DATA ---
  useEffect(() => {
    if (projectId && sceneId) loadData(projectId, sceneId);
  }, [projectId, sceneId]);

  const loadData = async (pId: string, sId: string) => {
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
              return { ...shot, previewBase64: b64 };
            }
            return shot;
          }),
        );

        setShots(hydratedShots);
        setActiveShotId(hydratedShots[0].id);
        initialized.current = true;

        // ✅ CHANGE: START WITH A BLANK TIMELINE (no auto-populate)
        setTracks([[]]);
      } else {
        if (!initialized.current) {
          initialized.current = true;
          handleAddShot();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // --- SHOT LOGIC ---
  const activeShotIndex = shots.findIndex((s) => s.id === activeShotId);
  const activeShot = shots[activeShotIndex];

  const handleAddShot = () => {
    if (!sceneId) return;
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
    setTracks((prev) =>
      prev.map((track) =>
        track.map((item) =>
          item.timelineId === id ? { ...item, ...updates } : item,
        ),
      ),
    );
  };

  const handleSplit = () => {
    setTracks((prev) => {
      const newTracks = [...prev];
      let targetTrackIndex = -1;
      let targetItemIndex = -1;

      // Helper: Check if playhead is inside a clip (with safety buffer)
      const isInside = (item: TimelineItem) =>
        currentTime > item.startTime + 0.05 &&
        currentTime < item.startTime + (item.duration || 0) - 0.05;

      // 1. Priority: Try to find a clip under playhead that matches the currently selected Shot ID
      if (activeShotId) {
        for (let t = 0; t < newTracks.length; t++) {
          const idx = newTracks[t].findIndex(
            (item) => item.id === activeShotId && isInside(item),
          );
          if (idx !== -1) {
            targetTrackIndex = t;
            targetItemIndex = idx;
            break;
          }
        }
      }

      // 2. Fallback: If no selection match, find ANY clip under the playhead (Top-most track first)
      if (targetTrackIndex === -1) {
        for (let t = newTracks.length - 1; t >= 0; t--) {
          const idx = newTracks[t].findIndex((item) => isInside(item));
          if (idx !== -1) {
            targetTrackIndex = t;
            targetItemIndex = idx;
            break;
          }
        }
      }

      // Perform Split
      if (targetTrackIndex !== -1 && targetItemIndex !== -1) {
        const track = newTracks[targetTrackIndex];
        const item = track[targetItemIndex];
        const splitOffset = currentTime - item.startTime;

        const leftItem = { ...item, duration: splitOffset };
        const rightItem: TimelineItem = {
          ...item,
          timelineId: crypto.randomUUID(),
          startTime: currentTime,
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

      // Snapping Logic
      const SNAP_THRESHOLD_PX = 15;
      const snapThreshold = SNAP_THRESHOLD_PX / zoom;

      newStartTime = rawTime;
      let minDiff = snapThreshold;

      // Snap to 0
      if (Math.abs(rawTime - 0) < minDiff) {
        newStartTime = 0;
        minDiff = Math.abs(rawTime - 0);
      }

      // Snap to other clips on the same track
      tracks[targetTrackIndex].forEach((item) => {
        if (item.timelineId === active.id) return; // Don't snap to self

        // Snap to Start
        const diffStart = Math.abs(rawTime - item.startTime);
        if (diffStart < minDiff) {
          newStartTime = item.startTime;
          minDiff = diffStart;
        }

        // Snap to End
        const itemEnd = item.startTime + (item.duration || 4);
        const diffEnd = Math.abs(rawTime - itemEnd);
        if (diffEnd < minDiff) {
          newStartTime = itemEnd;
          minDiff = diffEnd;
        }

        // Optional: Snap my End to their Start/End? (requires active duration)
      });
    }

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

      setTracks((prev) => {
        const newTracks = [...prev];
        newTracks[targetTrackIndex] = [...newTracks[targetTrackIndex], newItem]; // ✅ append
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
        newTracks[targetTrackIndex] = [
          ...newTracks[targetTrackIndex],
          movedItem,
        ];

        return newTracks;
      });
    }
  };

  if (!project || !scene)
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
            <div className="w-80 border-r border-zinc-800 bg-[#09090b] flex flex-col min-h-0">
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

            {/* LIBRARY */}
            <div className="w-80 border-r border-zinc-800 bg-[#09090b] flex flex-col min-h-0">
              <LibraryPanel
                shots={shots}
                activeShotId={activeShotId}
                setActiveShotId={setActiveShotId}
                handleAddShot={handleAddShot}
                handleExtendShot={handleExtendShot}
                handleDeleteShot={handleDeleteShot}
              />
            </div>

            {/* VIEWER */}
            <div className="flex-1 min-w-0 bg-black min-h-0">
              <ViewerPanel
                isPlaying={isPlaying}
                onTogglePlay={togglePlay}
                primaryVideoRef={primaryVideoRef}
                secondaryVideoRef={secondaryVideoRef}
              />
            </div>
          </div>

          {/* TIMELINE */}
          <div className="h-[300px] border-t border-zinc-800 bg-[#1e1e20] shrink-0">
            <TimelinePanel
              tracks={tracks}
              onRemoveItem={(id: string) => {
                setTracks((prev) =>
                  prev.map((t) => t.filter((i) => i.timelineId !== id)),
                );
                if (isPlaying) togglePlay();
              }}
              onUpdateItem={handleUpdateItem}
              onAddTrack={() => setTracks((prev) => [...prev, []])}
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
