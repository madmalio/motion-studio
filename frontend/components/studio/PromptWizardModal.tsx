"use client";

import { X, Wand2, Sparkles, Zap, Aperture } from "lucide-react";
import { useState } from "react";

interface PromptWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (text: string) => void;
}

const CATEGORIES = [
  {
    id: "style",
    label: "Art Style",
    icon: <Sparkles size={14} />,
    options: [
      "Cinematic",
      "Anime Style",
      "Photorealistic",
      "3D Render",
      "Oil Painting",
      "Cyberpunk",
      "Pixel Art",
      "VHS Footage",
    ],
  },
  {
    id: "lighting",
    label: "Lighting",
    icon: <Zap size={14} />,
    options: [
      "Volumetric Lighting",
      "Golden Hour",
      "Neon Lights",
      "Dark Moody",
      "Studio Lighting",
      "Natural Light",
      "Bioluminescent",
    ],
  },
  {
    id: "camera",
    label: "Lens & View",
    icon: <Aperture size={14} />,
    options: [
      "Wide Angle",
      "Macro Lens",
      "Drone Shot",
      "GoPro Footage",
      "Bokeh",
      "4k",
      "8k",
      "Highly Detailed",
    ],
  },
];

export default function PromptWizardModal({
  isOpen,
  onClose,
  onSelect,
}: PromptWizardModalProps) {
  if (!isOpen) return null;

  // We keep track of selected items to highlight them,
  // but for simplicity, clicking one immediately adds it to the prompt
  // (or you could build a list and "Insert All").
  // Let's do "Click to Insert" for speed.

  const handleOptionClick = (option: string) => {
    onSelect(option);
    // We don't close immediately so user can stack effects (e.g., Cinematic + Golden Hour)
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#09090b] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 bg-[#18181b] shrink-0">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Wand2 size={14} className="text-[#D2FF44]" /> Prompt Wizard
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <p className="text-xs text-zinc-500 italic">
            Click tags to append them to your prompt.
          </p>

          {CATEGORIES.map((cat) => (
            <div key={cat.id} className="space-y-3">
              <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                {cat.icon} {cat.label}
              </h4>
              <div className="flex flex-wrap gap-2">
                {cat.options.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => handleOptionClick(opt)}
                    className="px-3 py-1.5 rounded-full border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-400 hover:text-[#D2FF44] hover:border-[#D2FF44] hover:bg-[#D2FF44]/10 transition-all active:scale-95"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#D2FF44] text-black text-xs font-bold rounded hover:bg-[#b8e635] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
