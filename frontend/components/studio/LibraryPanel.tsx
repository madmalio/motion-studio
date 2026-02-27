import { useDraggable } from "@dnd-kit/core";
import {
  Plus,
  Trash2,
  Link as LinkIcon,
  AlertCircle,
  Play,
  Square,
  Music,
  Video,
  Upload,
} from "lucide-react";
import { memo, useState } from "react";

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

export interface ProjectAsset {
  name: string;
  path: string;
  type: string;
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

interface DraggableAssetProps {
  asset: ProjectAsset;
  onDelete: (e: React.MouseEvent) => void;
  onPlay: () => void;
  isPlaying: boolean;
}

interface LibraryPanelProps {
  shots: Shot[];
  assets?: ProjectAsset[];
  activeShotId: string | null;
  setActiveShotId: (id: string) => void;
  handleAddShot: () => void;
  handleUploadAudio?: () => void;
  handleExtendShot: (shot: Shot) => void | Promise<void>;
  handleDeleteShot: (e: React.MouseEvent, id: string) => void;
  handleDeleteAsset?: (e: React.MouseEvent, path: string) => void;
  handlePlayShot?: (shot: Shot) => void;
  handlePlayAsset?: (asset: ProjectAsset) => void;
  previewingShotId?: string | null;
  previewingAssetPath?: string | null;
  projectId?: string;
}

// --- DRAGGABLE SHOT ---
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

      <div className={`absolute top-1 right-1 flex gap-1 transition-opacity ${isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        {(shot.outputVideo || shot.audioPath) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            className={`bg-black/60 hover:bg-[#D2FF44] hover:text-black p-1 rounded backdrop-blur ${isPlaying ? "bg-[#D2FF44] text-black" : "text-white"}`}
          >
            {isPlaying ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
          </button>
        )}
        <button onClick={onExtend} className="bg-black/60 hover:bg-[#D2FF44] hover:text-black text-white p-1 rounded backdrop-blur">
          <LinkIcon size={10} />
        </button>
        <button onClick={onDelete} className="bg-black/60 hover:bg-red-500 text-white p-1 rounded backdrop-blur">
          <Trash2 size={10} />
        </button>
      </div>

      <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent p-1.5 pointer-events-none">
        <div className={`text-[10px] font-bold truncate ${isPlaying ? "text-[#D2FF44]" : "text-white"}`}>
          {shot.name}
        </div>
      </div>
    </div>
  );
});

