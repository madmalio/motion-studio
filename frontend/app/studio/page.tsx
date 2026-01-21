"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useRef } from "react";
import { useConfirm } from "../../components/ConfirmProvider";
import { Loader2 } from "lucide-react";

// DND Kit
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  useSensor,
  useSensors,
  PointerSensor,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";

// Panels
import GeneratorPanel from "../../components/studio/GeneratorPanel";
import LibraryPanel from "../../components/studio/LibraryPanel";
import ViewerPanel from "../../components/studio/ViewerPanel";
import TimelinePanel from "../../components/studio/TimelinePanel";
import { useGaplessPlayback } from "../../hooks/useGaplessPlayback";

// WAILS IMPORTS
import {
  GetProject,
  GetScenes,
  ReadImageBase64,
  ExtractLastFrame,
  SaveShots,
  GetShots,
  DeleteShot,
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

// Timeline Item Wrapper
interface TimelineItem extends Shot {
  timelineId: string;
  trackIndex?: number;
}

function StudioContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") || "";
  const sceneId = searchParams.get("sceneId") || "";
  const { confirm } = useConfirm();

  const [project, setProject] = useState<Project | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [showGhost, setShowGhost] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  const videoCache = useRef<Map<string, string>>(new Map());

  // Timeline State: Array of Arrays (Tracks)
  const [tracks, setTracks] = useState<TimelineItem[][]>([[]]);
  const [activeDragItem, setActiveDragItem] = useState<any>(null);
  const initialized = useRef(false);

  // --- SMART PLAYBACK HOOK ---
  const {
    primaryVideoRef,
    secondaryVideoRef,
    activePlayer,
    isPlaying,
    togglePlay,
    currentTime,
    seekTo,
    duration,
  } = useGaplessPlayback({
    tracks,
    totalDuration: Math.max(
      60,
      ...tracks.map((track) =>
        track.reduce((acc, shot) => acc + (shot.duration || 4), 0),
      ),
    ),
  });

  // 1. AUTO-SAVE
  useEffect(() => {
    if (projectId && sceneId && initialized.current && shots.length > 0) {
      const cleanShots = shots.map(({ previewBase64, ...keep }) => keep);
      SaveShots(projectId, sceneId, cleanShots as any);
    }
  }, [shots, projectId, sceneId]);

  // 2. LOAD DATA
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
        // Load THUMBNAILS only (Base64 is fine for small images, BAD for video)
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

  const activeShotIndex = shots.findIndex((s) => s.id === activeShotId);
  const activeShot = shots[activeShotIndex];
  const prevShot = shots[activeShotIndex - 1];

  // --- ACTIONS ---

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
    setShowGhost(true);
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
  };

  // --- DND HANDLERS ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragItem(event.active.data.current);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragItem(null);
    if (!over) return;

    const activeType = active.data.current?.type;
    const overId = over.id as string;

    // Find Target Track Index
    let targetTrackIndex = -1;

    // Check if dropped directly on a track container
    if (overId.toString().startsWith("track-")) {
      targetTrackIndex = parseInt(overId.toString().replace("track-", ""));
    }
    // Check if dropped on an item inside a track
    else if (over.data.current?.trackIndex !== undefined) {
      targetTrackIndex = over.data.current.trackIndex;
    }

    if (targetTrackIndex === -1) return;

    // A) NEW CLIP FROM LIBRARY
    if (activeType === "shot") {
      const shotData = active.data.current?.shot;
      if (shotData) {
        setTracks((prev) => {
          const newTracks = [...prev];
          if (!newTracks[targetTrackIndex]) newTracks[targetTrackIndex] = [];

          const newItem = {
            ...shotData,
            timelineId: crypto.randomUUID(),
            duration: shotData.duration || 4,
            trackIndex: targetTrackIndex,
          };

          // Find insertion index if dropped on an item
          const overTimelineId = over.data.current?.timelineId;
          const insertIndex = newTracks[targetTrackIndex].findIndex(
            (i) => i.timelineId === overTimelineId,
          );

          if (insertIndex !== -1) {
            newTracks[targetTrackIndex].splice(insertIndex, 0, newItem);
          } else {
            newTracks[targetTrackIndex].push(newItem);
          }
          return newTracks;
        });
      }
    }
    // B) MOVING EXISTING ITEM
    else if (activeType === "timeline-item") {
      const activeId = active.id;
      const sourceTrackIndex = active.data.current?.trackIndex;

      if (sourceTrackIndex === undefined) return;

      setTracks((prev) => {
        const newTracks = [...prev];
        // Remove from source
        const sourceItemIndex = newTracks[sourceTrackIndex].findIndex(
          (i) => i.timelineId === activeId,
        );
        if (sourceItemIndex === -1) return prev;

        const [item] = newTracks[sourceTrackIndex].splice(sourceItemIndex, 1);
        item.trackIndex = targetTrackIndex; // Update internal track ref

        // Add to target
        if (!newTracks[targetTrackIndex]) newTracks[targetTrackIndex] = [];

        const overTimelineId = over.data.current?.timelineId;
        const insertIndex = newTracks[targetTrackIndex].findIndex(
          (i) => i.timelineId === overTimelineId,
        );

        if (insertIndex !== -1) {
          newTracks[targetTrackIndex].splice(insertIndex, 0, item);
        } else {
          newTracks[targetTrackIndex].push(item);
        }

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
      onDragStart={handleDragStart}
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
                setVideoCache={(id, b64) => videoCache.current.set(id, b64)}
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
                primaryVideoRef={primaryVideoRef}
                secondaryVideoRef={secondaryVideoRef}
                activePlayer={activePlayer}
                activeShot={activeShot}
                showGhost={showGhost}
                setShowGhost={setShowGhost}
                prevShot={prevShot}
              />
            </div>
          </div>

          {/* TIMELINE */}
          <div className="h-[300px] border-t border-zinc-800 bg-[#1e1e20] shrink-0">
            <TimelinePanel
              tracks={tracks}
              shots={shots}
              onRemoveItem={(id) => {
                setTracks((prev) =>
                  prev.map((t) => t.filter((i) => i.timelineId !== id)),
                );
              }}
              onAddTrack={() => setTracks((prev) => [...prev, []])}
              isPlaying={isPlaying}
              togglePlay={togglePlay}
              currentTime={currentTime}
              duration={duration}
              seekTo={seekTo}
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
        {activeDragItem?.type === "shot" ? (
          <div className="w-48 aspect-video rounded-lg overflow-hidden border-2 border-[#D2FF44] shadow-xl">
            <img
              src={activeDragItem.shot.previewBase64}
              className="w-full h-full object-cover"
            />
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
