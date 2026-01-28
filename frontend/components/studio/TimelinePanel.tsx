"use client";

import { useRef, useState, useEffect, memo } from "react";
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
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

const LEFT_PANEL_W = 160;
const LEFT_PANEL_BG = "bg-[#2c2f33]";
const LEFT_PANEL_BORDER = "border-r border-zinc-700";

// --- WAVEFORM COMPONENT ---
const TimelineWaveform = memo(function TimelineWaveform({
  data,
  zoom,
  color = "#D2FF44",
}: {
  data: number[];
  zoom: number;
  color?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const SAMPLES_PER_SEC = 20;
    const totalDuration = data.length / SAMPLES_PER_SEC;
    const width = Math.max(1, totalDuration * zoom);
    const height = canvas.clientHeight || 64;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;

    const pixelsPerSample = zoom / SAMPLES_PER_SEC;
    const barWidth = Math.max(0.5, pixelsPerSample);

    for (let i = 0; i < data.length; i++) {
      const x = i * pixelsPerSample;
      const barHeight = Math.max(2, data[i] * height * 0.8);
      const y = (height - barHeight) / 2;
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }, [data, zoom, color]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
});

// --- TIMELINE ITEM ---
function TimelineItemComponent({
  id,
  data,
  width,
  left,
  onRemove,
  onUpdate,
  onClick,
  zoom,
  activeTool,
  onSplitItem,
  locked,
  isAudioTrack,
}: any) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id,
      data: { type: "timeline-item" },
      disabled: activeTool === "split" || locked,
    });

  const [isResizing, setIsResizing] = useState(false);
  const [localState, setLocalState] = useState({ width, left });
  const [splitHoverX, setSplitHoverX] = useState<number | null>(null);

  useEffect(() => {
    if (!isResizing) {
      setLocalState((prev) => {
        if (prev.width === width && prev.left === left) return prev;
        return { width, left };
      });
    }
  }, [width, left, isResizing]);

  const handleResizeStart = (e: React.PointerEvent) => {
    if (activeTool === "split" || locked) return;
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = localState.width;
    const maxDur = data.maxDuration || data.duration || 4;
    const maxPx = maxDur * zoom;

    const onMove = (ev: PointerEvent) => {
      const diff = ev.clientX - startX;
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
    if (activeTool === "split" || locked) return;
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = localState.width;
    const startLeft = localState.left;
    const startTrim = data.trimStart || 0;

    const onMove = (ev: PointerEvent) => {
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
      setLocalState({ width: newWidth, left: newLeft });
    };

    const onUp = (ev: PointerEvent) => {
      setIsResizing(false);
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

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activeTool === "split") {
      const rect = e.currentTarget.getBoundingClientRect();
      setSplitHoverX(e.clientX - rect.left);
    }
  };

  const handlePointerLeave = () => {
    if (activeTool === "split") setSplitHoverX(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (activeTool === "split") {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = data.startTime + x / zoom;
      if (onSplitItem) onSplitItem(data.timelineId, time);
    } else {
      onClick && onClick();
    }
  };

  const style = {
    transform: CSS.Translate.toString(transform),
    left: `${isResizing ? localState.left : left}px`,
    width: `${isResizing ? localState.width : width}px`,
    position: "absolute" as const,
    height: "100%",
    zIndex: isDragging || isResizing ? 50 : 10,
    opacity: isDragging ? 0 : 1,
  };

  const SAMPLES_PER_SEC = 20;
  const fullWaveformDuration = data.waveform
    ? data.waveform.length / SAMPLES_PER_SEC
    : 0;
  const fullWaveformWidth = fullWaveformDuration * zoom;
  const hasWaveform = data.waveform && data.waveform.length > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`
        absolute top-0 bottom-0 group select-none
        ${activeTool === "split" ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}
      `}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div
        className={`absolute inset-0 flex flex-col overflow-hidden border rounded-sm ${
          isAudioTrack
            ? "bg-[#1a1a1c] border-white/10"
            : "bg-[#375a6c] border-[#213845]"
        }`}
      >
        {!isAudioTrack && (
          <div className="flex-1 relative overflow-hidden flex bg-zinc-800">
            {data.previewBase64 && (
              <img
                src={data.previewBase64}
                className="h-full w-full object-cover opacity-80"
              />
            )}
            <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent px-2 py-0.5 text-[9px] text-zinc-300 truncate font-mono pointer-events-none z-10">
              {data.name}
            </div>
          </div>
        )}

        {isAudioTrack && (
          <div className="relative overflow-hidden shrink-0 flex items-center flex-1 bg-[#101012]">
            {hasWaveform ? (
              <div
                className="absolute top-0 bottom-0"
                style={{
                  left: `-${(data.trimStart || 0) * zoom}px`,
                  width: `${fullWaveformWidth}px`,
                }}
              >
                <TimelineWaveform
                  data={data.waveform}
                  zoom={zoom}
                  color="#D2FF44"
                />
              </div>
            ) : (
              <div className="w-full h-px bg-[#D2FF44]/30" />
            )}
            <div className="absolute top-1 left-2 text-[9px] text-zinc-400 font-mono pointer-events-none">
              {data.name}
            </div>
          </div>
        )}

        {activeTool === "split" && splitHoverX !== null && (
          <div
            className="absolute top-0 bottom-0 w-px bg-red-500 z-[60] pointer-events-none"
            style={{ left: splitHoverX }}
          >
            <div className="absolute -top-3 -left-1.5 text-red-500">
              <Scissors size={12} />
            </div>
          </div>
        )}

        {!locked && (
          <button
            className="absolute top-1 right-1 bg-black/60 hover:bg-red-600 text-white p-1 rounded z-50 transition-colors opacity-0 group-hover:opacity-100"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onRemove();
            }}
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>

      {!locked && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2 cursor-ew-resize z-50 opacity-0 group-hover:opacity-100"
            onPointerDown={handleResizeStartLeft}
          >
            <div className="w-0.5 h-full mx-auto bg-white/50" />
          </div>
          <div
            className="absolute right-0 top-0 bottom-0 w-2 translate-x-1/2 cursor-ew-resize z-50 opacity-0 group-hover:opacity-100"
            onPointerDown={handleResizeStart}
          >
            <div className="w-0.5 h-full mx-auto bg-white/50" />
          </div>
        </>
      )}
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
  activeTool,
  onSplitItem,
  locked,
  visible,
  videoBlobs,
  isAudioTrack,
}: any) {
  const { setNodeRef } = useDroppable({
    id,
    data: { type: "track", trackIndex },
    disabled: locked,
  });

  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-0 w-full h-full min-h-[50px] ${!visible ? "opacity-40 grayscale" : ""}`}
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
          activeTool={activeTool}
          onSplitItem={onSplitItem}
          locked={locked}
          videoBlobs={videoBlobs}
          isAudioTrack={isAudioTrack}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENTS (Ruler, Playhead, TrackListRows)
// ---------------------------------------------------------------------------

const TimelineRuler = memo(function TimelineRuler({ seconds, zoom }: any) {
  return (
    <div className="absolute top-0 bottom-0 left-0 right-0 pointer-events-none">
      {Array.from({ length: Math.ceil(seconds) }).map((_, i) => {
        const left = i * zoom;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${left}px` }}
          >
            {i % 30 === 0 ? (
              <div className="absolute top-0 left-0 w-px h-4 bg-zinc-300" />
            ) : i % 15 === 0 ? (
              <div className="absolute top-0 left-0 w-px h-3 bg-zinc-400" />
            ) : (
              <div className="absolute top-0 left-0 w-px h-2 bg-zinc-600" />
            )}
            {Array.from({ length: 4 }).map((_, j) => (
              <div
                key={j}
                className="absolute top-0 w-px h-1 bg-zinc-700"
                style={{ left: `${zoom * ((j + 1) / 5)}px` }}
              />
            ))}
            {i % 30 === 0 && (
              <span className="absolute top-4 left-1 text-[9px] text-zinc-400 font-mono select-none">
                {new Date(i * 1000).toISOString().substr(11, 8)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

const Playhead = memo(function Playhead({
  time,
  zoom,
  height = "100%",
  showHandle = true,
}: any) {
  return (
    <div
      className="absolute top-0 w-px bg-red-500 z-50 pointer-events-none will-change-transform"
      style={{
        height: height,
        transform: `translateX(${time * zoom}px)`,
      }}
    >
      {showHandle && (
        <div className="absolute -top-2 -left-1.5 w-3 h-3 bg-red-500 rotate-45" />
      )}
    </div>
  );
});

// NEW: Combined Row Component (Header + Track) to ensure perfect sync
const TrackRow = memo(function TrackRow({
  trackIndex,
  tracks,
  trackSettings,
  zoom,
  scrollLeft, // Horizontal scroll offset
  contentWidth,
  activeShotId,
  activeTool,
  onRemoveItem,
  onUpdateItem,
  onShotClick,
  onSplit,
  videoBlobs,
  onRenameTrack,
  onDeleteTrack,
  onToggleTrackLock,
  onToggleTrackVisibility,
  isAudio,
  currentTime,
}: any) {
  const settings = trackSettings?.[trackIndex] || {
    locked: false,
    visible: true,
    name: `Track ${trackIndex + 1}`,
    height: 96,
  };
  const height = settings.height || 96;

  return (
    <div
      className="flex border-b border-zinc-800 bg-[#151517] relative"
      style={{ height }}
    >
      {/* 1. LEFT HEADER (Fixed width) */}
      <div
        className={`shrink-0 flex flex-col p-2 gap-1 justify-between relative group ${LEFT_PANEL_BG} ${LEFT_PANEL_BORDER}`}
        style={{ width: LEFT_PANEL_W }}
      >
        <div className="flex justify-between items-center text-zinc-400">
          <input
            type="text"
            className="bg-transparent border-none text-xs font-bold text-zinc-400 focus:text-white focus:outline-none min-w-0 w-20 truncate"
            value={settings.name}
            onChange={(e) =>
              onRenameTrack && onRenameTrack(trackIndex, e.target.value)
            }
          />
          <div className="flex gap-2">
            <button
              onClick={() => onToggleTrackLock && onToggleTrackLock(trackIndex)}
              className={`hover:text-white ${settings.locked ? "text-red-400" : "text-zinc-500"}`}
            >
              {settings.locked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
            <button
              onClick={() =>
                onToggleTrackVisibility && onToggleTrackVisibility(trackIndex)
              }
              className={`hover:text-white ${!settings.visible ? "text-zinc-600" : "text-zinc-400"}`}
            >
              {settings.visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={() => onDeleteTrack && onDeleteTrack(trackIndex)}
            className="text-zinc-600 hover:text-red-500 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* 2. RIGHT TRACK CONTENT (Scrolls via Transform) */}
      <div className="flex-1 relative overflow-hidden bg-[#121214]">
        {/* The scrolling container */}
        <div
          style={{
            transform: `translateX(-${scrollLeft}px)`,
            width: contentWidth,
            height: "100%",
          }}
          className="will-change-transform"
        >
          <TrackDroppable
            id={`timeline-track-${trackIndex}`}
            items={tracks[trackIndex] || []}
            trackIndex={trackIndex}
            onRemoveItem={onRemoveItem}
            onUpdateItem={onUpdateItem}
            onShotClick={onShotClick}
            zoom={zoom}
            activeShotId={activeShotId}
            activeTool={activeTool}
            onSplitItem={onSplit}
            locked={settings.locked}
            visible={settings.visible}
            videoBlobs={videoBlobs}
            isAudioTrack={isAudio}
          />
          {/* Per-track playhead slice (visual only) */}
          <Playhead
            time={currentTime}
            zoom={zoom}
            height="100%"
            showHandle={false}
          />
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

interface TimelinePanelProps {
  tracks: any[][];
  onRemoveItem: (id: string) => void;
  onUpdateItem: (id: string, updates: any) => void;
  onAddVideoTrack: () => void;
  onAddAudioTrack: () => void;
  isPlaying: boolean;
  togglePlay: () => void;
  currentTime: number;
  duration: number;
  seekTo: (time: number) => void;
  zoom: number;
  setZoom: (z: number) => void;
  activeShotId?: string;
  onShotClick?: (id: string) => void;
  shots?: any[];
  onSplit?: (itemId: string, time: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  trackSettings?: {
    locked: boolean;
    visible: boolean;
    name: string;
    height?: number;
    type?: "video" | "audio";
  }[];
  onDeleteTrack?: (index: number) => void;
  onRenameTrack?: (index: number, newName: string) => void;
  onResizeTrack?: (index: number, newHeight: number) => void;
  onToggleTrackLock?: (index: number) => void;
  onToggleTrackVisibility?: (index: number) => void;
  videoBlobs?: Map<string, string>;
  onVolumeChange?: (volume: number) => void;
}

export default function TimelinePanel({
  tracks,
  onRemoveItem,
  onUpdateItem,
  onAddVideoTrack,
  onAddAudioTrack,
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
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  trackSettings,
  onDeleteTrack,
  onRenameTrack,
  onResizeTrack,
  onToggleTrackLock,
  onToggleTrackVisibility,
  videoBlobs,
  onVolumeChange,
}: TimelinePanelProps) {
  const [activeTool, setActiveTool] = useState<"select" | "split">("select");
  const [volume, setVolume] = useState(1);
  const isHovering = useRef(false);

  // --- SPLIT & SCROLL STATE ---
  const [videoHeightPct, setVideoHeightPct] = useState(60);
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isHovering.current) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key.toLowerCase() === "a") setActiveTool("select");
      if (e.key.toLowerCase() === "b") setActiveTool("split");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const formatTime = (seconds: number) => {
    const adjusted = seconds + 3600;
    const h = Math.floor(adjusted / 3600);
    const m = Math.floor((adjusted % 3600) / 60);
    const s = Math.floor(adjusted % 60);
    const f = Math.floor((adjusted % 1) * 30);
    return `${h.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}:${s.toString().padStart(2, "0")}:${f
      .toString()
      .padStart(2, "0")}`;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    handleScrub(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 1) handleScrub(e);
  };

  const handleScrub = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = Math.max(0, (x + scrollLeft) / zoom);
    seekTo(t);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (onVolumeChange) onVolumeChange(val);
  };

  // SIMPLE RESIZE LOGIC (No overlaps, simple percentage)
  const handleSplitterDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startPct = videoHeightPct;
    const containerH = e.currentTarget.parentElement?.clientHeight || 600;

    const onMove = (ev: PointerEvent) => {
      const diffPx = ev.clientY - startY;
      const diffPct = (diffPx / containerH) * 100;
      const newPct = Math.min(90, Math.max(10, startPct + diffPct));
      setVideoHeightPct(newPct);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "default";
    };

    document.body.style.cursor = "row-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const timelineSeconds = Math.max(duration + 120, 600);
  const contentWidthPx = timelineSeconds * zoom;

  // Filter Tracks
  const videoTrackIndices = tracks
    .map((_, i) => i)
    .filter((i) => {
      const s = trackSettings?.[i];
      return !(
        s?.type === "audio" || s?.name?.trim().toUpperCase().startsWith("A")
      );
    });

  const audioTrackIndices = tracks
    .map((_, i) => i)
    .filter((i) => {
      const s = trackSettings?.[i];
      return (
        s?.type === "audio" || s?.name?.trim().toUpperCase().startsWith("A")
      );
    });

  return (
    <div
      className="h-full w-full bg-[#1e1e20] flex flex-col font-sans select-none border-t border-black"
      onMouseEnter={() => (isHovering.current = true)}
      onMouseLeave={() => (isHovering.current = false)}
    >
      {/* 1. TOOLBAR */}
      <div className="h-10 border-b border-black/40 flex items-center px-4 bg-[#262629] shrink-0 justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onAddVideoTrack}
            className="flex items-center gap-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-300"
          >
            <Plus size={10} /> Add Video
          </button>
          <button
            onClick={onAddAudioTrack}
            className="flex items-center gap-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-300"
          >
            <Plus size={10} /> Add Audio
          </button>
          <button
            onClick={() => setActiveTool("select")}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded ${activeTool === "select" ? "bg-[#D2FF44] text-black" : "bg-zinc-800 text-zinc-300"}`}
          >
            <MousePointer2 size={10} /> Select
          </button>
          <button
            onClick={() => setActiveTool("split")}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded ${activeTool === "split" ? "bg-[#D2FF44] text-black" : "bg-zinc-800 text-zinc-300"}`}
          >
            <Scissors size={10} /> Split
          </button>
          <div className="w-px h-4 bg-zinc-700 mx-2" />
          <button
            onClick={() => onUndo?.()}
            disabled={!canUndo}
            className={`p-1 rounded ${canUndo ? "text-zinc-400" : "text-zinc-600"}`}
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={() => onRedo?.()}
            disabled={!canRedo}
            className={`p-1 rounded ${canRedo ? "text-zinc-400" : "text-zinc-600"}`}
          >
            <Redo2 size={14} />
          </button>
          <div className="flex items-center gap-1 ml-4 border-l border-zinc-700 pl-4">
            <button
              onClick={() => setZoom(Math.max(1, zoom / 1.5))}
              className="text-zinc-400 hover:text-white px-1"
            >
              -
            </button>
            <span className="text-[10px] text-zinc-500 w-8 text-center">
              {Math.round(zoom)}%
            </span>
            <button
              onClick={() => setZoom(Math.min(200, zoom * 1.5))}
              className="text-zinc-400 hover:text-white px-1"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => seekTo(0)}
            className="text-zinc-400 hover:text-white"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={togglePlay}
            className={`w-8 h-8 flex items-center justify-center rounded-full border ${isPlaying ? "bg-[#D2FF44] border-[#D2FF44]" : "border-[#D2FF44] text-[#D2FF44]"}`}
          >
            {isPlaying ? (
              <Pause size={16} fill="black" />
            ) : (
              <Play size={16} fill="#D2FF44" className="ml-0.5" />
            )}
          </button>
          <button
            onClick={() => seekTo(duration)}
            className="text-zinc-400 hover:text-white"
          >
            <SkipForward size={18} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVolume(volume === 0 ? 1 : 0)}
            className="text-zinc-400 hover:text-white"
          >
            {volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 bg-zinc-700 rounded-lg accent-[#D2FF44]"
          />
        </div>
      </div>

      {/* 2. SPLIT VIEW AREA */}
      <div className="flex-1 flex flex-col min-h-0 bg-[#121214] relative">
        {/* VIDEO SECTION */}
        <div
          style={{ height: `${videoHeightPct}%` }}
          className="flex flex-col border-b border-black min-h-[100px]"
        >
          {/* Sticky Ruler Container */}
          <div className="sticky top-0 z-30 flex h-8 bg-[#1a1a1c] border-b border-zinc-700 shrink-0">
            {/* Timecode Box */}
            <div
              className={`shrink-0 ${LEFT_PANEL_BG} border-r border-zinc-700 flex items-center justify-center`}
              style={{ width: LEFT_PANEL_W }}
            >
              <span className="font-mono text-xs text-[#D2FF44] font-bold tabular-nums">
                {formatTime(currentTime)}
              </span>
            </div>
            {/* Ruler */}
            <div
              className="flex-1 relative overflow-hidden cursor-ew-resize"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
            >
              <div
                style={{
                  transform: `translateX(-${scrollLeft}px)`,
                  width: contentWidthPx,
                  height: "100%",
                }}
              >
                <TimelineRuler seconds={timelineSeconds} zoom={zoom} />
                <Playhead time={currentTime} zoom={zoom} height="100%" />
              </div>
            </div>
          </div>

          {/* Video Tracks (Scrolls Vertically) */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {videoTrackIndices.map((idx) => (
              <TrackRow
                key={idx}
                trackIndex={idx}
                tracks={tracks}
                trackSettings={trackSettings}
                zoom={zoom}
                scrollLeft={scrollLeft}
                contentWidth={contentWidthPx}
                currentTime={currentTime}
                activeShotId={activeShotId}
                activeTool={activeTool}
                onRemoveItem={onRemoveItem}
                onUpdateItem={onUpdateItem}
                onShotClick={onShotClick}
                onSplit={onSplit}
                videoBlobs={videoBlobs}
                onRenameTrack={onRenameTrack}
                onDeleteTrack={onDeleteTrack}
                onToggleTrackLock={onToggleTrackLock}
                onToggleTrackVisibility={onToggleTrackVisibility}
                isAudio={false}
              />
            ))}
          </div>
        </div>

        {/* SPLITTER (Invisible-ish line) */}
        <div
          className="h-1 bg-[#121214] hover:bg-[#D2FF44] cursor-row-resize z-50 flex justify-center items-center shrink-0 border-y border-zinc-800"
          onPointerDown={handleSplitterDrag}
        />

        {/* AUDIO SECTION */}
        <div className="flex-1 flex flex-col min-h-[60px] overflow-hidden">
          {/* Audio Header */}
          <div className="h-6 bg-[#1a1a1c] border-b border-zinc-700 flex shrink-0">
            <div
              className={`shrink-0 ${LEFT_PANEL_BG} border-r border-zinc-700 flex items-center px-2`}
              style={{ width: LEFT_PANEL_W }}
            >
              <span className="text-[10px] text-zinc-500 font-bold">AUDIO</span>
            </div>
            <div className="flex-1 bg-[#121214]" />
          </div>

          {/* Audio Tracks (Scrolls Vertically) */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {audioTrackIndices.map((idx) => (
              <TrackRow
                key={idx}
                trackIndex={idx}
                tracks={tracks}
                trackSettings={trackSettings}
                zoom={zoom}
                scrollLeft={scrollLeft}
                contentWidth={contentWidthPx}
                currentTime={currentTime}
                activeShotId={activeShotId}
                activeTool={activeTool}
                onRemoveItem={onRemoveItem}
                onUpdateItem={onUpdateItem}
                onShotClick={onShotClick}
                onSplit={onSplit}
                videoBlobs={videoBlobs}
                onRenameTrack={onRenameTrack}
                onDeleteTrack={onDeleteTrack}
                onToggleTrackLock={onToggleTrackLock}
                onToggleTrackVisibility={onToggleTrackVisibility}
                isAudio={true}
              />
            ))}
          </div>
        </div>

        {/* MASTER SCROLLBAR */}
        <div
          className="h-4 bg-[#1a1a1c] border-t border-black overflow-x-auto shrink-0"
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        >
          <div style={{ width: contentWidthPx + LEFT_PANEL_W, height: 1 }} />
        </div>
      </div>
    </div>
  );
}
