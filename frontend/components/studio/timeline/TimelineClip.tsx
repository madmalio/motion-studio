// frontend/components/studio/timeline/TimelineClip.tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

export function TimelineClip({ id, shot, width, isActive, onClick }: any) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: id,
    data: {
      type: "shot",
      shot: shot, // Pass the full shot data for the drag overlay
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: `${width}px`,
    opacity: isDragging ? 0.3 : 1, // Dim the original item while dragging
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        relative h-full flex-shrink-0 flex flex-col 
        border-r border-zinc-900 bg-zinc-800 
        group overflow-hidden select-none
        ${isActive ? "ring-2 ring-[#D2FF44] z-10" : "hover:bg-zinc-700"}
      `}
      // Only the clip body triggers selection
      onClick={onClick}
    >
      {/* Thumbnail Background */}
      {shot.previewBase64 && (
        <img
          src={shot.previewBase64}
          className="absolute inset-0 w-full h-full object-cover opacity-50 mix-blend-overlay pointer-events-none"
        />
      )}

      {/* Drag Handle (Top Bar) */}
      <div
        {...attributes}
        {...listeners}
        className="h-4 w-full bg-black/40 hover:bg-[#D2FF44]/50 cursor-grab active:cursor-grabbing flex items-center justify-center z-20"
      >
        <GripVertical size={10} className="text-white/50" />
      </div>

      {/* Label */}
      <div className="mt-auto px-2 py-1 text-[9px] font-mono text-white/80 truncate bg-black/40">
        {shot.name}
      </div>
    </div>
  );
}
