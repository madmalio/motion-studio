"use client";

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
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  activePlayer?: any;
}

const ViewerPanel = memo(function ViewerPanel({
  streamUrl,
  primaryVideoRef,
  secondaryVideoRef,
  canvasRef,
}: ViewerPanelProps) {
  return (
    <div className="h-full bg-black flex flex-col items-center justify-center relative overflow-hidden">
      {/* STREAM VIEWPORT */}
      <div className="relative w-full h-full flex items-center justify-center bg-zinc-950">
        {/* ✅ CANVAS RENDERER (Visible) */}
        <canvas
          ref={canvasRef as React.RefObject<HTMLCanvasElement>}
          width={1920}
          height={1080}
          className="absolute inset-0 w-full h-full object-contain z-10"
        />

        {/* HIDDEN SOURCE PLAYERS */}
        <video
          ref={primaryVideoRef as React.RefObject<HTMLVideoElement>}
          className="absolute inset-0 w-full h-full object-contain opacity-0 pointer-events-none"
          preload="auto"
        />
        <video
          ref={secondaryVideoRef as React.RefObject<HTMLVideoElement>}
          className="absolute inset-0 w-full h-full object-contain opacity-0 pointer-events-none"
          preload="auto"
        />
      </div>
    </div>
  );
});

export default ViewerPanel;
