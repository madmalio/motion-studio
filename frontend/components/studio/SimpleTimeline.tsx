"use client";

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  memo,
  useMemo,
} from "react";
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
  Magnet,
  MoreVertical,
  Maximize2,
  Video,
  AudioLines,
} from "lucide-react";
import { useDroppable, useDndContext, pointerWithin } from "@dnd-kit/core";

// --- CONSTANTS ---
export const LEFT_PANEL_W = 160;
export const LEFT_PANEL_BG = "bg-[#2c2f33]";
export const LEFT_PANEL_BORDER = "border-r border-zinc-700";
export const VIDEO_TRACK_H = 64;
export const AUDIO_TRACK_H = 32;
export const SNAP_THRESHOLD_PX = 10;

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
  thumbnail?: string;
  isMuted?: boolean;
  waveform?: number[];
  volume?: number; // <--- NEW PROP
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: "video" | "audio" | "text";
  isMuted?: boolean;
  isHidden?: boolean;
  isLocked?: boolean;
  clips: TimelineClip[];
  volume?: number; // <--- NEW PROP
}

interface SimpleTimelineProps {
  tracks: TimelineTrack[];
  setTracks: React.Dispatch<React.SetStateAction<TimelineTrack[]>>;
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  onUndo?: () => void;
  onRedo?: () => void;
  volume?: number;
  onVolumeChange?: (vol: number) => void;
  onTrackVolumeChange?: (trackIdx: number, vol: number) => void; // <--- NEW PROP
  selectedClipId?: string | null;
  onSelectClip?: (clipId: string | null) => void;
  onDeleteClip?: (clipId: string) => void;
  onExtendClip?: (trackIndex: number, clipId: string) => void;
  onRegisterHistory?: () => void;
  fps?: number;
}

// --- 1. THE RULER (Fixed: Optional Labels) ---
const TimelineRuler = memo(function TimelineRuler({
  zoom,
  scrollLeft,
  showLabels = true,
  showTicks = true,
}: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle High DPI - Only resize if necessary
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#71717a"; // zinc-500
    ctx.font = "9px monospace";
    ctx.textAlign = "left";

    // Calculate visible range
    const startSec = Math.max(0, Math.floor(scrollLeft / zoom));
    const endSec = Math.ceil((scrollLeft + width) / zoom);

    ctx.beginPath(); // Batch drawing
    for (let i = startSec; i <= endSec; i++) {
      const x = i * zoom - scrollLeft;

      // Major Tick (30s)
      if (i % 30 === 0) {
        ctx.fillRect(x, 0, 1, 14); 
        if (showLabels) {
          const adjusted = i + 3600;
          const h = Math.floor(adjusted / 3600);
          const m = Math.floor((adjusted % 3600) / 60);
          const s = Math.floor(adjusted % 60);
          const timeStr = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
          ctx.fillText(timeStr, x + 4, height - 4);
        }
      }
      // Medium Tick (15s)
      else if (showTicks && i % 15 === 0) {
        ctx.fillRect(x, 0, 1, 8);
      }
      // Minor Tick (1s)
      else if (showTicks) {
        ctx.fillRect(x, 0, 1, 4);
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
        <div className="absolute top-0 -left-1.5">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            className="fill-red-500"
          >
            <path d="M0 0 H12 V6 L6 12 L0 6 Z" />
          </svg>
        </div>
      )}
    </div>
  );
});

const AudioClipWaveform = memo(function AudioClipWaveform({
  peaks,
  widthPx,
  isMuted,
}: {
  peaks?: number[];
  widthPx: number;
  isMuted?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(rect.width));
    const pixelHeight = Math.max(1, Math.floor(rect.height));
    const targetW = Math.max(1, Math.floor(pixelWidth * dpr));
    const targetH = Math.max(1, Math.floor(pixelHeight * dpr));

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);

    const lineColor = isMuted ? "rgba(0, 0, 0, 0.28)" : "rgba(0, 0, 0, 0.14)";
    ctx.fillStyle = lineColor;
    ctx.fillRect(0, (pixelHeight - 1) / 2, pixelWidth, 1);

    if (!peaks || peaks.length === 0 || widthPx < 8) return;

    const bars = Math.min(320, Math.max(16, Math.floor(widthPx / 3)));
    const samplesPerBar = peaks.length / bars;
    const barStep = pixelWidth / bars;
    const barW = Math.max(1, barStep - 1);
    const barColor = isMuted ? "rgba(0, 0, 0, 0.42)" : "rgba(0, 0, 0, 0.72)";

    ctx.fillStyle = barColor;
    for (let i = 0; i < bars; i++) {
      const start = Math.floor(i * samplesPerBar);
      const end = Math.min(peaks.length, Math.floor((i + 1) * samplesPerBar));
      let maxPeak = 0;
      for (let j = start; j < end; j++) {
        const value = Math.abs(peaks[j] ?? 0);
        if (value > maxPeak) maxPeak = value;
      }
      const amp = Math.max(0, Math.min(1, maxPeak));
      const h = Math.max(2, Math.round(amp * (pixelHeight - 2)));
      const x = i * barStep;
      const y = (pixelHeight - h) / 2;
      ctx.fillRect(x, y, barW, h);
    }
  }, [peaks, widthPx, isMuted]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
});

