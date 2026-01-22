"use client";

import { Play, Pause } from "lucide-react";
import { memo } from "react";

interface ViewerPanelProps {
  streamUrl: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  // Legacy props kept to avoid build errors if parents pass them
  activeShot?: any;
  showGhost?: boolean;
  setShowGhost?: any;
  prevShot?: any;
  primaryVideoRef?: any;
  secondaryVideoRef?: any;
  activePlayer?: any;
}

const ViewerPanel = memo(function ViewerPanel({
  streamUrl,
  isPlaying,
  onTogglePlay,
  primaryVideoRef,
}: ViewerPanelProps) {
  // ✅ Fix: ignore query params when checking extension
  const cleanUrl = (streamUrl || "").split("?")[0];
  const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(cleanUrl);

  return (
    <div className="h-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
      {/* STREAM VIEWPORT */}
      <div className="relative w-full h-full flex items-center justify-center bg-zinc-950">
        {streamUrl && isPlaying ? (
          isVideo ? (
            <video
              ref={primaryVideoRef}
              src={streamUrl}
              className="w-full h-full object-contain"
              autoPlay
            />
          ) : (
            <img
              src={streamUrl}
              className="w-full h-full object-contain"
              alt="Stream"
            />
          )
        ) : (
          // STATIC PLACEHOLDER
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-600 z-0">
            <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Play fill="currentColor" className="ml-1" size={24} />
            </div>
            <p className="text-xs font-mono uppercase tracking-widest opacity-50">
              Engine Ready
            </p>
          </div>
        )}
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
