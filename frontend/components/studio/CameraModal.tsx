"use client";

import { X, Video } from "lucide-react";

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (text: string) => void;
}

// We define the movements and their specific CSS transformations for the preview
const MOVEMENTS = [
  {
    label: "Pan Left",
    prompt: "camera panning left",
    // Move background right to left
    animation:
      "group-hover:translate-x-[-20%] transition-transform duration-[2000ms] ease-linear",
  },
  {
    label: "Pan Right",
    prompt: "camera panning right",
    // Move background left to right
    animation:
      "group-hover:translate-x-[20%] transition-transform duration-[2000ms] ease-linear",
  },
  {
    label: "Tilt Up",
    prompt: "camera tilting up",
    // Move background down to up
    animation:
      "group-hover:translate-y-[-20%] transition-transform duration-[2000ms] ease-linear",
  },
  {
    label: "Tilt Down",
    prompt: "camera tilting down",
    // Move background up to down
    animation:
      "group-hover:translate-y-[20%] transition-transform duration-[2000ms] ease-linear",
  },
  {
    label: "Zoom In",
    prompt: "slow zoom in",
    // Scale up
    animation:
      "group-hover:scale-125 transition-transform duration-[2000ms] ease-linear",
  },
  {
    label: "Zoom Out",
    prompt: "slow zoom out",
    // Scale down
    animation:
      "scale-125 group-hover:scale-100 transition-transform duration-[2000ms] ease-linear",
  },
  {
    label: "Static / Stable",
    prompt: "static camera, tripod shot",
    animation: "", // No movement
  },
  {
    label: "Handheld",
    prompt: "handheld camera movement, shaky footage",
    // A little wiggle
    animation: "group-hover:animate-pulse",
  },
];

export default function CameraModal({
  isOpen,
  onClose,
  onSelect,
}: CameraModalProps) {
  if (!isOpen) return null;

  const handleSelect = (prompt: string) => {
    onSelect(prompt);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#09090b] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-[#18181b] shrink-0">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Video size={16} className="text-[#D2FF44]" /> Camera Movement
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-xs text-zinc-500 mb-4 italic">
            Hover over a card to preview the motion. Click to apply.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {MOVEMENTS.map((move, i) => (
              <button
                key={i}
                onClick={() => handleSelect(move.prompt)}
                className="group relative aspect-square rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden hover:border-[#D2FF44] hover:shadow-[0_0_15px_rgba(210,255,68,0.15)] transition-all text-left"
              >
                {/* The "Scene" Background 
                    We use a grid pattern so movement is obvious
                */}
                <div className="absolute inset-0 overflow-hidden">
                  <div
                    className={`w-[140%] h-[140%] -ml-[20%] -mt-[20%] opacity-30 ${move.animation}`}
                    style={{
                      backgroundImage: `
                                linear-gradient(to right, #333 1px, transparent 1px),
                                linear-gradient(to bottom, #333 1px, transparent 1px)
                            `,
                      backgroundSize: "20px 20px",
                    }}
                  >
                    {/* A center object to help visualize zoom/pan */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 border-2 border-zinc-600 rounded-full flex items-center justify-center">
                      <div className="w-2 h-2 bg-zinc-600 rounded-full" />
                    </div>
                  </div>
                </div>

                {/* Overlay Label */}
                <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black via-black/80 to-transparent">
                  <div className="text-xs font-bold text-zinc-300 group-hover:text-[#D2FF44] transition-colors">
                    {move.label}
                  </div>
                  <div className="text-[10px] text-zinc-600 truncate group-hover:text-zinc-400">
                    {move.prompt}
                  </div>
                </div>

                {/* Hover Indicator */}
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#D2FF44] opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_0_8px_#D2FF44]" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
