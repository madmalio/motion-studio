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

  const initialized = useRef(false);
  const videoCache = useRef<Map<string, string>>(new Map());

  // Keep your existing behavior here
  const totalDuration = Math.max(
    60,
    ...tracks.map((t) => t.reduce((acc, s) => acc + (s.duration || 4), 0)),
  );

  // --- ENGINE STATE ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [streamUrl, setStreamUrl] = useState("");
  const [currentTime, setCurrentTime] = useState(0);

  // Simple timer to move playhead while engine plays
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= totalDuration) {
            setIsPlaying(false);
            setStreamUrl("");
            return 0;
          }
          return prev + 0.1;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, totalDuration]);

  const handleTogglePlay = async () => {
    if (isPlaying) {
      setIsPlaying(false);
      setStreamUrl("");
    } else {
      // Gather clips from Track 1 for the engine
      const clips = tracks[0]
        .map((shot) => shot.outputVideo)
        .filter((path) => !!path && path !== "");

      try {
        const rawUrl = await UpdateTimeline(clips);
        if (rawUrl.startsWith("error")) {
          alert("Engine Error: " + rawUrl);
          return;
        }
        const url = rawUrl.startsWith("http") ? rawUrl : "/video/" + rawUrl;
        setStreamUrl(url);
        setIsPlaying(true);
      } catch (e) {
        console.error("Engine failed:", e);
      }
    }
  };

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

    const activeId = active.id as string;
    const overId = over.id as string;
    const activeContainer = findContainer(activeId, tracks);
    const overContainer = findContainer(overId, tracks);

    if (!activeContainer || !overContainer || activeContainer === overContainer)
      return;

    setTracks((prev) => {
      const activeTrackIndex = parseInt(activeContainer.replace("track-", ""));
      const overTrackIndex = parseInt(overContainer.replace("track-", ""));
      const newTracks = [...prev];
      newTracks[activeTrackIndex] = [...newTracks[activeTrackIndex]];
      newTracks[overTrackIndex] = [...newTracks[overTrackIndex]];

      const activeItems = newTracks[activeTrackIndex];
      const overItems = newTracks[overTrackIndex];
      const activeIndex = activeItems.findIndex(
        (i) => i.timelineId === activeId,
      );
      const [movedItem] = activeItems.splice(activeIndex, 1);

      let overIndex;
      if (overId.toString().startsWith("track-")) {
        overIndex = overItems.length + 1;
      } else {
        const isBelowOverItem =
          over &&
          active.rect.current.translated &&
          active.rect.current.translated.top > over.rect.top + over.rect.height;
        const modifier = isBelowOverItem ? 1 : 0;
        overIndex =
          overItems.findIndex((i) => i.timelineId === overId) + modifier;
      }

      movedItem.trackIndex = overTrackIndex;
      overItems.splice(overIndex, 0, movedItem);
      return newTracks;
    });
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

    // ✅ Library -> Timeline: ALWAYS APPEND to end of target track
    const isLibraryItem =
      active.data.current?.type === "shot" ||
      shots.some((s) => s.id === active.id);
    if (isLibraryItem) {
      const targetTrackIndex = parseInt(
        dropContainer.replace("timeline-track-", ""),
      );

      const shotData =
        active.data.current?.shot || shots.find((s) => s.id === active.id);
      if (!shotData) return;

      const newItem: TimelineItem = {
        ...shotData,
        timelineId: crypto.randomUUID(),
        duration: shotData.duration || 4,
        trackIndex: targetTrackIndex,
      };

      setTracks((prev) => {
        const newTracks = [...prev];
        newTracks[targetTrackIndex] = [...newTracks[targetTrackIndex], newItem]; // ✅ append
        return newTracks;
      });

      return;
    }

    // Timeline reorder (same-track)
    const activeContainer = findContainer(active.id as string, tracks);
    const overContainer = findContainer(overId, tracks);

    if (activeContainer && overContainer && activeContainer === overContainer) {
      const trackIndex = parseInt(activeContainer.replace("track-", ""));
      const activeIndex = tracks[trackIndex].findIndex(
        (i) => i.timelineId === active.id,
      );
      const overIndex = tracks[trackIndex].findIndex(
        (i) => i.timelineId === overId,
      );

      if (activeIndex !== overIndex) {
        setTracks((prev) => {
          const newTracks = [...prev];
          newTracks[trackIndex] = arrayMove(
            newTracks[trackIndex],
            activeIndex,
            overIndex,
          );
          return newTracks;
        });
      }
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
                streamUrl={streamUrl}
                isPlaying={isPlaying}
                onTogglePlay={handleTogglePlay}
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
                if (isPlaying) handleTogglePlay();
              }}
              onAddTrack={() => setTracks((prev) => [...prev, []])}
              isPlaying={isPlaying}
              togglePlay={handleTogglePlay}
              currentTime={currentTime}
              duration={totalDuration}
              seekTo={setCurrentTime}
              activeShotId={activeShotId ?? undefined}
              onShotClick={(id: string) => setActiveShotId(id)}
              shots={[]}
            />
          </div>
        </div>
      </div>

      <DragOverlay
        dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: "0.5" } },
          }),
        }}
      >
        {activeDragItem ? (
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
