"use client";

import { useRef, useState, useEffect } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Plus,
  Lock,
  Eye,
  Trash2,
  Scissors,
} from "lucide-react";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

const LEFT_PANEL_W = 96; // px (w-24)
const LEFT_PANEL_BG = "bg-[#2c2f33]";
const LEFT_PANEL_BORDER = "border-r border-zinc-700";

function TimelineItemComponent({
  id,
  data,
  width,
  left,
  onRemove,
  onUpdate,
  onClick,
  zoom,
}: any) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id,
      data: { type: "timeline-item" }, // ✅ important
    });

  const [isResizing, setIsResizing] = useState(false);
  const [localState, setLocalState] = useState({ width, left });

  useEffect(() => {
    if (!isResizing) setLocalState({ width, left });
  }, [width, left, isResizing]);

  const handleResizeStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = localState.width;
    const maxDur = data.maxDuration || data.duration || 4;
    const maxPx = maxDur * zoom;

    const onMove = (ev: PointerEvent) => {
      const diff = ev.clientX - startX;
      // Min width 10px, Max width based on maxDuration
      const newW = Math.max(10, Math.min(startWidth + diff, maxPx));
      setLocalState((prev) => ({ ...prev, width: newW }));
    };

    const onUp = (ev: PointerEvent) => {
      const diff = ev.clientX - startX;
      const newW = Math.max(10, Math.min(startWidth + diff, maxPx));
      setIsResizing(false);
      onUpdate({ duration: newW / zoom });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleResizeStartLeft = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = localState.width;
    const startLeft = localState.left;
    const startTrim = data.trimStart || 0;

    const onMove = (ev: PointerEvent) => {
      const diff = ev.clientX - startX;
      // Calculate potential new values
      // Cannot grow left beyond trimStart (0)
      // Cannot shrink width below 10px
      // Cannot move startLeft below 0

      let newLeft = startLeft + diff;
      let newWidth = startWidth - diff;
      let newTrim = startTrim + diff / zoom;

      if (newWidth < 10) {
        newLeft = startLeft + startWidth - 10;
        newWidth = 10;
        newTrim = startTrim + (startWidth - 10) / zoom;
      }

      if (newTrim < 0) {
        newTrim = 0;
        newLeft = startLeft - startTrim * zoom;
        newWidth = startWidth + startTrim * zoom;
      }

      if (newLeft < 0) newLeft = 0; // Hard stop at timeline 0

      setLocalState({ width: newWidth, left: newLeft });
    };

    const onUp = (ev: PointerEvent) => {
      setIsResizing(false);
      // Finalize
      const current = localState; // Closure might be stale, but we rely on the last render state or calculate again.
      // Actually, safer to recalculate or use a ref, but for this snippet we'll re-calculate from event to be safe or trust React state update speed (usually fine for drag end).
      // Let's just use the logic from onMove for the final commit.
      const diff = ev.clientX - startX;
      let newLeft = startLeft + diff;
      let newWidth = startWidth - diff;
      let newTrim = startTrim + diff / zoom;

      if (newWidth < 10) {
        newLeft = startLeft + startWidth - 10;
        newWidth = 10;
        newTrim = startTrim + (startWidth - 10) / zoom;
      }
      if (newTrim < 0) {
        newTrim = 0;
        newLeft = startLeft - startTrim * zoom;
        newWidth = startWidth + startTrim * zoom;
      }
      if (newLeft < 0) newLeft = 0;

      onUpdate({
        startTime: newLeft / zoom,
        duration: newWidth / zoom,
        trimStart: newTrim,
      });

      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const style = {
    transform: CSS.Translate.toString(transform),
    left: `${isResizing ? localState.left : left}px`,
    width: `${isResizing ? localState.width : width}px`,
    position: "absolute" as const,
    height: "100%",
    zIndex: isDragging || isResizing ? 50 : 10,
    opacity: isDragging ? 0 : 1, // Hide original when dragging
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`
        absolute top-0 bottom-0 group flex flex-col select-none 
        cursor-grab active:cursor-grabbing
      `}
      onClick={onClick}
    >
      {/* Inner Content Container */}
      <div className="absolute inset-0 flex flex-col overflow-hidden bg-[#375a6c] border border-[#213845] rounded-sm">
        <div className="flex-1 relative overflow-hidden flex">
          {data.previewBase64 && (
            <img
              src={data.previewBase64}
              className="h-full w-full object-cover opacity-80"
            />
          )}
        </div>

        <div className="absolute bottom-0 w-full bg-[#20343e] px-2 py-0.5 text-[9px] text-zinc-300 truncate font-mono pointer-events-none">
          {data.name} ({data.duration?.toFixed(2)}s)
        </div>

        <div
          className={`absolute inset-0 ring-inset ring-2 pointer-events-none transition-all ${
            data.isActive ? "ring-orange-500" : "ring-transparent group-hover:ring-white/30"
          }`}
        />

        <button
          className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white p-1 rounded z-50 transition-colors opacity-0 group-hover:opacity-100"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onRemove();
          }}
          title="Remove Clip"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* Resize Handle LEFT */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2 cursor-ew-resize z-50 opacity-0 group-hover:opacity-100 hover:bg-white/20 flex items-center justify-center"
        onPointerDown={handleResizeStartLeft}
      >
        <div className="w-0.5 h-4 bg-white/50 rounded-full" />
      </div>

      {/* Resize Handle RIGHT */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 translate-x-1/2 cursor-ew-resize z-50 opacity-0 group-hover:opacity-100 hover:bg-white/20 flex items-center justify-center"
        onPointerDown={handleResizeStart}
      >
        <div className="w-0.5 h-4 bg-white/50 rounded-full" />
      </div>
    </div>
  );
}