// --- DRAGGABLE ASSET ---
const DraggableAssetItem = memo(function DraggableAssetItem({
  asset,
  onDelete,
  onPlay,
  isPlaying,
}: DraggableAssetProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `asset-${asset.path}`,
    data: {
      type: "shot",
      shot: {
        id: `asset-${asset.path}`,
        name: asset.name,
        audioPath: asset.type === "audio" ? asset.path : "",
        outputVideo: "",
        duration: 4,
        status: "DONE",
      }
    },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`
        relative group aspect-video rounded border overflow-hidden cursor-grab active:cursor-grabbing
        ${isDragging ? "opacity-0" : ""}
        ${isPlaying ? "ring-2 ring-[#D2FF44] ring-offset-2 ring-offset-zinc-900 border-[#D2FF44]" : "border-zinc-800 hover:border-zinc-600"}
      `}
    >
      {/* Visual / Background */}
      <div className="absolute inset-0 bg-[#101012] flex flex-col items-center justify-center gap-2">
        <div className={`p-2 rounded-full ${isPlaying ? "bg-[#D2FF44] text-black" : "bg-zinc-800 text-zinc-500"}`}>
          {asset.type === "audio" ? <Music size={20} /> : <Video size={20} />}
        </div>
        {isPlaying && (
          <div className="flex gap-0.5 items-end h-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="w-1 bg-[#D2FF44] animate-pulse" style={{ height: `${20 + Math.random() * 80}%`, animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        )}
      </div>

      {/* Hover Actions */}
      <div className={`absolute top-1 right-1 flex gap-1 transition-opacity ${isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          className={`bg-black/60 hover:bg-[#D2FF44] hover:text-black p-1 rounded backdrop-blur ${isPlaying ? "bg-[#D2FF44] text-black" : "text-white"}`}
        >
          {isPlaying ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
        </button>
        <button
          onClick={onDelete}
          className="bg-black/60 hover:bg-red-500 text-white p-1 rounded backdrop-blur"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* Label */}
      <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent p-1.5 pointer-events-none">
        <div className={`text-[10px] font-bold truncate ${isPlaying ? "text-[#D2FF44]" : "text-white"}`}>
          {asset.name}
        </div>
        <div className="text-[7px] text-zinc-500 uppercase tracking-widest leading-tight">
          Project {asset.type}
        </div>
      </div>
    </div>
  );
});

// --- MAIN PANEL ---
const LibraryPanel = memo(function LibraryPanel({
  shots,
  assets = [],
  activeShotId,
  setActiveShotId,
  handleAddShot,
  handleUploadAudio,
  handleExtendShot,
  handleDeleteShot,
  handleDeleteAsset,
  handlePlayShot,
  handlePlayAsset,
  previewingShotId,
  previewingAssetPath,
}: LibraryPanelProps) {
  const [tab, setTab] = useState<"shots" | "assets">("shots");

  const audioAssets = assets.filter(a => a.type === "audio");

  return (
    <div className="h-full flex flex-col bg-[#09090b]">
      {/* TABS */}
      <div className="flex border-b border-zinc-800 shrink-0">
        <button
          onClick={() => setTab("shots")}
          className={`flex-1 h-9 text-[10px] font-bold uppercase tracking-widest transition-colors ${tab === "shots" ? "text-[#D2FF44] border-b-2 border-[#D2FF44] bg-[#D2FF44]/5" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          Shots ({shots.length})
        </button>
        <button
          onClick={() => setTab("assets")}
          className={`flex-1 h-9 text-[10px] font-bold uppercase tracking-widest transition-colors ${tab === "assets" ? "text-[#D2FF44] border-b-2 border-[#D2FF44] bg-[#D2FF44]/5" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          Audio ({audioAssets.length})
        </button>
      </div>

      {/* HEADER ACTIONS */}
      <div className="h-10 flex items-center justify-between px-4 bg-zinc-900/30 border-b border-zinc-800/50">
        <span className="text-[9px] font-black text-zinc-600 uppercase tracking-tighter">
          {tab === "shots" ? "Generated Content" : "Project Assets"}
        </span>
        {tab === "shots" ? (
          <button
            onClick={handleAddShot}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#D2FF44] text-black text-[10px] font-bold hover:bg-[#e1ff70] transition-all active:scale-95"
          >
            <Plus size={12} /> New Shot
          </button>
        ) : (
          <button
            onClick={handleUploadAudio}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 text-zinc-200 text-[10px] font-bold hover:bg-zinc-700 transition-all active:scale-95 border border-zinc-700"
          >
            <Upload size={12} /> Upload Audio
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {tab === "shots" ? (
          <div className="grid grid-cols-2 gap-2 content-start">
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
              className="aspect-video rounded border border-zinc-800 border-dashed bg-zinc-900/30 hover:bg-zinc-900 hover:border-[#D2FF44] hover:text-[#D2FF44] flex flex-col items-center justify-center gap-1 text-zinc-600 transition-all group"
            >
              <Plus size={20} className="group-hover:scale-110 transition-transform" />
              <span className="text-[9px] font-bold uppercase tracking-tighter">Add Shot</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 content-start">
            {audioAssets.length > 0 ? (
              audioAssets.map((asset) => (
                <DraggableAssetItem
                  key={asset.path}
                  asset={asset}
                  onDelete={(e) => {
                    e.stopPropagation();
                    handleDeleteAsset?.(e, asset.path);
                  }}
                  onPlay={() => handlePlayAsset?.(asset)}
                  isPlaying={previewingAssetPath === asset.path}
                />
              ))
            ) : (
              <div className="col-span-2 py-12 flex flex-col items-center justify-center text-zinc-700 text-center px-4">
                <Music size={32} className="mb-3 opacity-20" />
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-50">No Audio Assets</p>
                <p className="text-[9px] mt-1 text-zinc-600">Import music or sound effects to use in your timeline.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default memo(LibraryPanel);