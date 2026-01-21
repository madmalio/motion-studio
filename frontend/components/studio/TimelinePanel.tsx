"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Play, Pause, SkipBack, SkipForward, Plus, Lock, Eye, Trash2 } from "lucide-react";
import { useRef, useEffect, useState } from "react";

interface TimelinePanelProps {
    tracks: any[][]; // Array of tracks
    shots: any[];
    onRemoveItem: (id: string) => void;
    onAddTrack: () => void;
    // Playback Props
    isPlaying: boolean;
    togglePlay: () => void;
    currentTime: number;
    duration: number;
    seekTo: (time: number) => void;
}

export default function TimelinePanel({
    tracks,
    shots,
    onRemoveItem,
    onAddTrack,
    isPlaying,
    togglePlay,
    currentTime,
    duration,
    seekTo,
}: TimelinePanelProps) {

    // Format Timecode
    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const f = Math.floor((seconds % 1) * 30); // 30fps
        return `01:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
    };

    // Scrubber Logic
    const timelineRef = useRef<HTMLDivElement>(null);
    const [isScrubbing, setIsScrubbing] = useState(false);

    // Zoom State: Pixels per Second. Default 10 looks "normal", 50 is "zoomed in".
    const [zoom, setZoom] = useState(10);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (!timelineRef.current) return;
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
        if (!timelineRef.current) return;
        const rect = timelineRef.current.getBoundingClientRect();

        // Calculate relative to content start (considering scroll)
        // e.clientX is viewport x. rect.left is container left.
        // The ruler starts at 96px inside the container.
        const scrollLeft = timelineRef.current.scrollLeft;
        const mouseXInContainer = e.clientX - rect.left + scrollLeft;
        const trackContentX = mouseXInContainer - 96; // 96 is header width

        const t = Math.max(0, trackContentX / zoom);
        seekTo(t);
    };

    // RULER CLICK
    const onRulerClick = (e: React.MouseEvent) => {
        // Handled by pointer events on ruler
    };

    return (
        <div className="h-full w-full bg-[#1e1e20] flex flex-col font-sans select-none border-t border-black">

            {/* 1. CONTROL BAR (CENTERED) */}
            <div className="h-10 border-b border-black/40 flex items-center px-4 bg-[#262629] shrink-0 justify-between relative">

                <div className="flex items-center gap-2">
                    <button onClick={onAddTrack} className="flex items-center gap-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-300">
                        <Plus size={10} /> Add Track
                    </button>
                    {/* ZOOM CONTROLS */}
                    <div className="flex items-center gap-1 ml-4 border-l border-zinc-700 pl-4">
                        <button onClick={() => setZoom(z => Math.max(1, z / 1.5))} className="text-zinc-400 hover:text-white text-xs px-1">-</button>
                        <span className="text-[10px] text-zinc-500 w-8 text-center">{Math.round(zoom)}%</span>
                        <button onClick={() => setZoom(z => Math.min(200, z * 1.5))} className="text-zinc-400 hover:text-white text-xs px-1">+</button>
                    </div>
                </div>

                <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-4">
                    <button onClick={() => seekTo(0)} className="text-zinc-400 hover:text-white" title="Go to Start"><SkipBack size={18} /></button>
                    <button
                        onClick={togglePlay}
                        className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${isPlaying ? "bg-[#D2FF44] text-black scale-110" : "bg-white text-black hover:bg-gray-200"}`}
                    >
                        {isPlaying ? <Pause size={16} fill="black" /> : <Play size={16} fill="black" className="ml-0.5" />}
                    </button>
                    <button onClick={() => seekTo(duration)} className="text-zinc-400 hover:text-white" title="Go to End"><SkipForward size={18} /></button>
                </div>

                <div className="font-mono text-lg text-[#D2FF44] tabular-nums">
                    {formatTime(currentTime)}
                </div>
            </div>

            {/* 2. TIMELINE AREA */}
            <div className="flex-1 flex flex-col relative min-h-0">

                {/* RULER + TRACKS SCROLL CONTAINER */}
                <div
                    className="flex-1 overflow-auto bg-[#121214] relative"
                    ref={timelineRef}
                >
                    {/* RULER */}
                    <div
                        className="h-8 bg-[#1a1a1c] border-b border-zinc-700 sticky top-0 z-20 flex cursor-ew-resize"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerLeave={handlePointerUp}
                    >
                        <div className="w-24 shrink-0 bg-[#262629] border-r border-zinc-700 sticky left-0 z-30"></div>
                        <div className="flex-1 relative" style={{ minWidth: `${Math.max(duration, 60) * zoom}px` }}>
                            {/* TICKS */}
                            {Array.from({ length: Math.ceil(Math.max(duration, 60)) }).map((_, i) => (
                                <div key={i} className="absolute top-0 bottom-0 border-l border-zinc-700 text-[9px] text-zinc-500 pl-1" style={{ left: `${i * zoom}px` }}>
                                    {i % 5 === 0 ? `00:${i.toString().padStart(2, '0')}` : ''}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* TRACKS */}
                    <div className="relative min-h-full pb-10" style={{ minWidth: `${Math.max(duration, 60) * zoom + 96}px` }}>

                        {/* PLAYHEAD LINE (Absolute over tracks) */}
                        <div
                            className="absolute top-0 bottom-0 w-px bg-red-500 z-40 pointer-events-none"
                            style={{ left: `${96 + (currentTime * zoom)}px` }}
                        >
                            <div className="absolute -top-3 -left-1.5 w-3 h-3 bg-red-500 rotate-45"></div>
                            {/* Scrubber Handle */}
                            <div className="absolute -top-4 -left-1.5 w-3 h-3 bg-red-500 rotate-45"></div>
                        </div>

                        {tracks.map((track, trackIndex) => (
                            <div key={trackIndex} className="flex h-24 border-b border-zinc-800 relative group">
                                {/* HEADER */}
                                <div className="w-24 shrink-0 bg-[#262629] border-r border-zinc-800 flex flex-col p-2 gap-1 z-10 sticky left-0">
                                    <div className="flex justify-between items-center text-zinc-400">
                                        <span className="font-bold text-xs">V{trackIndex + 1}</span>
                                        <div className="flex gap-1">
                                            <Lock size={12} className="cursor-pointer hover:text-white" />
                                            <Eye size={12} className="cursor-pointer hover:text-white" />
                                        </div>
                                    </div>
                                </div>

                                {/* TRACK DROP ZONE */}
                                <div className="flex-1 relative bg-[#151517]">
                                    <TrackDroppable id={`track-${trackIndex}`} items={track} trackIndex={trackIndex} onRemoveItem={onRemoveItem} zoom={zoom} />
                                </div>
                            </div>
                        ))}

                        {/* CLICK TO ADD TRACK HINT */}
                        {tracks.length === 0 && (
                            <div className="p-10 text-center text-zinc-600 italic">No tracks. Add a track to start.</div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}

// Droppable Wrapper for a single track
function TrackDroppable({ id, items, trackIndex, onRemoveItem, zoom }: any) {
    const { setNodeRef } = useDroppable({
        id: id,
        data: { type: "track", trackIndex },
    });

    return (
        <div ref={setNodeRef} className="absolute inset-0 w-full h-full min-h-[50px]">
            <SortableContext items={items} strategy={horizontalListSortingStrategy}>
                {items.map((item: any) => (
                    <SortableTimelineItem
                        key={item.timelineId}
                        id={item.timelineId}
                        data={{ ...item, type: 'timeline-item', trackIndex }}
                        width={(item.duration || 4) * zoom}
                        onRemove={() => onRemoveItem(item.timelineId)}
                    />
                ))}
            </SortableContext>
        </div>
    )
}


function SortableTimelineItem({ id, data, width, onRemove }: any) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        width: `${width}px`
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            className={`
        relative group flex-shrink-0 h-full flex flex-col overflow-hidden select-none bg-[#375a6c] border border-[#213845] rounded-sm
        ${style.transform ? "z-20 cursor-grabbing shadow-xl ring-2 ring-white" : "z-10 cursor-grab"}
      `}
        >
            {/* Thumbnails */}
            <div className="flex-1 relative overflow-hidden flex opacity-100 mix-blend-normal">
                {/* DaVinci typically shows start/end frames or filmstrip. We'll show one cover for now. */}
                <img src={data.previewBase64} className="h-full w-20 object-cover opacity-80" />
                <div className="flex-1 bg-[#375a6c]"></div>
                <img src={data.previewBase64} className="h-full w-20 object-cover opacity-80" />
            </div>

            {/* Label Strip */}
            <div className="absolute bottom-0 w-full bg-[#20343e] px-2 py-0.5 text-[10px] text-zinc-300 truncate font-mono">
                {data.name}
            </div>

            {/* Selection Overlay */}
            <div className={`absolute inset-0 ring-inset ring-2 pointer-events-none transition-all ${data.isActive ? "ring-orange-500" : "ring-transparent group-hover:ring-white/30"}`}></div>

            <button
                onPointerDown={(e) => { e.stopPropagation(); onRemove(); }}
                className="absolute top-1 right-1 text-zinc-400 hover:text-red-400 opacity-0 group-hover:opacity-100"
            >
                <Trash2 size={12} />
            </button>
        </div>
    );
}
