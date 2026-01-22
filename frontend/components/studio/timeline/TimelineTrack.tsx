// frontend/components/studio/timeline/TimelineTrack.tsx
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { TimelineClip } from "./TimelineClip";

export function TimelineTrack({
  id,
  shots,
  trackIndex,
  zoom,
  activeShotId,
  onShotClick,
}: any) {
  const { setNodeRef } = useDroppable({
    id: id,
    data: {
      type: "track",
      trackIndex: trackIndex,
    },
  });

  return (
    <div className="flex h-24 border-b border-zinc-800 bg-[#121214] relative">
      {/* Track Header */}
      <div className="w-24 shrink-0 border-r border-zinc-800 bg-[#18181b] flex items-center justify-center text-xs text-zinc-500 font-mono z-10 sticky left-0">
        V{trackIndex + 1}
      </div>

      {/* Droppable Area */}
      <div
        ref={setNodeRef}
        className="flex-1 relative flex items-center min-w-0 overflow-hidden"
      >
        <SortableContext
          items={shots.map((s: any) => s.timelineId)}
          strategy={horizontalListSortingStrategy}
        >
          {shots.map((shot: any) => (
            <TimelineClip
              key={shot.timelineId}
              id={shot.timelineId}
              shot={shot}
              width={(shot.duration || 4) * zoom}
              isActive={activeShotId === shot.id}
              onClick={(e: any) => {
                e.stopPropagation();
                onShotClick(shot.id);
              }}
            />
          ))}
        </SortableContext>

        {/* Empty State Hint */}
        {shots.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-800 text-xs font-mono pointer-events-none">
            EMPTY TRACK
          </div>
        )}
      </div>
    </div>
  );
}
