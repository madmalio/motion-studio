"use client";

import { useDraggable } from "@dnd-kit/core";
import { Plus, Trash2, Link as LinkIcon, AlertCircle } from "lucide-react";
import { memo } from "react";

// --- DRAGGABLE ITEM (Internal) ---
const DraggableShotItem = memo(function DraggableShotItem({
  shot,
  isActive,
  onClick,
  onExtend,
  onDelete,
}: any) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `library-${shot.id}`,
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
                ${isDragging ? "opacity-50" : ""}
            `}
    >
      <div className="absolute inset-0 bg-zinc-900">
        {shot.previewBase64 ? (
          <img
            src={shot.previewBase64}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-700">
            <AlertCircle size={20} />
          </div>
        )}
      </div>

      {/* Hover Actions */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
        <div className="text-[10px] font-bold text-white truncate">
          {shot.name}
        </div>
      </div>
    </div>
  );
});

// --- MAIN PANEL (Memoized) ---
const LibraryPanel = memo(function LibraryPanel({
  shots,
  activeShotId,
  setActiveShotId,
  handleAddShot,
  handleExtendShot,
  handleDeleteShot,
}: any) {
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
          {shots.map((shot: any) => (
            <DraggableShotItem
              key={shot.id}
              shot={shot}
              isActive={activeShotId === shot.id}
              onClick={() => setActiveShotId(shot.id)}
              onExtend={(e: any) => {
                e.stopPropagation();
                handleExtendShot(shot);
              }}
              onDelete={(e: any) => handleDeleteShot(e, shot.id)}
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