function TrackDroppable({
  id,
  items,
  trackIndex,
  onRemoveItem,
  onUpdateItem,
  onShotClick,
  zoom,
  activeShotId,
}: any) {
  const { setNodeRef } = useDroppable({
    id,
    data: { type: "track", trackIndex },
  });

  return (
    <div
      ref={setNodeRef}
      className="absolute inset-0 w-full h-full min-h-[50px]"
    >
      {items.map((item: any) => (
        <TimelineItemComponent
          key={item.timelineId}
          id={item.timelineId}
          data={{
            ...item,
            type: "timeline-item",
            trackIndex,
            isActive: item.id === activeShotId,
          }}
          width={(item.duration || 4) * zoom}
          left={(item.startTime || 0) * zoom}
          onRemove={() => onRemoveItem(item.timelineId)}
          onUpdate={(updates: any) => onUpdateItem(item.timelineId, updates)}
          onClick={() => onShotClick && onShotClick(item.id)}
          zoom={zoom}
        />
      ))}
    </div>
  );
}

interface TimelinePanelProps {
  tracks: any[][];
  onRemoveItem: (id: string) => void;
  onUpdateItem: (id: string, updates: any) => void;
  onAddTrack: () => void;
  isPlaying: boolean;
  togglePlay: () => void;
  currentTime: number;
  duration: number;
  seekTo: (time: number) => void;
  zoom: number;
  setZoom: (z: number) => void;

  // ✅ add back (page.tsx passes these)
  activeShotId?: string;
  onShotClick?: (id: string) => void;
  shots?: any[];
  onSplit?: () => void;
}

