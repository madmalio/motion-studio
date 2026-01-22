"use client";

import { Play, Pause } from "lucide-react";
import { memo } from "react";

interface ViewerPanelProps {
  streamUrl?: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  // Legacy props kept to avoid build errors if parents pass them
  activeShot?: any;
  showGhost?: boolean;
  setShowGhost?: any;
  prevShot?: any;
  primaryVideoRef?: React.RefObject<HTMLVideoElement | null>;
  secondaryVideoRef?: React.RefObject<HTMLVideoElement | null>;
  activePlayer?: any;
}

const ViewerPanel = memo(function ViewerPanel({
  streamUrl,
  isPlaying,
  onTogglePlay,
  primaryVideoRef,
  secondaryVideoRef,
}: ViewerPanelProps) {
  return (
    <div className="h-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
      {/* STREAM VIEWPORT */}
      <div className="relative w-full h-full flex items-center justify-center bg-zinc-950">
        <video
          ref={primaryVideoRef as React.RefObject<HTMLVideoElement>}
          className="absolute inset-0 w-full h-full object-contain bg-black"
          style={{ opacity: 0, zIndex: 0 }}
        />
        <video
          ref={secondaryVideoRef as React.RefObject<HTMLVideoElement>}
          className="absolute inset-0 w-full h-full object-contain bg-black"
          style={{ opacity: 0, zIndex: 0 }}
        />
      </div>

      {/* FLOATING CONTROLS */}
      <div className="absolute bottom-6 flex gap-2 z-20">
        <button
          onClick={onTogglePlay}
          className="w-14 h-14 bg-[#D2FF44] hover:bg-white rounded-full flex items-center justify-center transition-all shadow-[0_0_30px_rgba(210,255,68,0.3)] hover:scale-105 active:scale-95"
        >
          {isPlaying ? (
            <Pause fill="black" size={20} />
          ) : (
            <Play fill="black" className="ml-1" size={20} />
          )}
        </button>
      </div>
    </div>
  );
});

export default ViewerPanel;
