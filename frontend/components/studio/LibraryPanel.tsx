"use client";

import { useDraggable } from "@dnd-kit/core";
import {
  Plus,
  Trash2,
  Link as LinkIcon,
  AlertCircle,
  Play,
  Square,
} from "lucide-react";
import { memo } from "react";

// --- TYPES ---
export interface Shot {
  id: string;
  sceneId: string;
  name: string;
  sourceImage: string;
  audioPath: string;
  audioStart?: number;
  audioDuration?: number;
  waveform?: number[];
  previewBase64?: string;
  prompt: string;
  motionStrength: number;
  seed: number;
  duration: number;
  status: string;
  outputVideo: string;
}

interface DraggableShotProps {
  shot: Shot;
  isActive: boolean;
  onClick: () => void;
  onExtend: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onPlay: () => void;
  isPlaying: boolean;
}

interface LibraryPanelProps {
  shots: Shot[];
  activeShotId: string | null;
  setActiveShotId: (id: string) => void;
  handleAddShot: () => void;
  handleExtendShot: (shot: Shot) => void | Promise<void>;
  handleDeleteShot: (e: React.MouseEvent, id: string) => void;
  handlePlayShot?: (shot: Shot) => void;
  previewingShotId?: string | null;
  projectId?: string;
}

// --- DRAGGABLE ITEM ---
const DraggableShotItem = memo(function DraggableShotItem({
  shot,
  isActive,
  onClick,
  onExtend,
  onDelete,
  onPlay,
  isPlaying,
}: DraggableShotProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `library-${shot.id}`,
    // OPTIMIZATION: Only pass necessary data
    data: { type: "shot", shot },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`
        relative group aspect-video rounded border overflow-hidden cursor-grab active:cursor-grabbing
        ${isActive ? "border-[#D2FF44] ring-1 ring-[#D2FF44]/30" : "border-zinc-800 hover:border-zinc-600"}
        ${isDragging ? "opacity-0" : ""}
        ${isPlaying ? "ring-2 ring-[#D2FF44] ring-offset-2 ring-offset-zinc-900" : ""}
      `}
    >
      <div className="absolute inset-0 bg-zinc-900">
        {shot.previewBase64 ? (
          <img
            src={shot.previewBase64}
            className="w-full h-full object-cover"
            alt={shot.name}
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-700">
            <AlertCircle size={20} />
          </div>
        )}
      </div>

      {/* Hover Actions */}
      <div className={`absolute top-1 right-1 flex gap-1 transition-opacity ${isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        {/* Play Button */}
        {(shot.outputVideo || shot.audioPath) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            className={`bg-black/60 hover:bg-[#D2FF44] hover:text-black p-1 rounded backdrop-blur ${isPlaying ? "bg-[#D2FF44] text-black" : "text-white"}`}
            title={isPlaying ? "Stop Preview" : "Play Preview"}
          >
            {isPlaying ? (
              <Square size={10} fill="currentColor" />
            ) : (
              <Play size={10} fill="currentColor" />
            )}
          </button>
        )}

        <button
          onClick={onExtend}
          className="bg-black/60 hover:bg-[#D2FF44] hover:text-black text-white p-1 rounded backdrop-blur"
          title="Extend Shot"
        >
          <LinkIcon size={10} />
        </button>

        <button
          onClick={onDelete}
          className="bg-black/60 hover:bg-red-500 text-white p-1 rounded backdrop-blur"
          title="Delete Shot"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* Label */}
      <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent p-1.5 pointer-events-none">
        <div className={`text-[10px] font-bold truncate ${isPlaying ? "text-[#D2FF44]" : "text-white"}`}>
          {shot.name}
        </div>
      </div>
    </div>
  );
});

// --- MAIN PANEL ---
const LibraryPanel = memo(function LibraryPanel({
  shots,
  activeShotId,
  setActiveShotId,
  handleAddShot,
  handleExtendShot,
  handleDeleteShot,
  handlePlayShot,
  previewingShotId,
}: LibraryPanelProps) {

  return (
    <div className="h-full flex flex-col">
      <div className="h-8 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-900/50 shrink-0">
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
          Library ({shots.length})
        </span>
        <button
          onClick={handleAddShot}
          className="text-[#D2FF44] hover:text-white transition-colors"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 content-start">
        <div className="grid grid-cols-2 gap-2">
          {shots.map((shot) => (
            <DraggableShotItem
              key={shot.id}
              shot={shot}
              isActive={activeShotId === shot.id}
              onClick={() => setActiveShotId(shot.id)}
              onExtend={(e) => {
                e.stopPropagation();
                handleExtendShot(shot);
              }}
              onDelete={(e) => handleDeleteShot(e, shot.id)}
              onPlay={() => handlePlayShot && handlePlayShot(shot)}
              isPlaying={previewingShotId === shot.id}
            />
          ))}
          <button
            onClick={handleAddShot}
            className="aspect-video rounded border border-zinc-800 border-dashed bg-zinc-900/30 hover:bg-zinc-900 hover:border-[#D2FF44] hover:text-[#D2FF44] flex flex-col items-center justify-center gap-2 text-zinc-600 transition-all group"
          >
            <Plus
              size={24}
              className="group-hover:scale-110 transition-transform"
            />
            <span className="text-xs font-medium">Add Shot</span>
          </button>
        </div>
      </div>
    </div>
  );
});

export default memo(LibraryPanel);