export default function TimelinePanel({
  tracks,
  onRemoveItem,
  onUpdateItem,
  onAddTrack,
  isPlaying,
  togglePlay,
  currentTime,
  duration,
  seekTo,
  zoom,
  setZoom,
  activeShotId,
  onSplit,
  onShotClick,
}: TimelinePanelProps) {
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * 30);
    return `01:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [viewportPx, setViewportPx] = useState(0);

  // Measure scroll viewport width (so ruler can stay “infinite-ish” at low zoom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      setViewportPx(el.clientWidth || 0);
    });
    ro.observe(el);
    setViewportPx(el.clientWidth || 0);

    return () => ro.disconnect();
  }, []);

  // Infinite-ish timeline canvas
  const MIN_TIMELINE_SECONDS = 120; // base
  const BUFFER_SECONDS = 600; // +10 minutes empty space
  const MAX_TIMELINE_SECONDS = 6 * 60 * 60; // safety

  const viewportSeconds =
    viewportPx > 0 ? viewportPx / Math.max(zoom, 0.001) : 0;

  const timelineSeconds = Math.min(
    MAX_TIMELINE_SECONDS,
    Math.max(
      duration || 0,
      MIN_TIMELINE_SECONDS,
      Math.ceil(viewportSeconds + BUFFER_SECONDS),
    ),
  );

  const contentWidthPx = Math.max(1, timelineSeconds * zoom);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!scrollRef.current) return;
    setIsScrubbing(true);
    handleScrub(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isScrubbing) return;
    handleScrub(e);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsScrubbing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleScrub = (e: React.PointerEvent) => {
    const sc = scrollRef.current;
    if (!sc) return;
    const rect = sc.getBoundingClientRect();
    const x = e.clientX - rect.left + sc.scrollLeft;
    const t = Math.max(0, x / zoom);
    seekTo(t);
  };

  return (
    <div className="h-full w-full bg-[#1e1e20] flex flex-col font-sans select-none border-t border-black">
      {/* CONTROL BAR */}
      <div className="h-10 border-b border-black/40 flex items-center px-4 bg-[#262629] shrink-0 justify-between relative">
        <div className="flex items-center gap-2">
          <button
            onClick={onAddTrack}
            className="flex items-center gap-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-300"
          >
            <Plus size={10} /> Add Track
          </button>

          <button
            onClick={onSplit}
            className="flex items-center gap-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-300"
          >
            <Scissors size={10} /> Split
          </button>

          <div className="flex items-center gap-1 ml-4 border-l border-zinc-700 pl-4">
            <button
              onClick={() => setZoom(Math.max(1, zoom / 1.5))}
              className="text-zinc-400 hover:text-white text-xs px-1"
            >
              -
            </button>
            <span className="text-[10px] text-zinc-500 w-8 text-center">
              {Math.round(zoom)}%
            </span>
            <button
              onClick={() => setZoom(Math.min(200, zoom * 1.5))}
              className="text-zinc-400 hover:text-white text-xs px-1"
            >
              +
            </button>
          </div>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-4">
          <button
            onClick={() => seekTo(0)}
            className="text-zinc-400 hover:text-white"
            title="Go to Start"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={togglePlay}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${
              isPlaying
                ? "bg-[#D2FF44] text-black scale-110"
                : "bg-white text-black hover:bg-gray-200"
            }`}
          >
            {isPlaying ? (
              <Pause size={16} fill="black" />
            ) : (
              <Play size={16} fill="black" className="ml-0.5" />
            )}
          </button>
          <button
            onClick={() => seekTo(duration)}
            className="text-zinc-400 hover:text-white"
            title="Go to End"
          >
            <SkipForward size={18} />
          </button>
        </div>

        <div className="font-mono text-lg text-[#D2FF44] tabular-nums">
          {formatTime(currentTime)}
        </div>
      </div>

      {/* TIMELINE AREA */}
      <div className="flex-1 min-h-0 flex bg-[#121214]">
        {/* LEFT FIXED PANEL (always same bg) */}
        <div
          className={`shrink-0 ${LEFT_PANEL_BG} ${LEFT_PANEL_BORDER}`}
          style={{ width: LEFT_PANEL_W }}
        >
          {/* Ruler left block */}
          <div className="h-8 border-b border-zinc-700" />

          {/* Track headers */}
          {tracks.length === 0 ? (
            <div className="h-24 border-b border-zinc-800 flex items-center justify-center text-zinc-400 text-xs font-mono">
              V1
            </div>
          ) : (
            tracks.map((_, trackIndex: number) => (
              <div
                key={trackIndex}
                className="h-24 border-b border-zinc-800 flex flex-col p-2 gap-1"
              >
                <div className="flex justify-between items-center text-zinc-400">
                  <span className="font-bold text-xs">V{trackIndex + 1}</span>
                  <div className="flex gap-1">
                    <Lock
                      size={12}
                      className="cursor-pointer hover:text-white"
                    />
                    <Eye
                      size={12}
                      className="cursor-pointer hover:text-white"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* RIGHT SCROLL AREA (ONE horizontal scrollbar lives here) */}
        <div
          ref={scrollRef}
          className="flex-1 min-w-0 overflow-x-auto overflow-y-auto relative"
        >
          <div className="relative" style={{ width: `${contentWidthPx}px` }}>
            {/* RULER (sticky) */}
            <div
              className="h-8 bg-[#1a1a1c] border-b border-zinc-700 sticky top-0 z-30 cursor-ew-resize"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              {Array.from({ length: Math.ceil(timelineSeconds) }).map(
                (_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-zinc-700 text-[9px] text-zinc-500 pl-1"
                    style={{ left: `${i * zoom}px` }}
                  >
                    {i % 5 === 0 ? `00:${i.toString().padStart(2, "0")}` : ""}
                  </div>
                ),
              )}

              {/* PLAYHEAD LINE + ✅ RED ARROW (diamond) */}
              <div
                className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none"
                style={{ left: `${currentTime * zoom}px` }}
              >
                <div className="absolute -top-2 -left-1.5 w-3 h-3 bg-red-500 rotate-45" />
              </div>
            </div>

            {/* TRACKS */}
            {tracks.length === 0 ? (
              <div className="h-24 border-b border-zinc-800 bg-[#151517]" />
            ) : (
              tracks.map((track: any[], trackIndex: number) => (
                <div
                  key={trackIndex}
                  className="h-24 border-b border-zinc-800 relative bg-[#151517]"
                >
                  {/* PLAYHEAD through tracks */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-red-500 z-40 pointer-events-none"
                    style={{ left: `${currentTime * zoom}px` }}
                  />
                  <TrackDroppable
                    id={`timeline-track-${trackIndex}`}
                    items={track}
                    trackIndex={trackIndex}
                    onRemoveItem={onRemoveItem}
                    onUpdateItem={onUpdateItem}
                    onShotClick={onShotClick}
                    zoom={zoom}
                    activeShotId={activeShotId}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
