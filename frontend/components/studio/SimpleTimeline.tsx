"use client";

import React, { useRef, useState, useEffect, useCallback, memo } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Plus,
  Lock,
  Eye,
  EyeOff,
  Trash2,
  Unlock,
  Scissors,
  MousePointer2,
  Undo2,
  Redo2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";

// --- CONSTANTS ---
const LEFT_PANEL_W = 160;
const LEFT_PANEL_BG = "bg-[#2c2f33]";
const LEFT_PANEL_BORDER = "border-r border-zinc-700";
const TRACK_HEIGHT = 48;
const SNAP_THRESHOLD_PX = 10;

// --- TYPES ---
export type ClipType = "video" | "audio" | "image" | "text" | "solid";

export interface TimelineClip {
  id: string;
  type: ClipType;
  name: string;
  src: string;
  start: number;
  duration: number;
  offset: number;
  color: string;
  sourceDuration?: number;
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: "video" | "audio" | "text";
  isMuted?: boolean;
  isHidden?: boolean;
  isLocked?: boolean;
  clips: TimelineClip[];
}

interface SimpleTimelineProps {
  tracks: TimelineTrack[];
  setTracks: React.Dispatch<React.SetStateAction<TimelineTrack[]>>;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  onUndo?: () => void;
  onRedo?: () => void;
  volume?: number;
  onVolumeChange?: (vol: number) => void;
}

// --- 1. THE RULER (Fixed: Optional Labels) ---
const TimelineRuler = memo(function TimelineRuler({
  zoom,
  scrollLeft,
  showLabels = true, // <--- NEW PROP
  showTicks = true,
}: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle High DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#71717a"; // zinc-500
    ctx.font = "9px monospace";
    ctx.textAlign = "left";

    // Calculate visible range
    const startSec = Math.max(0, Math.floor(scrollLeft / zoom));
    const endSec = Math.ceil((scrollLeft + rect.width) / zoom);

    for (let i = startSec; i <= endSec; i++) {
      const x = i * zoom - scrollLeft;

      // Major Tick (30s)
      if (i % 30 === 0) {
        ctx.fillRect(x, 0, 1, rect.height);
        if (showLabels) {
          const timeStr = new Date(i * 1000).toISOString().substr(14, 5);
          ctx.fillText(timeStr, x + 4, 12);
        }
      }
      // Medium Tick (15s)
      else if (showTicks && i % 15 === 0) {
        ctx.fillRect(x, 0, 1, 12);
      }
      // Minor Tick (1s)
      else if (showTicks) {
        ctx.fillRect(x, 0, 1, 6);
      }
    }
  }, [zoom, scrollLeft, showLabels, showTicks]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
});

// --- 2. PLAYHEAD ---
const Playhead = memo(function Playhead({
  time,
  zoom,
  showHandle = true,
}: {
  time: number;
  zoom: number;
  showHandle?: boolean;
}) {
  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-red-500 z-[60] pointer-events-none will-change-transform"
      style={{ left: time * zoom }}
    >
      {showHandle && (
        <div className="absolute -top-0 -left-1.5 w-3 h-3 bg-red-500 transform rotate-45" />
      )}
    </div>
  );
});

