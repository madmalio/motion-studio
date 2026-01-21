"use client";

import { Ghost, ImageIcon, MonitorPlay, Film } from "lucide-react";
import { RefObject } from "react";

interface ViewerPanelProps {
    primaryVideoRef: RefObject<HTMLVideoElement | null>;
    secondaryVideoRef: RefObject<HTMLVideoElement | null>;
    activePlayer: "primary" | "secondary";

    // Ghosting stuff
    activeShot: any;
    showGhost: boolean;
    setShowGhost: (show: boolean) => void;
    prevShot: any;
}

export default function ViewerPanel({
    primaryVideoRef,
    secondaryVideoRef,
    activePlayer,
    activeShot,
    showGhost,
    setShowGhost,
    prevShot,
}: ViewerPanelProps) {
    return (
        <div className="h-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
            {/* Top Toolbar */}
            <div className="absolute top-4 flex gap-2 z-10 bg-zinc-900/80 backdrop-blur rounded-full px-2 py-1 border border-zinc-800">
                <button
                    onClick={() => setShowGhost(!showGhost)}
                    className={`p-1.5 rounded-full transition-all ${showGhost ? "bg-[#D2FF44] text-black" : "text-zinc-400 hover:text-white"}`}
                    title="Toggle Onion Skinning (Ghosting)"
                >
                    <Ghost size={14} />
                </button>
            </div>

            {/* Main Viewport */}
            <div className="relative w-full h-full flex items-center justify-center p-8">

                {/* Placeholder if no shot */}
                {!activeShot && (
                    <div className="text-zinc-700 flex flex-col items-center gap-4">
                        <Film size={48} strokeWidth={1} />
                        <p className="text-sm font-mono uppercase tracking-widest">No Signal</p>
                    </div>
                )}

                {/* VIDEO LAYERS (Double Buffer) */}
                {/* 1. Primary */}
                <video
                    ref={primaryVideoRef}
                    className={`
                absolute max-w-[90%] max-h-[90%] object-contain shadow-2xl transition-opacity duration-100 ease-linear
                ${activePlayer === "primary" ? "opacity-100 z-10" : "opacity-0 z-0"}
             `}
                    muted // Muted for now to avoid autoplay policies? User should unmute
                />

                {/* 2. Secondary */}
                <video
                    ref={secondaryVideoRef}
                    className={`
                absolute max-w-[90%] max-h-[90%] object-contain shadow-2xl transition-opacity duration-100 ease-linear
                ${activePlayer === "secondary" ? "opacity-100 z-10" : "opacity-0 z-0"}
             `}
                    muted
                />

                {/* Fallback Image (Only if video is not playing/available and we have a preview) */}
                {/* Note: In gapless playback, we usually hide this if a video is present. 
            For this simplified version, we'll let the video elements handle display. 
            If they are empty src, they might be transparent.
        */}

                {/* Ghost Overlay */}
                {showGhost && prevShot?.previewBase64 && (
                    <img
                        src={prevShot.previewBase64}
                        className="absolute max-w-[90%] max-h-[90%] object-contain opacity-30 pointer-events-none z-20 mix-blend-overlay grayscale"
                    />
                )}
            </div>
        </div>
    );
}
