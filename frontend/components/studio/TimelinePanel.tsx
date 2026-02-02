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
const NEON_YELLOW = "#D2FF44";

// --- WAVEFORM COMPONENT ---
const TimelineWaveform = memo(function TimelineWaveform({
  data,
  zoom,
  color = NEON_YELLOW,
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

    // Define the drawing logic
    const draw = () => {
      const SAMPLES_PER_SEC = 20;
      const totalDuration = data.length / SAMPLES_PER_SEC;

      // Calculate dimensions based on current DOM state
      const width = Math.max(1, totalDuration * zoom);
      const height = canvas.clientHeight || 64; // <--- Gets new height on resize

      const dpr = window.devicePixelRatio || 1;

      // Update canvas resolution to match display size
      canvas.width = width * dpr;
      canvas.height = height * dpr;

      // Normalize coordinate system
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;

      const pixelsPerSample = zoom / SAMPLES_PER_SEC;
      const barWidth = Math.max(0.5, pixelsPerSample);

      for (let i = 0; i < data.length; i++) {
        const x = i * pixelsPerSample;
        // Dynamically scale bar height to 80% of container height
        const barHeight = Math.max(2, data[i] * height * 0.8);
        const y = (height - barHeight) / 2;
        ctx.fillRect(x, y, barWidth, barHeight);
      }
    };

    // 1. Initial Draw
    draw();

    // 2. Add Observer to handle resizing events
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(draw);
    });
    observer.observe(canvas);

    return () => observer.disconnect();
  }, [data, zoom, color]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
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
  setGlobalSplitHover,
  globalSplitHover,
}: any) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id,
      data: { type: "timeline-item" },
      disabled: activeTool === "split" || locked,
    });

  const [isResizing, setIsResizing] = useState(false);
  const [localState, setLocalState] = useState({ width, left });
  const [hoverX, setHoverX] = useState<number | null>(null);

  // FIX #1: Safety Check - Prevent infinite loops by ignoring tiny changes
  useEffect(() => {
    if (!isResizing) {
      setLocalState((prev) => {
        // If the difference is less than 0.1px, don't trigger a re-render
        if (
          Math.abs(prev.width - width) < 0.1 &&
          Math.abs(prev.left - left) < 0.1
        ) {
          return prev;
        }
        return { width, left };
      });
    }
  }, [width, left, isResizing]);

  // Handle local hover for split tool
  const handlePointerMove = (e: React.PointerEvent) => {
    if (activeTool === "split" && !locked) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setHoverX(x);

      // Calculate absolute time to sync with pair
      const absTime = data.startTime + x / zoom;

      if (setGlobalSplitHover) {
        setGlobalSplitHover({
          time: absTime,
          pairId: data.pairId,
          sourceItemId: id,
        });
      }
    }
  };

  const handlePointerLeave = () => {
    setHoverX(null);
    if (activeTool === "split" && setGlobalSplitHover) {
      setGlobalSplitHover(null);
    }
  };

  // Resize Logic (Right) - FIXED
  const handleResizeStart = (e: React.PointerEvent) => {
    if (activeTool === "split" || locked) return;
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = localState.width;
    const startLeft = localState.left;

    // FIX #2: Allow resizing.
    // If sourceDuration exists, use it. Otherwise default to 1 hour (3600s) to allow expansion.
    const sourceDur = data.sourceDuration || data.maxDuration || 3600;
    const trimStart = data.trimStart || 0;
    const maxLen = Math.max(0, sourceDur - trimStart);
    const maxPx = maxLen * zoom;

    const onMove = (ev: PointerEvent) => {
      const diff = ev.clientX - startX;
      // Clamp between 10px and the maximum file length
      const newW = Math.max(10, Math.min(startWidth + diff, maxPx));

      // ONLY update local visual state. DO NOT call onUpdate here.
      setLocalState((prev) => ({ ...prev, width: newW }));
    };

    const onUp = (ev: PointerEvent) => {
      // Clean up first
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setIsResizing(false);

      const diff = ev.clientX - startX;
      const newW = Math.max(10, Math.min(startWidth + diff, maxPx));

      // FIX #3: Save to database ONLY when mouse is released
      onUpdate({ startTime: startLeft / zoom, duration: newW / zoom });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Resize Logic (Left)
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
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
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
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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

  // Determine if we should show the red split line
  let showSplitLine = false;
  let splitLineX = 0;

  if (activeTool === "split" && !locked) {
    if (hoverX !== null) {
      showSplitLine = true;
      splitLineX = hoverX;
    } else if (
      globalSplitHover &&
      data.pairId &&
      globalSplitHover.pairId === data.pairId
    ) {
      // Calculate relative X based on global time
      const relativeTime = globalSplitHover.time - data.startTime;
      if (relativeTime >= 0 && relativeTime <= (data.duration || 4)) {
        showSplitLine = true;
        splitLineX = relativeTime * zoom;
      }
    }
  }

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
      className={`absolute top-0 bottom-0 group select-none ${activeTool === "split" ? "cursor-none" : "cursor-grab active:cursor-grabbing"}`}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div
        className={`absolute inset-0 flex flex-col overflow-hidden border rounded-sm ${isAudioTrack ? "bg-[#1a1a1c] border-white/10" : "bg-[#375a6c] border-[#213845]"}`}
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
                  color={NEON_YELLOW}
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

        {/* --- CUSTOM SPLIT CURSOR (Solid Red Line) --- */}
        {showSplitLine && (
          <div
            className="absolute top-0 bottom-0 w-px bg-red-500 z-[60] pointer-events-none"
            style={{ left: splitLineX }}
          />
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
  setGlobalSplitHover,
  globalSplitHover,
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
          setGlobalSplitHover={setGlobalSplitHover}
          globalSplitHover={globalSplitHover}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENTS
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
      style={{ height: height, transform: `translateX(${time * zoom}px)` }}
    >
      {showHandle && (
        <div className="absolute -top-2 -left-1.5 w-3 h-3 bg-red-500 rotate-45" />
      )}
    </div>
  );
});

const TrackRow = memo(function TrackRow({
  trackIndex,
  tracks,
  trackSettings,
  zoom,
  scrollLeft,
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
  onResizeTrack,
  isAudio,
  currentTime,
  setGlobalSplitHover,
  globalSplitHover,
}: any) {
  const defaultHeight = 48;
  const settings = trackSettings?.[trackIndex] || {
    locked: false,
    visible: true,
    name: `Track ${trackIndex + 1}`,
    height: defaultHeight,
  };

  const [localHeight, setLocalHeight] = useState(
    settings.height || defaultHeight,
  );
  const [isResizing, setIsResizing] = useState(false);

  // Sync state when props change (and not dragging)
  useEffect(() => {
    if (!isResizing) {
      setLocalHeight(settings.height || defaultHeight);
    }
    // FIX: Only re-run if the PARENT settings actually change.
    // We removed 'isResizing' from the list below so it doesn't snap back
    // immediately when you stop dragging.
  }, [settings.height]);

  // --- RESIZE LOGIC ---
  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startY = e.clientY;
    const startHeight = localHeight;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;

      let newHeight;
      if (isAudio) {
        // AUDIO: Dragging DOWN (positive delta) INCREASES height
        newHeight = startHeight + deltaY;
      } else {
        // VIDEO: Dragging UP (negative delta) INCREASES height
        newHeight = startHeight - deltaY;
      }

      // Constrain height
      const clamped = Math.max(32, Math.min(400, newHeight));
      setLocalHeight(clamped);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      const deltaY = upEvent.clientY - startY;

      let finalHeight;
      if (isAudio) {
        finalHeight = startHeight + deltaY;
      } else {
        finalHeight = startHeight - deltaY;
      }

      const clamped = Math.max(32, Math.min(400, finalHeight));

      setIsResizing(false);
      if (onResizeTrack) {
        onResizeTrack(trackIndex, clamped);
      }

      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    document.body.style.cursor = "row-resize";
  };

  return (
    <div
      className="flex border-b border-zinc-800 bg-[#151517] relative shrink-0"
      style={{ height: localHeight }}
    >
      {/* LEFT HEADER */}
      <div
        className={`shrink-0 flex flex-col p-2 gap-1 justify-between relative group ${LEFT_PANEL_BG} ${LEFT_PANEL_BORDER}`}
        style={{ width: LEFT_PANEL_W }}
      >
        {/* --- VIDEO RESIZE HANDLE (TOP) --- */}
        {!isAudio && (
          <div
            onPointerDown={handleResizeStart}
            className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize hover:bg-[#D2FF44] transition-colors z-50 opacity-0 group-hover:opacity-100"
            title="Drag to resize video track"
          />
        )}

        <div className="flex justify-between items-center text-zinc-400 mt-1">
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

        {/* --- AUDIO RESIZE HANDLE (BOTTOM) --- */}
        {isAudio && (
          <div
            onPointerDown={handleResizeStart}
            className="absolute bottom-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-[#D2FF44] transition-colors z-50"
            title="Drag to resize audio track"
          />
        )}
      </div>

      {/* RIGHT TRACK CONTENT */}
      <div className="flex-1 relative overflow-hidden bg-[#121214]">
        <div
          style={{
            transform: `translateX(-${scrollLeft}px)`,
            width: contentWidth,
            height: "100%",
          }}
          className="will-change-transform relative"
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
            setGlobalSplitHover={setGlobalSplitHover}
            globalSplitHover={globalSplitHover}
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
  onStop?: () => void;
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
  onStop,
}: TimelinePanelProps) {
  const [activeTool, setActiveTool] = useState<"select" | "split">("select");
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [prevVolume, setPrevVolume] = useState(1);
  const [globalSplitHover, setGlobalSplitHover] = useState<{
    time: number;
    pairId: string;
    sourceItemId: string;
  } | null>(null);

  const isHovering = useRef(false);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const videoScrollRef = useRef<HTMLDivElement>(null);
  const audioScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // We use a small timeout to ensure the DOM layout (flex-grow)
    // has finished calculating the full height before we scroll.
    const timer = setTimeout(() => {
      if (videoScrollRef.current) {
        videoScrollRef.current.scrollTop = videoScrollRef.current.scrollHeight;
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // 1. Keep a "Ref" of the current time for keyboard listeners
  const timeRef = useRef(currentTime);

  // Sync the Ref whenever the real time updates
  useEffect(() => {
    timeRef.current = currentTime;
  }, [currentTime]);

  // KEYBOARD SHORTCUTS (Undo/Redo/Tools)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isHovering.current) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const key = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (onRedo && canRedo) onRedo();
        } else {
          if (onUndo && canUndo) onUndo();
        }
        return;
      }

      if (key === "a") setActiveTool("select");
      else if (key === "b") setActiveTool("split");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onUndo, onRedo, canUndo, canRedo]);

  // KEYBOARD SCRUBBING (Left/Right Arrows)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Safety: Don't scrub if typing in a text box
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const FRAME_STEP = 1 / 30; // Approx 1 frame
      const LARGE_STEP = 1.0; // 1 second

      let delta = 0;

      if (e.key === "ArrowLeft") {
        delta = e.shiftKey ? -LARGE_STEP : -FRAME_STEP;
      } else if (e.key === "ArrowRight") {
        delta = e.shiftKey ? LARGE_STEP : FRAME_STEP;
      } else {
        return; // Ignore other keys
      }

      e.preventDefault(); // Stop window scrolling

      // Calculate new time using the Ref
      const newTime = Math.max(0, timeRef.current + delta);
      seekTo(newTime);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [seekTo]);

  // Volume Handlers
  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (newVol > 0) {
      setIsMuted(false);
      setPrevVolume(newVol);
    }
    if (onVolumeChange) onVolumeChange(newVol);
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      setVolume(prevVolume);
      if (onVolumeChange) onVolumeChange(prevVolume);
    } else {
      setPrevVolume(volume);
      setIsMuted(true);
      setVolume(0);
      if (onVolumeChange) onVolumeChange(0);
    }
  };

  // Drag grab line
  const handleGrabScroll = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const mainContainer = mainScrollRef.current;
    if (!mainContainer) return;
    const startScroll = mainContainer.scrollTop;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;
      mainContainer.scrollTop = startScroll - deltaY;
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    document.body.style.cursor = "ns-resize";
  };

  // Smart Sync Handlers
  const handleSmartUpdate = (id: string, updates: any) => {
    onUpdateItem(id, updates);
    let sourceItem: any = null;
    for (const track of tracks) {
      const found = track.find((i: any) => i.timelineId === id);
      if (found) {
        sourceItem = found;
        break;
      }
    }
    if (sourceItem?.pairId) {
      for (const track of tracks) {
        const pair = track.find(
          (i) => i.pairId === sourceItem.pairId && i.timelineId !== id,
        );
        if (pair) onUpdateItem(pair.timelineId, updates);
      }
    }
  };

  const handleSmartSplit = (itemId: string, time: number) => {
    if (onSplit) onSplit(itemId, time);
    let sourceItem: any = null;
    for (const track of tracks) {
      const found = track.find((i: any) => i.timelineId === itemId);
      if (found) {
        sourceItem = found;
        break;
      }
    }

    if (sourceItem?.pairId && onSplit) {
      for (const track of tracks) {
        const pair = track.find(
          (i) => i.pairId === sourceItem.pairId && i.timelineId !== itemId,
        );
        if (
          pair &&
          time > pair.startTime &&
          time < pair.startTime + (pair.duration || 0)
        ) {
          onSplit(pair.timelineId, time);
        }
      }
    }
  };

  const formatTime = (seconds: number) => {
    const adjusted = seconds + 3600;
    const h = Math.floor(adjusted / 3600);
    const m = Math.floor((adjusted % 3600) / 60);
    const s = Math.floor(adjusted % 60);
    const f = Math.floor((adjusted % 1) * 30);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
  };

  const handleScrub = (e: React.PointerEvent) => {
    // Prevent default browser dragging of text/images
    e.preventDefault();

    // 1. Get the ruler container and its position
    const container = e.currentTarget as HTMLDivElement;
    const rect = container.getBoundingClientRect();

    // Helper: Calculate time based on mouse X position
    const calculateTime = (clientX: number) => {
      // (Mouse X - Ruler Start + Scrolled Amount) / Zoom
      const x = clientX - rect.left + scrollLeft;
      // Prevent negative time
      return Math.max(0, x / zoom);
    };

    // 2. Jump to position immediately on click
    seekTo(calculateTime(e.clientX));

    // 3. Setup dragging listeners
    const onMove = (ev: PointerEvent) => {
      seekTo(calculateTime(ev.clientX));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    // Attach to window so you can drag outside the ruler area comfortably
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const timelineSeconds = Math.max(duration + 120, 600);
  const contentWidthPx = timelineSeconds * zoom;

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
      className="h-full w-full bg-[#1e1e20] flex flex-col font-sans select-none border-t border-black overflow-hidden relative"
      onMouseEnter={() => (isHovering.current = true)}
      onMouseLeave={() => (isHovering.current = false)}
    >
      {/* --- TOP TOOLBAR: TRANSPORT & VOLUME --- */}
      <div className="h-10 border-b border-black/40 bg-[#262629] shrink-0 relative flex items-center justify-center z-20">
        {/* CENTER: Transport Controls */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => seekTo(0)}
            className="text-zinc-400 hover:text-white"
            title="Go to Start"
          >
            <SkipBack size={16} />
          </button>

          {/* Play/Pause Toggle */}
          <button
            onClick={togglePlay}
            className={`text-zinc-400 hover:text-white ${isPlaying ? "text-[#D2FF44]" : ""}`}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
          </button>

          <button
            onClick={() => seekTo(duration)}
            className="text-zinc-400 hover:text-white"
            title="Go to End"
          >
            <SkipForward size={16} />
          </button>
        </div>

        {/* RIGHT: Volume (Absolute Position) */}
        <div className="absolute right-4 flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="text-zinc-400 hover:text-white"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted || volume === 0 ? (
              <VolumeX size={16} />
            ) : (
              <Volume2 size={16} />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="w-20 h-1 accent-[#D2FF44] bg-zinc-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      {/* --- BOTTOM TOOLBAR: TRACKS, TOOLS, UNDO, ZOOM --- */}
      <div className="h-10 border-b border-black/40 bg-[#262629] shrink-0 flex items-center px-4 justify-between z-20">
        <div className="flex items-center gap-3">
          {/* Add Tracks */}
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

          <div className="w-px h-4 bg-zinc-700 mx-1" />

          {/* Tools */}
          <button
            onClick={() => setActiveTool("select")}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${
              activeTool === "select"
                ? "bg-[#D2FF44] text-black font-bold"
                : "bg-zinc-800 text-zinc-300"
            }`}
            title="Select Tool (A)"
          >
            <MousePointer2 size={10} /> Select
          </button>
          <button
            onClick={() => setActiveTool("split")}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${
              activeTool === "split"
                ? "bg-[#D2FF44] text-black font-bold"
                : "bg-zinc-800 text-zinc-300"
            }`}
            title="Split Tool (B)"
          >
            <Scissors size={10} /> Split
          </button>

          <div className="w-px h-4 bg-zinc-700 mx-1" />

          {/* Undo/Redo */}
          <div className="flex items-center gap-1">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className={`p-1 rounded ${canUndo ? "text-zinc-300 hover:bg-zinc-700 hover:text-white" : "text-zinc-600 cursor-not-allowed"}`}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className={`p-1 rounded ${canRedo ? "text-zinc-300 hover:bg-zinc-700 hover:text-white" : "text-zinc-600 cursor-not-allowed"}`}
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 size={14} />
            </button>
          </div>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-1 border-l border-zinc-700 pl-4">
          <button
            onClick={() => setZoom(Math.max(1, zoom / 1.5))}
            className="text-zinc-400 hover:text-white"
          >
            -
          </button>
          <span className="text-[10px] text-zinc-500 w-8 text-center">
            {Math.round(zoom)}%
          </span>
          <button
            onClick={() => setZoom(Math.min(200, zoom * 1.5))}
            className="text-zinc-400 hover:text-white"
          >
            +
          </button>
        </div>
      </div>

      {/* RULER */}
      <div className="z-30 flex h-8 bg-[#1a1a1c] border-b border-zinc-700 shrink-0">
        <div
          className={`shrink-0 ${LEFT_PANEL_BG} border-r border-zinc-700 flex items-center justify-center`}
          style={{ width: LEFT_PANEL_W }}
        >
          <span className="font-mono text-xs text-[#D2FF44]">
            {formatTime(currentTime)}
          </span>
        </div>
        <div
          className="flex-1 relative overflow-hidden"
          onPointerDown={handleScrub}
        >
          <div
            style={{
              transform: `translateX(-${scrollLeft}px)`,
              width: contentWidthPx,
              height: "100%",
            }}
          >
            <TimelineRuler seconds={timelineSeconds} zoom={zoom} />
            <Playhead time={currentTime} zoom={zoom} />
          </div>
        </div>
      </div>

      {/* MAIN CONTAINER */}
      <div
        ref={mainScrollRef}
        className="flex-1 relative flex flex-col overflow-hidden"
        style={{
          background: `linear-gradient(to right, #2c2f33 ${LEFT_PANEL_W}px, #121214 ${LEFT_PANEL_W}px)`,
        }}
      >
        {/* VIDEO SECTION */}
        <div
          ref={videoScrollRef}
          className="flex flex-col relative overflow-y-auto overflow-x-hidden timeline-scrollbar w-full"
          style={{ flex: "0 0 60%" }} // Increased to 60% for better drag-scroll
        >
          {/* Spacer glue (pushes real tracks to bottom) */}
          <div className="flex-grow" />

          {/* BLANK VIDEO TRACK (Top Buffer) - Styled to match tracks */}
          <div className="flex border-b border-zinc-800 bg-[#151517] shrink-0 h-24">
            <div
              className={`shrink-0 ${LEFT_PANEL_BG} ${LEFT_PANEL_BORDER}`}
              style={{ width: LEFT_PANEL_W }}
            />
            <div className="flex-1 bg-[#121214]" />
          </div>

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
              onUpdateItem={handleSmartUpdate}
              onShotClick={onShotClick}
              onSplit={handleSmartSplit}
              videoBlobs={videoBlobs}
              onRenameTrack={onRenameTrack}
              onDeleteTrack={onDeleteTrack}
              onToggleTrackLock={onToggleTrackLock}
              onToggleTrackVisibility={onToggleTrackVisibility}
              isAudio={false}
              setGlobalSplitHover={setGlobalSplitHover}
              globalSplitHover={globalSplitHover}
            />
          ))}
        </div>

        {/* GRAB LINE */}
        <div
          onPointerDown={handleGrabScroll}
          className="h-2 flex items-center justify-center group cursor-ns-resize z-50 shrink-0 bg-[#1a1a1c]"
        >
          <div className="w-full h-[2px] bg-zinc-700 group-hover:bg-[#D2FF44] transition-colors" />
        </div>

        {/* AUDIO SECTION */}
        <div
          ref={audioScrollRef}
          className="flex flex-col relative overflow-y-auto overflow-x-hidden timeline-scrollbar w-full"
          style={{ flex: "0 0 70%" }} // Increased to 70% to allow deeper main scrolling
        >
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
              onUpdateItem={handleSmartUpdate}
              onShotClick={onShotClick}
              onSplit={handleSmartSplit}
              videoBlobs={videoBlobs}
              onRenameTrack={onRenameTrack}
              onDeleteTrack={onDeleteTrack}
              onToggleTrackLock={onToggleTrackLock}
              onToggleTrackVisibility={onToggleTrackVisibility}
              isAudio={true}
              setGlobalSplitHover={setGlobalSplitHover}
              globalSplitHover={globalSplitHover}
            />
          ))}

          {/* BLANK AUDIO TRACK (Bottom Buffer) - Increased to h-24 (96px) */}
          <div className="flex border-b border-zinc-800 bg-[#151517] shrink-0 h-24">
            <div
              className={`shrink-0 ${LEFT_PANEL_BG} ${LEFT_PANEL_BORDER}`}
              style={{ width: LEFT_PANEL_W }}
            />
            <div className="flex-1 bg-[#121214]" />
          </div>
        </div>
      </div>

      {/* GLOBAL PLAYHEAD OVERLAY */}
      {/* 40px Top + 40px Bottom Toolbar + 32px Ruler = 112px Top offset */}
      <div
        className="absolute top-[112px] bottom-4 right-0 z-[60] pointer-events-none overflow-hidden"
        style={{ left: LEFT_PANEL_W }}
      >
        <div
          className="h-full relative will-change-transform"
          style={{ transform: `translateX(-${scrollLeft}px)` }}
        >
          <Playhead
            time={currentTime}
            zoom={zoom}
            height="100%"
            showHandle={false}
          />
        </div>
      </div>

      {/* FOOTER SCROLLBAR */}
      <div className="shrink-0 h-4 flex z-20 bg-[#1a1a1c] border-t border-black">
        <div
          className={`shrink-0 ${LEFT_PANEL_BG} ${LEFT_PANEL_BORDER}`}
          style={{ width: LEFT_PANEL_W }}
        />
        <div
          className="flex-1 overflow-x-auto"
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        >
          <div style={{ width: contentWidthPx, height: 1 }} />
        </div>
      </div>
    </div>
  );
}