// --- 3. TRACK ROW ---
const TrackRow = memo(function TrackRow({
  track,
  trackIdx,
  zoom,
  onDragStart,
  toggleTrackProperty,
  deleteTrack,
  dragState,
  activeTool,
}: any) {
  const { setNodeRef, isOver } = useDroppable({
    id: `track-${trackIdx}`,
    data: { trackIndex: trackIdx },
  });

  return (
    <div
      className="flex relative shrink-0 group"
      style={{ height: TRACK_HEIGHT }}
    >
      {/* HEADER */}
      <div
        className={`shrink-0 flex flex-col px-2 justify-center sticky left-0 ${LEFT_PANEL_BG} ${LEFT_PANEL_BORDER} z-20`}
        style={{ width: LEFT_PANEL_W }}
      >
        <div className="flex justify-between items-center text-zinc-400">
          <span
            className="text-xs font-bold text-zinc-300 truncate flex-1 min-w-0 mr-2"
            title={track.name}
          >
            {track.name}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => toggleTrackProperty(trackIdx, "isMuted")}
              className={`p-1 hover:text-white ${track.isMuted ? "text-red-400" : "text-zinc-500"}`}
            >
              {track.isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
            <button
              onClick={() => toggleTrackProperty(trackIdx, "isHidden")}
              className={`p-1 hover:text-white ${track.isHidden ? "text-zinc-600" : "text-zinc-400"}`}
            >
              {track.isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button className="p-1 text-zinc-500 hover:text-white">
              {track.isLocked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
            <button
              onClick={() => deleteTrack(trackIdx)}
              className="p-1 text-zinc-600 hover:text-red-500 transition-colors"
              title="Delete Track"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* TIMELINE CONTENT */}
      <div
        ref={setNodeRef}
        className={`flex-1 relative min-w-[2000px] transition-colors ${isOver ? "bg-zinc-800/30" : ""}`}
      >
        {track.clips.map((clip: any) => (
          <div
            key={clip.id}
            className={`absolute top-0 bottom-0 border flex flex-col overflow-hidden cursor-pointer select-none
              ${track.type === "audio"
                ? "bg-[#1a1a1c] border-white/10"
                : "bg-[#375a6c] border-[#213845]"
              }
              ${track.isLocked ? "opacity-50 cursor-not-allowed" : "hover:brightness-110"}
              ${dragState?.clipId === clip.id ? "ring-2 ring-[#D2FF44] z-30 opacity-80" : "z-10"}
              ${activeTool === "split" ? "cursor-crosshair" : ""}
            `}
            style={{
              left: clip.start * zoom,
              width: Math.max(2, clip.duration * zoom),
              transition:
                dragState?.clipId === clip.id
                  ? "none"
                  : "left 0.1s, width 0.1s",
            }}
            onMouseDown={(e) => onDragStart(e, clip, trackIdx, "move")}
          >
            {track.type !== "audio" && (
              <div className="flex-1 relative overflow-hidden flex bg-zinc-800">
                <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent px-2 py-0.5 text-[9px] text-zinc-300 truncate font-mono pointer-events-none z-10">
                  {clip.name}
                </div>
              </div>
            )}
            {track.type === "audio" && (
              <div className="relative overflow-hidden shrink-0 flex items-center flex-1 bg-[#101012]">
                <div className="w-full h-px bg-[#D2FF44]/30" />
                <div className="absolute top-1 left-2 text-[9px] text-zinc-400 font-mono pointer-events-none">
                  {clip.name}
                </div>
              </div>
            )}
            {!track.isLocked && activeTool === "select" && (
              <>
                <div
                  className="absolute left-0 top-0 bottom-0 w-2 hover:bg-white/50 cursor-w-resize z-20"
                  onMouseDown={(e) =>
                    onDragStart(e, clip, trackIdx, "resize-left")
                  }
                />
                <div
                  className="absolute right-0 top-0 bottom-0 w-2 hover:bg-white/50 cursor-e-resize z-20"
                  onMouseDown={(e) =>
                    onDragStart(e, clip, trackIdx, "resize-right")
                  }
                />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

// --- MAIN COMPONENT ---
export default function SimpleTimeline({
  tracks,
  setTracks,
  currentTime,
  setCurrentTime,
  zoom,
  setZoom,
  isPlaying,
  setIsPlaying,
  onUndo,
  onRedo,
  volume = 1,
  onVolumeChange,
}: SimpleTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const horizontalScrollRef = useRef<HTMLDivElement>(null);
  const [activeTool, setActiveTool] = useState<"select" | "split">("select");
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Drag State
  const [dragState, setDragState] = useState<{
    type: "move" | "resize-left" | "resize-right";
    clipId: string;
    trackIndex: number;
    startX: number;
    originalStart: number;
    originalDuration: number;
    originalOffset: number;
  } | null>(null);

  // --- ACTIONS ---
  const handleZoom = useCallback(
    (delta: number) => {
      setZoom((prev) => Math.max(1, Math.min(200, prev + delta)));
    },
    [setZoom],
  );

  const addTrack = useCallback(() => {
    setTracks((prev) => {
      const nextNum = prev.length + 1;
      const newTrack: TimelineTrack = {
        id: crypto.randomUUID(),
        name: `Track ${nextNum}`,
        type: "video",
        clips: [],
        isHidden: false,
        isMuted: false,
        isLocked: false,
      };
      return [newTrack, ...prev];
    });
  }, [setTracks]);

  const deleteTrack = useCallback(
    (index: number) => {
      setTracks((prev) => prev.filter((_, i) => i !== index));
    },
    [setTracks],
  );

  const toggleTrackProperty = useCallback(
    (index: number, prop: "isMuted" | "isHidden") => {
      setTracks((prev) =>
        prev.map((t, i) => (i === index ? { ...t, [prop]: !t[prop] } : t)),
      );
    },
    [setTracks],
  );

  const togglePlay = useCallback(() => setIsPlaying((p) => !p), [setIsPlaying]);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      if (onVolumeChange) onVolumeChange(val);
    },
    [onVolumeChange],
  );

  const toggleMasterMute = useCallback(() => {
    if (onVolumeChange) {
      if (volume > 0) onVolumeChange(0);
      else onVolumeChange(1);
    }
  }, [onVolumeChange, volume]);

  // --- DRAG LOGIC ---
  const handleDragStart = useCallback(
    (
      e: React.MouseEvent,
      clip: TimelineClip,
      trackIndex: number,
      type: "move" | "resize-left" | "resize-right",
    ) => {
      e.stopPropagation();
      if (activeTool === "split") return;

      setDragState({
        type,
        clipId: clip.id,
        trackIndex,
        startX: e.clientX,
        originalStart: clip.start,
        originalDuration: clip.duration,
        originalOffset: clip.offset,
      });
    },
    [activeTool],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDraggingPlayhead) {
        if (!scrollContainerRef.current) return;
        const rect = scrollContainerRef.current.getBoundingClientRect();
        const x =
          e.clientX -
          rect.left -
          LEFT_PANEL_W +
          scrollContainerRef.current.scrollLeft;
        const newTime = Math.max(0, x / zoom);
        setCurrentTime(newTime);
        return;
      }

      if (!dragState) return;

      if (!scrollContainerRef.current) return;

      const deltaX = e.clientX - dragState.startX;
      const deltaSeconds = deltaX / zoom;

      const newTracks = [...tracks];
      let hasTrackChange = false;
      let nextDragState = { ...dragState };
      let hasDragStateChange = false;

      // --- 1. HANDLE VERTICAL TRACK CHANGE (MOVE ONLY) ---
      if (dragState.type === "move") {
        const rect = scrollContainerRef.current!.getBoundingClientRect();
        const relativeY = e.clientY - rect.top + scrollContainerRef.current!.scrollTop;
        const targetTrackIndex = Math.floor(relativeY / TRACK_HEIGHT);

        if (
          targetTrackIndex >= 0 &&
          targetTrackIndex < newTracks.length &&
          targetTrackIndex !== dragState.trackIndex
        ) {
          // SWAP TRACKS
          const originalTrack = newTracks[dragState.trackIndex];
          const targetTrack = newTracks[targetTrackIndex];

          const clipIndex = originalTrack.clips.findIndex(
            (c) => c.id === dragState.clipId
          );

          if (clipIndex !== -1) {
            const clip = { ...originalTrack.clips[clipIndex] };

            // 1. Remove from old
            newTracks[dragState.trackIndex] = {
              ...originalTrack,
              clips: originalTrack.clips.filter((c) => c.id !== dragState.clipId),
            };

            // 2. Add to new
            newTracks[targetTrackIndex] = {
              ...targetTrack,
              clips: [...targetTrack.clips, clip],
            };

            // 3. Update Drag State
            nextDragState.trackIndex = targetTrackIndex;
            hasDragStateChange = true;
            hasTrackChange = true;
          }
        }
      }

      // --- 2. HANDLE HORIZONTAL MOVE / RESIZE ---
      const currentTrackIdx = nextDragState.trackIndex;
      const track = newTracks[currentTrackIdx];
      const clipIndex = track.clips.findIndex((c) => c.id === dragState.clipId);

      if (clipIndex !== -1) {
        const clip = { ...track.clips[clipIndex] };

        if (dragState.type === "move") {
          let newStart = Math.max(0, dragState.originalStart + deltaSeconds);
          if (Math.abs(newStart - currentTime) < SNAP_THRESHOLD_PX / zoom) {
            newStart = currentTime;
          }

          if (clip.start !== newStart) {
            clip.start = newStart;
            newTracks[currentTrackIdx].clips[clipIndex] = clip;
            hasTrackChange = true;
          }
        } else if (dragState.type === "resize-right") {
          const maxDuration = (clip.sourceDuration || 86400) - clip.offset;
          const newDuration = Math.min(
            maxDuration,
            Math.max(0.1, dragState.originalDuration + deltaSeconds)
          );

          if (clip.duration !== newDuration) {
            clip.duration = newDuration;
            newTracks[currentTrackIdx].clips[clipIndex] = clip;
            hasTrackChange = true;
          }
        } else if (dragState.type === "resize-left") {
          let shift = deltaSeconds;
          if (dragState.originalOffset + shift < 0)
            shift = -dragState.originalOffset;
          if (dragState.originalDuration - shift < 0.1)
            shift = dragState.originalDuration - 0.1;

          const newStart = Math.max(0, dragState.originalStart + shift);
          const newDuration = dragState.originalDuration - shift;
          const newOffset = dragState.originalOffset + shift;

          if (clip.start !== newStart || clip.duration !== newDuration) {
            clip.start = newStart;
            clip.duration = newDuration;
            clip.offset = newOffset;
            newTracks[currentTrackIdx].clips[clipIndex] = clip;
            hasTrackChange = true;
          }
        }
      }

      if (hasTrackChange) {
        setTracks(newTracks);
      }
      if (hasDragStateChange) {
        setDragState(nextDragState);
      }
    },
    [
      dragState,
      isDraggingPlayhead,
      zoom,
      currentTime,
      setTracks,
      setCurrentTime,
      tracks,
    ],
  );

  const handleMouseUp = useCallback(() => {
    setDragState(null);
    setIsDraggingPlayhead(false);
  }, []);

  useEffect(() => {
    if (dragState || isDraggingPlayhead) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, isDraggingPlayhead, handleMouseMove, handleMouseUp]);

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsPlaying(false);
    const rect = scrollContainerRef.current.getBoundingClientRect();
    const x =
      e.clientX -
      rect.left -
      LEFT_PANEL_W +
      scrollContainerRef.current.scrollLeft;
    const newTime = Math.max(0, x / zoom);
    setCurrentTime(newTime);
    setIsDraggingPlayhead(true);
  };

  const totalDuration = Math.max(
    300,
    ...tracks.map((t) =>
      t.clips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0),
    ),
  );

  const contentDuration = Math.max(
    0,
    ...tracks.map((t) =>
      t.clips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0),
    ),
  );

  return (
    <div className="flex flex-col h-full bg-[#1e1e20] text-xs font-sans select-none overflow-hidden border-t border-black">
      {/* TOOLBAR */}
      <div className="h-10 border-b border-black/40 bg-[#262629] shrink-0 flex items-center justify-center relative z-20">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentTime(0)}
            className="text-zinc-400 hover:text-white"
          >
            <SkipBack size={16} />
          </button>
          <button
            onClick={togglePlay}
            className={`text-zinc-400 hover:text-white ${isPlaying ? "text-[#D2FF44]" : ""}`}
          >
            {isPlaying ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
          </button>
          <button
            onClick={() => setCurrentTime(contentDuration)}
            className="text-zinc-400 hover:text-white"
          >
            <SkipForward size={16} />
          </button>
        </div>

        <div className="absolute right-4 flex items-center gap-2">
          {/* VOLUME TOGGLE (Fixed) */}
          <button
            onClick={toggleMasterMute}
            className="text-zinc-400 hover:text-white"
          >
            {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={handleVolumeChange}
            className="w-20 h-1 accent-[#D2FF44] bg-zinc-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      <div className="h-10 border-b border-black/40 bg-[#262629] shrink-0 flex items-center px-4 justify-between z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={addTrack}
            className="flex items-center gap-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-300"
          >
            <Plus size={10} /> Add Track
          </button>
          <div className="w-px h-4 bg-zinc-700 mx-1" />
          <button
            onClick={() => setActiveTool("select")}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${activeTool === "select" ? "bg-[#D2FF44] text-black font-bold" : "bg-zinc-800 text-zinc-300"}`}
          >
            <MousePointer2 size={10} /> Select
          </button>
          <button
            onClick={() => setActiveTool("split")}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${activeTool === "split" ? "bg-[#D2FF44] text-black font-bold" : "bg-zinc-800 text-zinc-300"}`}
          >
            <Scissors size={10} /> Split
          </button>
          <div className="w-px h-4 bg-zinc-700 mx-1" />
          <button
            onClick={onUndo}
            className="text-zinc-400 hover:text-white p-1"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={onRedo}
            className="text-zinc-400 hover:text-white p-1"
          >
            <Redo2 size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1 border-l border-zinc-700 pl-4">
          <button
            onClick={() => handleZoom(-10)}
            className="text-zinc-400 hover:text-white"
          >
            -
          </button>
          <span className="text-[10px] text-zinc-500 w-8 text-center">
            {Math.round(zoom)}%
          </span>
          <button
            onClick={() => handleZoom(10)}
            className="text-zinc-400 hover:text-white"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
        {/* HEADER RULER (Show Labels) */}
        <div
          className="h-8 flex border-b border-zinc-700 bg-[#1a1a1c] z-20 shrink-0 cursor-pointer"
          onMouseDown={handleRulerMouseDown}
        >
          <div
            className={`shrink-0 ${LEFT_PANEL_BG} ${LEFT_PANEL_BORDER} flex items-center justify-center`}
            style={{ width: LEFT_PANEL_W }}
          >
            <span className="font-mono text-xs text-[#D2FF44]">
              {new Date(currentTime * 1000).toISOString().substr(14, 5)}
            </span>
          </div>
          <div className="flex-1 relative overflow-hidden bg-[#1a1a1c]">
            {/* Canvas Ruler (Fixed Position, draws based on scrollLeft) */}
            <TimelineRuler
              zoom={zoom}
              scrollLeft={scrollLeft}
              showLabels={true}
            />
            <div
              className="h-full w-full relative"
              style={{ transform: `translateX(-${scrollLeft}px)` }}
            >
              <Playhead time={currentTime} zoom={zoom} showHandle={true} />
            </div>
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden relative"
          onScroll={(e) => {
            setScrollLeft(e.currentTarget.scrollLeft);
            if (horizontalScrollRef.current) {
              horizontalScrollRef.current.scrollLeft =
                e.currentTarget.scrollLeft;
            }
          }}
          onWheel={(e) => {
            if (e.shiftKey && scrollContainerRef.current) {
              e.preventDefault();
              scrollContainerRef.current.scrollLeft += e.deltaY;
            }
          }}
          style={{
            background: `linear-gradient(to right, #2c2f33 ${LEFT_PANEL_W - 1}px, #3f3f46 ${LEFT_PANEL_W - 1}px, #3f3f46 ${LEFT_PANEL_W}px, #121214 ${LEFT_PANEL_W}px)`,
          }}
          onMouseDown={(e) => {
            if (e.target === scrollContainerRef.current)
              handleRulerMouseDown(e);
          }}
        >
          <div className="relative z-10 min-w-full">
            {tracks.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                trackIdx={i}
                zoom={zoom}
                onDragStart={handleDragStart}
                toggleTrackProperty={toggleTrackProperty}
                deleteTrack={deleteTrack}
                dragState={dragState}
                activeTool={activeTool}
              />
            ))}
            <div className="h-32 w-full" onClick={handleRulerMouseDown}></div>
          </div>
        </div>

        {/* CUSTOM SCROLLBAR */}
        <div className="h-3 bg-[#1a1a1c] border-t border-black flex shrink-0 z-30">
          <div
            className={`shrink-0 ${LEFT_PANEL_BG} ${LEFT_PANEL_BORDER}`}
            style={{ width: LEFT_PANEL_W }}
          />
          <div
            ref={horizontalScrollRef}
            className="flex-1 overflow-x-auto overflow-y-hidden"
            onScroll={(e) => {
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollLeft =
                  e.currentTarget.scrollLeft;
              }
              setScrollLeft(e.currentTarget.scrollLeft);
            }}
          >
            <div
              style={{ width: Math.max(2000, totalDuration * zoom), height: 1 }}
            />
          </div>
        </div>

        {/* GLOBAL PLAYHEAD OVERLAY (Body) */}
        <div
          className="absolute top-8 bottom-3 right-0 pointer-events-none z-[60] overflow-hidden"
          style={{ left: LEFT_PANEL_W }}
        >
          <div
            className="h-full relative will-change-transform"
            style={{ transform: `translateX(-${scrollLeft}px)` }}
          >
            <Playhead time={currentTime} zoom={zoom} showHandle={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