// --- 3. TRACK ROW ---
const TrackRow = memo(
  function TrackRow({
    track,
    trackIdx,
    zoom,
    onDragStart,
    toggleTrackProperty,
    deleteTrack,
    dragState,
    activeTool,
    selectedClipId,
    onSelectClip,
    onDeleteClip,
    onTrackContextMenu, // Renamed from onContextMenu
    onClipContextMenu, // New
    onToggleClipMute,
    onSplitClip, // <--- NEW PROP
    splitHover, // <--- NEW PROP
    onSplitHover, // <--- NEW PROP
    zIndex, // <--- NEW PROP
    dragMouseX, // <--- NEW PROP
    ghostClip, // <--- NEW PROP (Optimization: Pass data instead of context)
    onTrackVolumeChange, // <--- NEW PROP
  }: any) {
    const { setNodeRef, isOver, node } = useDroppable({
      id: `track-${trackIdx}`,
      data: { trackIndex: trackIdx },
    });

    const currentHeight = track.type === "audio" ? AUDIO_TRACK_H : VIDEO_TRACK_H;

    // --- LIBRARY DRAG GHOST ---
    const [ghostStartTime, setGhostStartTime] = useState<number | null>(null);
    const ghostDuration = ghostClip?.duration || 4;

    const isCompatible = useMemo(() => {
      if (!ghostClip) return true;
      // Library assets: audio assets have audioPath and NO outputVideo.
      const isLibraryAudio = !!ghostClip.audioPath && !ghostClip.outputVideo;
      if (isLibraryAudio) return track.type === "audio";
      return track.type !== "audio";
    }, [ghostClip, track.type]);

    useEffect(() => {
      if (!ghostClip || !isOver || !isCompatible) {
        setGhostStartTime(null);
        return;
      }

      const updateGhost = (e: MouseEvent) => {
        if (!node.current) return;
        const rect = node.current.getBoundingClientRect();
        const dragCenterOnTrack = e.clientX - rect.left;

        // Center: start = center - (duration / 2)
        let startTime = Math.max(
          0,
          dragCenterOnTrack / zoom - ghostDuration / 2,
        );

        // --- GHOST SNAPPING ---
        const snapThreshold = 10 / zoom; // 10px snap
        let bestSnapDelta = Infinity;
        let snapTarget = null;

        const candidates = [0];
        track.clips.forEach((c: any) => {
          candidates.push(c.start);
          candidates.push(c.start + c.duration);
        });

        // Snap START
        candidates.forEach((pt) => {
          const delta = pt - startTime;
          if (
            Math.abs(delta) < snapThreshold &&
            Math.abs(delta) < Math.abs(bestSnapDelta)
          ) {
            bestSnapDelta = delta;
            snapTarget = pt;
          }
        });

        // Snap END
        const endTime = startTime + ghostDuration;
        candidates.forEach((pt) => {
          const delta = pt - endTime;
          if (
            Math.abs(delta) < snapThreshold &&
            Math.abs(delta) < Math.abs(bestSnapDelta)
          ) {
            bestSnapDelta = delta;
            snapTarget = pt - ghostDuration;
          }
        });

        if (snapTarget !== null) {
          startTime = snapTarget;
        }

        const quantizedStart = Math.round(startTime * 30) / 30;
        setGhostStartTime(quantizedStart);
      };

      window.addEventListener("mousemove", updateGhost);
      return () => window.removeEventListener("mousemove", updateGhost);
    }, [ghostClip, isOver, isCompatible, zoom, node, dragMouseX, ghostDuration, track.clips]);

    return (
      <div
        className="flex relative shrink-0 group"
        style={{ height: currentHeight, zIndex }}
      >
        {/* HEADER */}
        <div
          className={`shrink-0 flex flex-col px-2 justify-center sticky left-0 ${LEFT_PANEL_BG} ${LEFT_PANEL_BORDER} border-b border-zinc-800 z-20 hover:bg-zinc-700/50 transition-colors cursor-context-menu`}
          style={{ width: LEFT_PANEL_W }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (onTrackContextMenu) onTrackContextMenu(e, trackIdx);
          }}
        >
          <div className="flex justify-between items-center text-zinc-400">
            <span
              className="text-xs font-bold text-zinc-300 truncate flex-1 min-w-0 mr-2"
              title={track.name}
            >
              {track.name}
            </span>

            <div className="flex items-center gap-1 shrink-0">
              {/* Status Icons (Tiny) */}
              <div className="flex gap-0.5 mr-1">
                {track.isMuted && (
                  <VolumeX size={10} className="text-red-400" />
                )}
                {track.isHidden && (
                  <EyeOff size={10} className="text-zinc-500" />
                )}
                {track.isLocked && <Lock size={10} className="text-zinc-500" />}
              </div>

              {/* KEBAB MENU */}
              <button
                className="p-1 hover:text-white hover:bg-zinc-700/80 rounded"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onTrackContextMenu) onTrackContextMenu(e, trackIdx);
                }}
              >
                <MoreVertical size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* TIMELINE CONTENT */}
        <div
          ref={setNodeRef}
          className={`flex-1 relative min-w-[2000px] transition-colors ${isOver && isCompatible ? "bg-zinc-800/30" : ""} ${activeTool === "split" ? "cursor-crosshair" : ""}`}
          onClick={(e) => {
            if (activeTool === "split" && onSplitClip) {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              onSplitClip(trackIdx, x, zoom);
            } else if (onSelectClip) {
              onSelectClip(null);
            }
          }}
          onMouseMove={(e) => {
            if (activeTool === "split" && onSplitHover) {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              onSplitHover(trackIdx, x);
            }
          }}
          onMouseLeave={() => {
            if (activeTool === "split" && onSplitHover) onSplitHover(null);
          }}
        >
          {/* LIBRARY DRAG GHOST */}
          {ghostStartTime !== null && (
            <div
              className="absolute top-1 bottom-1 border-2 border-dashed border-[#D2FF44]/50 bg-[#D2FF44]/10 rounded-sm pointer-events-none z-40"
              style={{
                left: ghostStartTime * zoom,
                width: ghostDuration * zoom,
              }}
            />
          )}

          {/* SPLIT LINE INDICATOR */}
          {activeTool === "split" &&
            splitHover?.trackIndex === trackIdx &&
            (() => {
              // Check if hovering over a clip
              const hoverTime = splitHover.x / zoom;
              const hoveringClip = track.clips.find(
                (c: any) =>
                  hoverTime >= c.start && hoverTime <= c.start + c.duration,
              );

              if (hoveringClip) {
                return (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-red-500 z-50 pointer-events-none"
                    style={{ left: splitHover.x }}
                  />
                );
              }
              return null;
            })()}

          {track.clips.map((clip: any) => {
            const isSelected = selectedClipId === clip.id;
            const isBeingMoved =
              dragState?.clipId === clip.id && dragState.type === "move";

            return (
              <div
                key={clip.id}
                className={`absolute top-0 bottom-0 border flex flex-col overflow-hidden cursor-pointer select-none group/clip rounded-sm
                ${
                  track.type === "audio"
                    ? "bg-[#D2FF44] border-black/10"
                    : "bg-[#375a6c] border-[#213845]"
                }
                ${track.isLocked ? "opacity-50 cursor-not-allowed" : "hover:brightness-110"}
                ${dragState?.clipId === clip.id ? "ring-2 ring-[#D2FF44] z-30 opacity-80" : "z-10"}
                ${isBeingMoved ? "opacity-30 border-dashed border-[#D2FF44]/50 grayscale" : ""}
                ${isSelected ? "ring-2 ring-white z-20" : ""} 
                ${activeTool === "split" ? "cursor-crosshair" : ""}
                ${clip.isMuted ? "grayscale opacity-75" : ""}
              `}
                style={{
                  left: clip.start * zoom,
                  width: Math.max(2, clip.duration * zoom),
                }}
                onMouseDown={(e) => {
                  e.stopPropagation(); // Prevent deselect
                  if (activeTool === "split") {
                    if (onSplitClip) {
                      const rect =
                        e.currentTarget.parentElement?.getBoundingClientRect();
                      if (rect) {
                        const x = e.clientX - rect.left;
                        onSplitClip(trackIdx, x, zoom);
                      }
                    }
                    return;
                  }
                  if (onSelectClip) onSelectClip(clip.id);
                  onDragStart(e, clip, trackIdx, "move");
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onClipContextMenu) {
                    onClipContextMenu(e, trackIdx, clip.id);
                  }
                }}
              >
                {track.type !== "audio" && (
                  <div className="flex-1 relative overflow-hidden flex bg-zinc-800">
                    {/* THUMBNAIL */}
                    {clip.thumbnail && (
                      <img
                        src={clip.thumbnail}
                        className="w-full h-full object-cover opacity-70 pointer-events-none"
                        draggable={false}
                      />
                    )}
                    <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent px-2 py-0.5 text-[9px] text-zinc-300 truncate font-mono pointer-events-none z-10">
                      {clip.name}
                    </div>

                    {/* KEBAB MENU (Top Right - visible on hover or if muted) */}
                    <div className="absolute top-1 right-1 z-40 opacity-0 group-hover/clip:opacity-100 transition-opacity">
                      <button
                        className={`p-1 hover:bg-zinc-600/80 rounded text-white ${clip.isMuted ? "bg-red-500/20 text-red-400 opacity-100" : "bg-black/50"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onClipContextMenu)
                            onClipContextMenu(e, trackIdx, clip.id);
                        }}
                      >
                        <MoreVertical size={10} />
                      </button>
                    </div>
                  </div>
                )}
                {track.type === "audio" && (
                  <div className="relative overflow-hidden shrink-0 flex items-center flex-1 bg-transparent px-2 py-1">
                    <AudioClipWaveform
                      peaks={clip.waveform}
                      widthPx={Math.max(2, clip.duration * zoom)}
                      isMuted={clip.isMuted}
                    />
                    {/* KEBAB MENU (Audio - Right side) */}
                    <div className="absolute top-1 right-1 z-40 opacity-0 group-hover/clip:opacity-100 transition-opacity">
                      <button
                        className={`p-1 hover:bg-black/10 rounded text-black ${clip.isMuted ? "opacity-50" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onClipContextMenu)
                            onClipContextMenu(e, trackIdx, clip.id);
                        }}
                      >
                        <MoreVertical size={10} />
                      </button>
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
            );
          })}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    if (prevProps.zoom !== nextProps.zoom) return false;
    if (prevProps.zIndex !== nextProps.zIndex) return false;
    if (prevProps.activeTool !== nextProps.activeTool) return false;
    if (prevProps.track !== nextProps.track) return false;
    if (prevProps.selectedClipId !== nextProps.selectedClipId) return false;
    if (prevProps.dragState !== nextProps.dragState) return false;
    if (prevProps.ghostClip !== nextProps.ghostClip) return false;

    if (prevProps.splitHover !== nextProps.splitHover) {
      if (
        prevProps.splitHover?.trackIndex === prevProps.trackIdx ||
        nextProps.splitHover?.trackIndex === nextProps.trackIdx
      ) {
        return false;
      }
    }

    return true;
  },
);

// --- TRACK ADD DROPDOWN ---
function TrackAddDropdown({
  addTrack,
}: {
  addTrack: (type: "video" | "audio") => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-300"
      >
        <Plus size={10} /> Add Track
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-[101] bg-[#2c2f33] border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[140px]">
          <button
            className="w-full text-left px-3 py-2 hover:bg-zinc-700 text-zinc-300 flex items-center gap-2 text-xs"
            onClick={() => {
              addTrack("video");
              setIsOpen(false);
            }}
          >
            <Video size={12} /> Video Track
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-zinc-700 text-zinc-300 flex items-center gap-2 text-xs"
            onClick={() => {
              addTrack("audio");
              setIsOpen(false);
            }}
          >
            <AudioLines size={12} /> Audio Track
          </button>
        </div>
      )}
    </div>
  );
}

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
  onTrackVolumeChange, // <--- NEW PROP
  selectedClipId,
  onSelectClip,
  onDeleteClip, // <--- NEW PROP
  onExtendClip, // <--- NEW PROP
  onRegisterHistory,
  fps = 30,
}: SimpleTimelineProps) {
  // Helper: Grid Snap (1/fps)
  const quantizeTime = useCallback(
    (time: number) => {
      const frameDuration = 1 / fps;
      return Math.round(time / frameDuration) * frameDuration;
    },
    [fps],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const horizontalScrollRef = useRef<HTMLDivElement>(null);
  const proxyRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastStateUpdateRef = useRef<number>(0);
  const dragMouseX = useRef<number>(0);
  const dragMouseY = useRef<number>(0);
  const clipVolumeCommitTimerRef = useRef<number | null>(null);
  const pendingClipVolumeRef = useRef<{
    clipId: string;
    trackIndex: number;
    vol: number;
  } | null>(null);

  // Helper: Format Time (HH:MM:SS:FF) matching TimelinePanel
  const formatTime = (seconds: number) => {
    // Standard NLE offset: 01:00:00:00
    const adjusted = seconds + 3600;

    const h = Math.floor(adjusted / 3600);
    const m = Math.floor((adjusted % 3600) / 60);
    const s = Math.floor(adjusted % 60);
    const f = Math.floor((adjusted % 1) * 30);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
  };

  const [activeTool, setActiveTool] = useState<"select" | "split">("select");
  const [isSnappingEnabled, setIsSnappingEnabled] = useState(true);

  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Split Hover State
  const [splitHover, setSplitHover] = useState<{
    trackIndex: number;
    x: number;
  } | null>(null);

  const { active } = useDndContext();
  const ghostClip = active?.data.current?.shot; // Extract shot data for ghosting

  const handleSplitHover = useCallback(
    (trackIndex: number | null, x?: number) => {
      if (trackIndex === null || x === undefined) {
        setSplitHover(null);
      } else {
        setSplitHover({ trackIndex, x });
      }
    },
    [],
  );

  // --- KEYBOARD SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (onRedo) onRedo();
        } else {
          if (onUndo) onUndo();
        }
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          setCurrentTime((prev) => Math.max(0, prev - 1 / (fps || 30)));
          break;
        case "ArrowRight":
          e.preventDefault();
          setCurrentTime((prev) => prev + 1 / (fps || 30));
          break;
        case "a":
        case "A":
          setActiveTool("select");
          break;
        case "b":
        case "B":
          setActiveTool("split");
          break;
        case "n":
        case "N":
          setIsSnappingEnabled((prev) => !prev);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onUndo, onRedo]);

  // Keep track if we were playing before dragging the playhead
  const wasPlayingRef = useRef(false);

  // Drag State
  const [dragState, setDragState] = useState<{
    type: "move" | "resize-left" | "resize-right";
    clipId: string;
    trackIndex: number;
    startX: number;
    originalStart: number;
    originalDuration: number;
    originalOffset: number;
    snapPoints: number[]; // Optimization: Cache snap points
    clickOffsetX: number;
    clickOffsetY: number;
  } | null>(null);

  // --- STABILIZATION: LOCAL TRACKS ENGINE ---
  // To prevent Next.js from re-rendering the entire page 60 FPS during drags
  const [localTracks, setLocalTracks] = useState(tracks);
  const localTracksRef = useRef(tracks);
  const tracksRef = useRef(tracks);

  useEffect(() => {
    tracksRef.current = tracks;
    if (!dragState) {
      setLocalTracks(tracks);
      localTracksRef.current = tracks;
    }
  }, [tracks, dragState]);

  // Derived Drag Proxy State
  const activeClipForProxy = useMemo(() => {
    if (!dragState || dragState.type !== "move") return null;
    const track = localTracksRef.current[dragState.trackIndex];
    if (!track) return null;
    const clip = track.clips.find((c) => c.id === dragState.clipId);
    if (!clip) return null;
    return { clip, trackType: track.type };
  }, [dragState]);

  // --- ACTIONS ---
  const handleZoom = useCallback(
    (delta: number) => {
      setZoom((prev: number) => Math.max(11, Math.min(200, prev + delta)));
    },
    [setZoom],
  );

  const addTrack = useCallback(
    (trackType: "video" | "audio" = "video") => {
      if (onRegisterHistory) onRegisterHistory();
      setTracks((prev) => {
        const videoTracks = prev.filter((t) => t.type === "video");
        const audioTracks = prev.filter((t) => t.type === "audio");
        const nextNum =
          trackType === "video"
            ? videoTracks.length + 1
            : audioTracks.length + 1;
        const newTrack: TimelineTrack = {
          id: crypto.randomUUID(),
          name: trackType === "video" ? `Video ${nextNum}` : `Audio ${nextNum}`,
          type: trackType,
          clips: [],
          isHidden: false,
          isMuted: false,
          isLocked: false,
        };
        if (trackType === "video") {
          return [newTrack, ...prev];
        }
        const videoPart = prev.filter((t) => t.type === "video");
        const audioPart = prev.filter((t) => t.type === "audio");
        return [...videoPart, ...audioPart, newTrack];
      });
    },
    [setTracks, onRegisterHistory],
  );

  const deleteTrack = useCallback(
    (index: number) => {
      if (onRegisterHistory) onRegisterHistory();
      setTracks((prev) => prev.filter((_, i) => i !== index));
    },
    [setTracks, onRegisterHistory],
  );

  const toggleTrackProperty = useCallback(
    (index: number, prop: "isMuted" | "isHidden" | "isLocked") => {
      if (onRegisterHistory) onRegisterHistory();
      setTracks((prev) =>
        prev.map((t, i) => (i === index ? { ...t, [prop]: !t[prop] } : t)),
      );
    },
    [setTracks, onRegisterHistory],
  );

  const handleTrackVolumeChangeInternal = useCallback(
    (index: number, vol: number) => {
      // Local update for performance
      setLocalTracks((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], volume: vol };
        localTracksRef.current = next;
        return next;
      });

      // Global update
      if (onTrackVolumeChange) onTrackVolumeChange(index, vol);
      setTracks((prev) =>
        prev.map((t, i) => (i === index ? { ...t, volume: vol } : t)),
      );
    },
    [onTrackVolumeChange, setTracks],
  );

  const updateClipVolumeInTracks = useCallback(
    (
      prev: TimelineTrack[],
      clipId: string,
      trackIndex: number,
      vol: number,
    ): TimelineTrack[] => {
      if (trackIndex < 0 || trackIndex >= prev.length) return prev;

      const next = [...prev];
      const track = next[trackIndex];
      if (!track) return prev;

      const clipIdx = track.clips.findIndex((c) => c.id === clipId);
      if (clipIdx === -1) return prev;

      const currentClip = track.clips[clipIdx];
      if (currentClip.volume === vol) return prev;

      const nextTrack = { ...track, clips: [...track.clips] };
      nextTrack.clips[clipIdx] = { ...currentClip, volume: vol };
      next[trackIndex] = nextTrack;
      return next;
    },
    [],
  );

  const flushPendingClipVolume = useCallback(() => {
    if (clipVolumeCommitTimerRef.current) {
      window.clearTimeout(clipVolumeCommitTimerRef.current);
      clipVolumeCommitTimerRef.current = null;
    }

    const pending = pendingClipVolumeRef.current;
    if (!pending) return;

    pendingClipVolumeRef.current = null;
    setTracks((prev) =>
      updateClipVolumeInTracks(
        prev,
        pending.clipId,
        pending.trackIndex,
        pending.vol,
      ),
    );
  }, [setTracks, updateClipVolumeInTracks]);

  const toggleClipMute = useCallback(
    (clipId: string, trackIndex: number) => {
      if (onRegisterHistory) onRegisterHistory();
      setTracks((prev) => {
        const newTracks = [...prev];
        const track = { ...newTracks[trackIndex] };
        const clipIdx = track.clips.findIndex((c) => c.id === clipId);
        if (clipIdx !== -1) {
          const clip = { ...track.clips[clipIdx] };
          clip.isMuted = !clip.isMuted;
          track.clips = [...track.clips];
          track.clips[clipIdx] = clip;
          newTracks[trackIndex] = track;
        }
        return newTracks;
      });
    },
    [setTracks, onRegisterHistory],
  );

  const setClipVolume = useCallback(
    (clipId: string, trackIndex: number, vol: number) => {
      const clamped = Math.max(0, Math.min(2, vol));

      setLocalTracks((prev) => {
        const next = updateClipVolumeInTracks(prev, clipId, trackIndex, clamped);
        localTracksRef.current = next;
        return next;
      });

      pendingClipVolumeRef.current = { clipId, trackIndex, vol: clamped };

      if (clipVolumeCommitTimerRef.current) {
        window.clearTimeout(clipVolumeCommitTimerRef.current);
      }

      clipVolumeCommitTimerRef.current = window.setTimeout(() => {
        const pending = pendingClipVolumeRef.current;
        if (!pending) return;

        pendingClipVolumeRef.current = null;
        clipVolumeCommitTimerRef.current = null;
        setTracks((prev) =>
          updateClipVolumeInTracks(
            prev,
            pending.clipId,
            pending.trackIndex,
            pending.vol,
          ),
        );
      }, 120);
    },
    [setTracks, updateClipVolumeInTracks],
  );

  useEffect(() => {
    return () => {
      flushPendingClipVolume();
    };
  }, [flushPendingClipVolume]);

  const handleSplitClip = useCallback(
    (trackIndex: number, x: number, zoom: number) => {
      if (onRegisterHistory) onRegisterHistory();
      const rawSplitTime = x / zoom;
      const splitTime = quantizeTime(rawSplitTime);

      setTracks((prev) => {
        const newTracks = [...prev];
        const track = { ...newTracks[trackIndex] };

        // Find clip at splitTime
        const clipIdx = track.clips.findIndex(
          (c) => splitTime >= c.start && splitTime < c.start + c.duration,
        );

        if (clipIdx === -1) return prev;

        const originalClip = track.clips[clipIdx];

        // Don't split if too close to edges (e.g. < 0.1s)
        const offsetInClip = splitTime - originalClip.start;
        if (offsetInClip < 0.1 || originalClip.duration - offsetInClip < 0.1) {
          return prev;
        }

        // LEFT CLIP
        const leftClip = {
          ...originalClip,
          duration: offsetInClip,
        };

        // RIGHT CLIP
        const rightClip: TimelineClip = {
          ...originalClip,
          id: crypto.randomUUID(),
          start: splitTime,
          duration: originalClip.duration - offsetInClip,
          offset: originalClip.offset + offsetInClip,
        };

        // Insert new clips
        const newClips = [...track.clips];
        newClips.splice(clipIdx, 1, leftClip, rightClip);

        track.clips = newClips;
        newTracks[trackIndex] = track;
        return newTracks;
      });
    },
    [setTracks, onRegisterHistory],
  );

  // --- MENU STATE ---
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "track" | "clip";
    trackIndex: number;
    clipId?: string;
  } | null>(null);

  const handleTrackContextMenu = useCallback(
    (e: React.MouseEvent, trackIndex: number) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, type: "track", trackIndex });
    },
    [],
  );

  const handleClipContextMenu = useCallback(
    (e: React.MouseEvent, trackIndex: number, clipId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        type: "clip",
        trackIndex,
        clipId,
      });
    },
    [],
  );

  // Close context menu on global click
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

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
      if (tracksRef.current[trackIndex].isLocked) return;

      if (onRegisterHistory) onRegisterHistory();

      // Pre-calculate snap points (Optimization)
      const snapPoints = [0]; // Always snap to 0
      tracksRef.current.forEach((t) => {
        t.clips.forEach((c) => {
          if (c.id === clip.id) return; // Skip self
          snapPoints.push(c.start);
          snapPoints.push(c.start + c.duration);
        });
      });

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      setDragState({
        type,
        clipId: clip.id,
        trackIndex,
        startX: e.clientX,
        originalStart: clip.start,
        originalDuration: clip.duration,
        originalOffset: clip.offset,
        snapPoints,
        clickOffsetX: offsetX,
        clickOffsetY: offsetY,
      });
    },
    [activeTool, onRegisterHistory],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      dragMouseX.current = e.clientX;
      dragMouseY.current = e.clientY;

      if (isDraggingPlayhead) {
        if (!scrollContainerRef.current) return;
        const rect = scrollContainerRef.current.getBoundingClientRect();
        const x =
          e.clientX -
          // Use e.clientX directly for playhead as it's synchronous/fast
          rect.left -
          LEFT_PANEL_W +
          scrollContainerRef.current.scrollLeft;
        const newTime = Math.max(0, x / zoom);
        setCurrentTime(newTime);
        return;
      }

      if (!dragState) return;

      if (rafRef.current) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        // --- CALC CURRENT DRAG PROXY HEIGHT ---
        const currentTracks = localTracksRef.current;
        const draggingTrack = currentTracks[dragState.trackIndex];
        const draggingTrackH = draggingTrack?.type === "audio" ? AUDIO_TRACK_H : VIDEO_TRACK_H;

        // UPDATE PROXY (Smooth Cursor Tracking - Centered)
        if (
          proxyRef.current &&
          dragState.type === "move" &&
          activeClipForProxy
        ) {
          const proxyX =
            dragMouseX.current - (activeClipForProxy.clip.duration * zoom) / 2;
          const proxyY = dragMouseY.current - draggingTrackH / 2;
          proxyRef.current.style.transform = `translate(${proxyX}px, ${proxyY}px)`;
          proxyRef.current.style.display = "block";
        } else if (proxyRef.current) {
          proxyRef.current.style.display = "none";
        }

        if (!scrollContainerRef.current) return;

        const deltaX = dragMouseX.current - dragState.startX;
        const deltaSeconds = deltaX / zoom;

        // STABILIZATION: Read from ref
        const newTracks = [...currentTracks];

        let hasTrackChange = false;
        let nextDragState = { ...dragState };
        let hasDragStateChange = false;

        // --- 1. HANDLE VERTICAL TRACK CHANGE (MOVE ONLY) ---
        if (dragState.type === "move") {
          const rect = scrollContainerRef.current!.getBoundingClientRect();
          const relativeY =
            dragMouseY.current -
            rect.top +
            scrollContainerRef.current!.scrollTop;
          
          // --- ACCUMULATED HEIGHT RESOLUTION ---
          let targetTrackIndex = -1;
          let accumulatedHeight = 0;
          for (let i = 0; i < currentTracks.length; i++) {
            const h = currentTracks[i].type === "audio" ? AUDIO_TRACK_H : VIDEO_TRACK_H;
            if (relativeY >= accumulatedHeight && relativeY < accumulatedHeight + h) {
              targetTrackIndex = i;
              break;
            }
            accumulatedHeight += h;
          }

          if (
            targetTrackIndex >= 0 &&
            targetTrackIndex < newTracks.length &&
            targetTrackIndex !== dragState.trackIndex
          ) {
            // SWAP TRACKS
            const originalTrack = newTracks[dragState.trackIndex];
            const targetTrack = newTracks[targetTrackIndex];

            const clipIndex = originalTrack.clips.findIndex(
              (c) => c.id === dragState.clipId,
            );

            if (clipIndex !== -1) {
              const clip = { ...originalTrack.clips[clipIndex] };

              // --- COMPATIBILITY CHECK ---
              const isAudioClip = clip.type === "audio";
              const isTargetAudioTrack = targetTrack.type === "audio";
              if (isAudioClip !== isTargetAudioTrack) return;

              // 1. Remove from old
              newTracks[dragState.trackIndex] = {
                ...originalTrack,
                clips: originalTrack.clips.filter(
                  (c) => c.id !== dragState.clipId,
                ),
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
        // MUST SHALLOW CLONE TO BREAK REACT MEMOIZATION:
        const track = { ...newTracks[currentTrackIdx] };
        track.clips = [...track.clips];
        newTracks[currentTrackIdx] = track;

        const clipIndex = track.clips.findIndex(
          (c) => c.id === dragState.clipId,
        );

        if (clipIndex !== -1) {
          const clip = { ...track.clips[clipIndex] };

          // --- SNAPPING LOGIC ---
          let snapDelta: number | null = null;

          if (isSnappingEnabled) {
            const threshold = SNAP_THRESHOLD_PX / zoom;
            // Use cached snap points
            const snapPoints = [currentTime, ...dragState.snapPoints];

            const checkSnap = (current: number) => {
              let closestDist = threshold;
              let val: number | null = null;
              for (const p of snapPoints) {
                const dist = Math.abs(p - current);
                if (dist < closestDist) {
                  closestDist = dist;
                  val = p - current;
                }
              }
              return val;
            };

            if (dragState.type === "move") {
              // Check Start
              const sDelta = checkSnap(dragState.originalStart + deltaSeconds);
              if (sDelta !== null) snapDelta = sDelta;

              // Check End (prioritize if closer)
              const currentEnd =
                dragState.originalStart + deltaSeconds + clip.duration;
              const eDelta = checkSnap(currentEnd);
              if (eDelta !== null) {
                // If we already have a start snap, only override if end snap is closer
                if (
                  snapDelta === null ||
                  Math.abs(eDelta) < Math.abs(snapDelta)
                ) {
                  snapDelta = eDelta;
                }
              }
            } else if (dragState.type === "resize-left") {
              snapDelta = checkSnap(dragState.originalStart + deltaSeconds);
            } else if (dragState.type === "resize-right") {
              const currentEnd =
                dragState.originalStart +
                dragState.originalDuration +
                deltaSeconds;
              snapDelta = checkSnap(currentEnd);
            }
          }

          if (dragState.type === "move") {
            let newStart = Math.max(
              0,
              dragState.originalStart + deltaSeconds + (snapDelta || 0),
            );

            // Quantize ONLY if we aren't actively snapping to an exact timestamp
            if (snapDelta === null) {
              newStart = quantizeTime(newStart);
            }

            if (clip.start !== newStart) {
              clip.start = newStart;
              newTracks[currentTrackIdx].clips[clipIndex] = clip;
              hasTrackChange = true;
            }
          } else if (dragState.type === "resize-right") {
            const currentOffset = clip.offset || 0;
            const hasFiniteSourceDuration =
              typeof clip.sourceDuration === "number" &&
              Number.isFinite(clip.sourceDuration);
            const maxDuration = hasFiniteSourceDuration
              ? clip.sourceDuration! - currentOffset
              : null;

            let newDuration =
              dragState.originalDuration + deltaSeconds + (snapDelta || 0);

            // Cap at min duration (0.1s)
            newDuration = Math.max(0.1, newDuration);

            // Cap at max duration only when we have a valid source limit
            if (maxDuration !== null && maxDuration >= 0.1) {
              newDuration = Math.min(newDuration, maxDuration);
            }

            // Quantize ONLY if we aren't actively snapping to an exact timestamp
            if (snapDelta === null) {
              newDuration = quantizeTime(newDuration);
            }

            newDuration = Math.max(0.1, newDuration);

            if (clip.duration !== newDuration) {
              clip.duration = newDuration;
              newTracks[currentTrackIdx].clips[clipIndex] = clip;
              hasTrackChange = true;
            }
          } else if (dragState.type === "resize-left") {
            let shift = deltaSeconds + (snapDelta || 0);

            // Calculate strict bounds
            const currentDuration = dragState.originalDuration;
            const currentOffset = dragState.originalOffset || 0;

            // 1. Min Duration Bound: (currentDuration - shift) >= 0.1  => shift <= currentDuration - 0.1
            const maxShiftForMinDuration = currentDuration - 0.1;

            // 2. Source Start Bound: (currentOffset + shift) >= 0 => shift >= -currentOffset
            const minShiftForSourceStart = -currentOffset;

            // Apply Bounds
            shift = Math.min(shift, maxShiftForMinDuration);
            shift = Math.max(shift, minShiftForSourceStart);

            const newStart = Math.max(0, dragState.originalStart + shift);
            const newDuration = dragState.originalDuration - shift;
            const newOffset = dragState.originalOffset + shift;

            // Quantize Start & Duration (Offset is derived) ONLY if not snapping
            let quantizedStart = newStart;
            if (snapDelta === null) {
              quantizedStart = quantizeTime(newStart);
            }

            const quantDiff = quantizedStart - newStart;

            // Adjust others by the quantization difference to keep them in sync
            // If we snap start to left, duration increases, offset decreases?
            // Actually, simplest is to quantize the shift amount itself?
            // No, shift + snapDelta is the total movement.

            // Better: Quantize the *Start* and calculate the rest from there.
            if (clip.start !== quantizedStart) {
              const diff = quantizedStart - dragState.originalStart; // Total change from original

              // Apply bounds again on the quantized shift?
              // No, just clamp the quantized start

              const finalStart = Math.max(0, quantizedStart);
              const finalShift = finalStart - dragState.originalStart;

              // Re-calculate based on quantized shift
              const finalDuration = dragState.originalDuration - finalShift;
              const finalOffset = dragState.originalOffset + finalShift;

              if (finalDuration >= 0.1) {
                // Min duration check
                clip.start = finalStart;
                clip.duration = finalDuration;
                clip.offset = finalOffset;
                newTracks[currentTrackIdx].clips[clipIndex] = clip;
                hasTrackChange = true;
              }
            }
          }
        }

        if (hasTrackChange) {
          const now = performance.now();
          if (now - lastStateUpdateRef.current > 16) {
            setLocalTracks(newTracks);
            localTracksRef.current = newTracks;
            lastStateUpdateRef.current = now;
          }
        }
        if (hasDragStateChange) {
          setDragState(nextDragState);
        }
      });
    },
    [
      dragState,
      isDraggingPlayhead,
      zoom,
      currentTime,
      setTracks,
      setCurrentTime,
      isSnappingEnabled,
      // tracks, <-- REMOVED: Stabilizes handler
    ],
  );

  const handleMouseUp = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (dragState) {
      // 1. Capture the FINAL moved state of the dragged clip from local memory before resolving collisions against the pure global state!
      const currentLocalTracks = localTracksRef.current;

      // We must HUNT for the clip, because dragState.trackIndex is the ORIGINAL track, but the user might have dragged it to a different track!
      let finalDraggedClip: TimelineClip | undefined;
      let destTrackIdx = -1;

      for (let i = 0; i < currentLocalTracks.length; i++) {
        const found = currentLocalTracks[i].clips.find(
          (c) => c.id === dragState.clipId,
        );
        if (found) {
          finalDraggedClip = found;
          destTrackIdx = i;
          break;
        }
      }

      if (!finalDraggedClip || destTrackIdx === -1) {
        setDragState(null);
        return;
      }

      setTracks((prevTracks) => {
        const newTracks = [...prevTracks];

        // 2. Inject the final coordinates into the global timeline before collision resolution
        const track = { ...newTracks[destTrackIdx] };

        // We know finalDraggedClip exists in currentLocalTracks[destTrackIdx], but we must also ensure we properly extract it
        // from its previous global home if it moved tracks during the drag!

        // First, explicitly wipe the clip from ALL tracks in the new global state to prevent duplicates
        newTracks.forEach((t, i) => {
          newTracks[i] = {
            ...t,
            clips: t.clips.filter((c) => c.id !== dragState.clipId),
          };
        });

        // Re-acquire the target track after wiping
        const targetTrack = { ...newTracks[destTrackIdx] };
        targetTrack.clips = [...targetTrack.clips, finalDraggedClip];

        const draggedStart = finalDraggedClip.start;
        const draggedEnd = finalDraggedClip.start + finalDraggedClip.duration;

        const resolvedClips: TimelineClip[] = [];
        let hasChanges = false;

        // Check against all OTHER clips
        targetTrack.clips.forEach((clip) => {
          if (clip.id === dragState.clipId) return; // Skip self

          const clipStart = clip.start;
          const clipEnd = clip.start + clip.duration;

          // Check overlap
          if (draggedStart < clipEnd && draggedEnd > clipStart) {
            hasChanges = true;

            // 1. ENVELOPED: Dragged fully covers Victim
            // Drag: [       ]
            // Clip:   [   ]
            if (draggedStart <= clipStart && draggedEnd >= clipEnd) {
              // Delete victim
              return;
            }

            // 2. OVERLAP START: Dragged covers end of Victim
            // Drag:      [      ]
            // Clip: [       ]
            // Result:[  ]
            if (
              draggedStart > clipStart &&
              draggedStart < clipEnd &&
              draggedEnd >= clipEnd
            ) {
              const newDuration = draggedStart - clipStart;
              if (newDuration > 0.05) {
                // Min duration check
                resolvedClips.push({ ...clip, duration: newDuration });
              }
              return;
            }

            // 3. OVERLAP END: Dragged covers start of Victim
            // Drag: [      ]
            // Clip:      [      ]
            // Result:      [    ]
            if (
              draggedEnd > clipStart &&
              draggedEnd < clipEnd &&
              draggedStart <= clipStart
            ) {
              const cutAmount = draggedEnd - clipStart;
              const newDuration = clip.duration - cutAmount;
              if (newDuration > 0.05) {
                resolvedClips.push({
                  ...clip,
                  start: draggedEnd,
                  duration: newDuration,
                  offset: clip.offset + cutAmount,
                });
              }
              return;
            }

            // 4. SPLIT: Dragged inside Victim
            // Drag:     [   ]
            // Clip: [           ]
            // Result:[ ][   ][  ]
            if (draggedStart > clipStart && draggedEnd < clipEnd) {
              // Left piece
              const leftDuration = draggedStart - clipStart;
              if (leftDuration > 0.05) {
                resolvedClips.push({
                  ...clip,
                  id: crypto.randomUUID(),
                  duration: leftDuration,
                });
              }

              // Right piece
              const rightDuration = clipEnd - draggedEnd;
              if (rightDuration > 0.05) {
                const offsetIncrease = draggedEnd - clipStart;
                resolvedClips.push({
                  ...clip,
                  id: crypto.randomUUID(),
                  start: draggedEnd,
                  duration: rightDuration,
                  offset: clip.offset + offsetIncrease,
                });
              }
              return;
            }
          }

          // No overlap
          resolvedClips.push(clip);
        });

        if (hasChanges) {
          targetTrack.clips = [...resolvedClips, finalDraggedClip];

          // --- GAP CLOSING & QUANTIZATION PASS ---
          // Sort clips by start time
          targetTrack.clips.sort((a, b) => a.start - b.start);

          // Force strictly quantized frames to prevent Remotion floating point drift
          targetTrack.clips = targetTrack.clips
            .map((c) => ({
              ...c,
              start: quantizeTime(c.start),
              duration: quantizeTime(c.duration),
            }))
            .filter((c) => c.duration >= 0.1);

          newTracks[destTrackIdx] = targetTrack;
          return newTracks;
        }

        newTracks[destTrackIdx] = targetTrack;
        return newTracks;
      });
    }

    setDragState(null);
    setIsDraggingPlayhead((prev) => {
      if (prev && wasPlayingRef.current) {
        setIsPlaying(true);
      }
      return false;
    });
    wasPlayingRef.current = false;
  }, [dragState, setTracks, setIsPlaying]);

  useEffect(() => {
    if (dragState || isDraggingPlayhead || active) {
      window.addEventListener("mousemove", handleMouseMove);
      if (dragState || isDraggingPlayhead) {
        window.addEventListener("mouseup", handleMouseUp);
      }
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, isDraggingPlayhead, active, handleMouseMove, handleMouseUp]);

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;

    // Remember if we were playing, then pause
    wasPlayingRef.current = isPlaying;
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
    <div className="flex flex-col h-full bg-[#1e1e20] text-xs font-sans select-none overflow-visible border-t border-black">
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

      <div className="h-10 border-b border-black/40 bg-[#262629] shrink-0 flex items-center px-4 justify-between z-40">
        <div className="flex items-center gap-2">
          <TrackAddDropdown addTrack={addTrack} />
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
          <button
            onClick={() => setIsSnappingEnabled((p) => !p)}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${isSnappingEnabled ? "bg-[#D2FF44] text-black font-bold" : "bg-zinc-800 text-zinc-300"}`}
            title="Toggle Snapping"
          >
            <Magnet size={10} /> Snap
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
              {formatTime(currentTime)}
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
        >
          <div className="relative z-10 min-w-full">
            {localTracks.map((track, i) => (
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
                selectedClipId={selectedClipId}
                onSelectClip={onSelectClip}
                onDeleteClip={onDeleteClip}
                onContextMenu={undefined} // Deprecated
                onTrackContextMenu={handleTrackContextMenu}
                onClipContextMenu={handleClipContextMenu}
                onToggleClipMute={toggleClipMute}
                onSplitClip={handleSplitClip}
                splitHover={activeTool === "split" ? splitHover : null}
                onSplitHover={handleSplitHover}
                zIndex={track.type === "audio" ? i + 1 : localTracks.length - i}
                dragMouseX={dragMouseX}
                ghostClip={ghostClip}
                onTrackVolumeChange={handleTrackVolumeChangeInternal}
              />
            ))}
            <div className="h-32 w-full"></div>
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

      {/* DRAG PROXY */}
      {dragState?.type === "move" && activeClipForProxy && (
        <div
          ref={proxyRef}
          className="fixed top-0 left-0 pointer-events-none z-[9999] opacity-100 shadow-2xl overflow-hidden rounded-sm"
          style={{
            width: activeClipForProxy.clip.duration * zoom,
            height: activeClipForProxy.trackType === "audio" ? AUDIO_TRACK_H : VIDEO_TRACK_H,
            // Initial position centered on cursor
            transform: `translate(${dragMouseX.current - (activeClipForProxy.clip.duration * zoom) / 2}px, ${dragMouseY.current - (activeClipForProxy.trackType === "audio" ? AUDIO_TRACK_H : VIDEO_TRACK_H) / 2}px)`,
          }}
        >
          {activeClipForProxy.trackType !== "audio" ? (
            <div className="flex-1 h-full relative overflow-hidden flex bg-[#375a6c] border border-[#213845]">
              {activeClipForProxy.clip.thumbnail && (
                <img
                  src={activeClipForProxy.clip.thumbnail}
                  className="w-full h-full object-cover opacity-70"
                />
              )}
              <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent px-2 py-0.5 text-[9px] text-zinc-300 truncate font-mono">
                {activeClipForProxy.clip.name}
              </div>
            </div>
          ) : (
            <div className="relative overflow-hidden shrink-0 flex items-center h-full flex-1 bg-[#D2FF44] border border-black/10 px-2">
              <div className="w-full h-px bg-black/10 absolute left-0" style={{ top: '50%' }} />
              <div className="relative text-[10px] text-black font-bold font-mono pointer-events-none truncate uppercase">
                {activeClipForProxy.clip.name}
              </div>
            </div>
          )}
        </div>
      )}

      {/* CONTEXT MENU */}
      {contextMenu && (
        <div
          className="fixed z-[100] bg-[#2c2f33] border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[140px] max-h-[calc(100vh-10px)] overflow-y-auto"
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 280),
            left: Math.min(contextMenu.x, window.innerWidth - 150),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-xs font-semibold text-zinc-400 border-b border-zinc-700 mb-1">
            {contextMenu.type === "track"
              ? `${tracks[contextMenu.trackIndex]?.name} Options`
              : "Clip Options"}
          </div>

          {contextMenu.type === "track" && (
            <>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-300 flex items-center gap-2 text-xs"
                onClick={() => {
                  toggleTrackProperty(contextMenu.trackIndex, "isMuted");
                  setContextMenu(null);
                }}
              >
                {tracks[contextMenu.trackIndex]?.isMuted ? (
                  <>
                    <Volume2 size={12} /> Unmute Track
                  </>
                ) : (
                  <>
                    <VolumeX size={12} /> Mute Track
                  </>
                )}
              </button>

              <button
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-300 flex items-center gap-2 text-xs"
                onClick={() => {
                  toggleTrackProperty(contextMenu.trackIndex, "isHidden");
                  setContextMenu(null);
                }}
              >
                {tracks[contextMenu.trackIndex]?.isHidden ? (
                  <>
                    <Eye size={12} /> Show Track
                  </>
                ) : (
                  <>
                    <EyeOff size={12} /> Hide Track
                  </>
                )}
              </button>

              <button
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-300 flex items-center gap-2 text-xs"
                onClick={() => {
                  toggleTrackProperty(contextMenu.trackIndex, "isLocked");
                  setContextMenu(null);
                }}
              >
                {tracks[contextMenu.trackIndex]?.isLocked ? (
                  <>
                    <Lock size={12} /> Unlock Track
                  </>
                ) : (
                  <>
                    <Lock size={12} /> Lock Track
                  </>
                )}
              </button>

              <div className="h-px bg-zinc-700 my-1" />

              <button
                className="w-full text-left px-3 py-1.5 hover:bg-red-900/50 text-red-300 flex items-center gap-2 text-xs"
                onClick={() => {
                  deleteTrack(contextMenu.trackIndex);
                  setContextMenu(null);
                }}
              >
                <Trash2 size={12} /> Delete Track
              </button>
            </>
          )}
          {contextMenu.type === "clip" && contextMenu.clipId && (
            <>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-300 flex items-center gap-2 text-xs"
                onClick={() => {
                  toggleClipMute(contextMenu.clipId!, contextMenu.trackIndex);
                  setContextMenu(null);
                }}
              >
                {tracks[contextMenu.trackIndex].clips.find(
                  (c) => c.id === contextMenu.clipId,
                )?.isMuted ? (
                  <>
                    <Volume2 size={12} /> Unmute Clip
                  </>
                ) : (
                  <>
                    <VolumeX size={12} /> Mute Clip
                  </>
                )}
              </button>

              {/* CLIP VOLUME SLIDER */}
              <div className="px-3 py-2 border-t border-zinc-700 mt-1">
                <div className="flex justify-between items-center text-[10px] text-zinc-500 mb-1">
                  <span>Clip Volume</span>
                  <span className="font-mono">
                    {Math.round(((localTracks[contextMenu.trackIndex]?.clips.find((c) => c.id === contextMenu.clipId)?.volume ?? 1) * 100))}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.01"
                  value={localTracks[contextMenu.trackIndex]?.clips.find((c) => c.id === contextMenu.clipId)?.volume ?? 1}
                  onChange={(e) =>
                    setClipVolume(
                      contextMenu.clipId!,
                      contextMenu.trackIndex,
                      parseFloat(e.target.value),
                    )
                  }
                  onMouseUp={flushPendingClipVolume}
                  onPointerUp={flushPendingClipVolume}
                  className="w-full h-1 accent-[#D2FF44] bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <button
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-300 flex items-center gap-2 text-xs"
                onClick={() => {
                  // Split at Playhead
                  // We need to calculate the X position for the split based on currentTime
                  // x = currentTime * zoom
                  const x = currentTime * zoom;
                  handleSplitClip(contextMenu.trackIndex, x, zoom);
                  setContextMenu(null);
                }}
              >
                <Scissors size={12} /> Split at Playhead
              </button>

              <button
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 text-zinc-300 flex items-center gap-2 text-xs opacity-50 cursor-not-allowed"
                title="Coming Later"
                disabled
              >
                <Maximize2 size={12} /> Extend Clip
              </button>

              <div className="h-px bg-zinc-700 my-1" />

              <button
                className="w-full text-left px-3 py-1.5 hover:bg-red-900/50 text-red-300 flex items-center gap-2 text-xs"
                onClick={() => {
                  if (onDeleteClip) onDeleteClip(contextMenu.clipId!);
                  setContextMenu(null);
                }}
              >
                <Trash2 size={12} /> Delete Clip
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
