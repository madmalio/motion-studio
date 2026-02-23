"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  Upload,
  Library,
  Image as ImageIcon,
  Music,
  FileAudio,
  Play,
  Pause,
  AudioLines,
  Trash2,
} from "lucide-react";
import {
  ImportImage,
  ImportAudio,
  GetProjectAssets,
  DeleteProjectAsset,
} from "../../lib/wailsSafe";
import { useConfirm } from "../ConfirmProvider";

interface AssetLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: any;
}

export default function AssetLibraryModal({
  isOpen,
  onClose,
  project,
}: AssetLibraryModalProps) {
  const [activeType, setActiveType] = useState<"image" | "audio">("image");
  const [assets, setAssets] = useState<any[]>([]);
  const { confirm } = useConfirm();

  // --- AUDIO PREVIEW STATE ---
  const [playingAsset, setPlayingAsset] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop audio when closing or switching types
  useEffect(() => {
    if (!isOpen) {
      stopAudio();
    }
  }, [isOpen]);

  useEffect(() => {
    stopAudio();
  }, [activeType]);

  // Load assets when opening or when project changes
  useEffect(() => {
    if (isOpen && project?.id) {
      loadAssets();
    }
  }, [isOpen, project]);

  const loadAssets = async () => {
    if (!project?.id) return;
    const list = await GetProjectAssets(project.id);
    setAssets(list || []);
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingAsset(null);
  };

  const getAssetUrl = (path: string) => {
    const safePath = path.replace(/\\/g, "/");
    return `http://localhost:3456/video/${safePath}`;
  };

  const togglePreview = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();

    if (playingAsset === path) {
      stopAudio();
    } else {
      stopAudio();
      const url = getAssetUrl(path);
      const audio = new Audio(url);
      audio.volume = 0.5;

      audio.onended = () => setPlayingAsset(null);
      audio.play().catch((err) => console.error("Playback failed", err));

      audioRef.current = audio;
      setPlayingAsset(path);
    }
  };

  const handleDelete = (e: React.MouseEvent, asset: any) => {
    e.stopPropagation();
    if (!project?.id) return;

    confirm({
      title: `Delete ${activeType === "image" ? "Image" : "Audio"}?`,
      message: `This will permanently delete "${asset.name}" from your project assets.`,
      confirmText: "Delete",
      variant: "danger",
      onConfirm: async () => {
        const result = await DeleteProjectAsset(project.id, asset.path);
        if (result === "Success") {
          if (playingAsset === asset.path) stopAudio();
          loadAssets();
        } else {
          alert(`Failed to delete: ${result}`);
        }
      },
    });
  };

  const handleUpload = async () => {
    if (!project?.id) return;
    stopAudio();

    let path = "";
    if (activeType === "image") {
      path = await ImportImage(project.id);
    } else {
      path = await ImportAudio(project.id);
    }

    if (path) {
      loadAssets();
    }
  };

  if (!isOpen) return null;

  const filteredAssets = assets.filter((a) => a.type === activeType);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-4xl bg-[#09090b] border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[80vh] h-full animate-in zoom-in-95 duration-200">
        {/* HEADER */}
        <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-[#09090b] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#D2FF44]/10 text-[#D2FF44]">
              <Library size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Project Assets</h3>
              <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Manage your media library</p>
            </div>
          </div>
          <button
            onClick={() => {
              stopAudio();
              onClose();
            }}
            className="text-zinc-500 hover:text-white transition-colors p-2 hover:bg-zinc-800 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        {/* MAIN CONTENT */}
        <div className="flex-1 flex min-h-0">
          {/* SIDEBAR TABS */}
          <div className="w-48 border-r border-zinc-800 bg-zinc-900/20 flex flex-col p-2 gap-1">
            <TabButton 
              active={activeType === "image"} 
              onClick={() => setActiveType("image")}
              icon={<ImageIcon size={16} />}
              label="Images"
              count={assets.filter(a => a.type === "image").length}
            />
            <TabButton 
              active={activeType === "audio"} 
              onClick={() => setActiveType("audio")}
              icon={<Music size={16} />}
              label="Audio"
              count={assets.filter(a => a.type === "audio").length}
            />
            
            <div className="mt-auto p-2">
              <button
                onClick={handleUpload}
                className="w-full py-2 bg-[#D2FF44] hover:bg-[#c2eb39] text-black text-[10px] font-black rounded-lg flex items-center justify-center gap-2 transition-all"
              >
                <Upload size={14} strokeWidth={3} />
                IMPORT
              </button>
            </div>
          </div>

          {/* GRID AREA */}
          <div className="flex-1 overflow-y-auto p-6 bg-[#09090b]">
            {filteredAssets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-4">
                <div className="p-6 rounded-full bg-zinc-900/50 border border-zinc-800">
                  {activeType === "image" ? <ImageIcon size={40} className="opacity-20" /> : <Music size={40} className="opacity-20" />}
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-zinc-400">No {activeType}s found</p>
                  <p className="text-xs opacity-60">Upload some assets to get started</p>
                </div>
                <button
                  onClick={handleUpload}
                  className="mt-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg transition-all"
                >
                  Import {activeType}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredAssets.map((asset, i) => (
                  <div
                    key={i}
                    className={`
                      group relative aspect-square border rounded-xl overflow-hidden transition-all bg-zinc-900
                      ${playingAsset === asset.path ? "border-[#D2FF44] ring-1 ring-[#D2FF44]" : "border-zinc-800 hover:border-zinc-600"}
                    `}
                  >
                    {activeType === "audio" ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-3">
                        <AudioLines
                          size={32}
                          className={`transition-colors ${playingAsset === asset.path ? "text-[#D2FF44]" : "text-zinc-600 group-hover:text-zinc-400"}`}
                        />

                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-[1px]">
                          <button
                            onClick={(e) => togglePreview(e, asset.path)}
                            className="w-10 h-10 rounded-full bg-[#D2FF44] text-black flex items-center justify-center hover:scale-110 transition-transform shadow-lg"
                          >
                            {playingAsset === asset.path ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <img
                        src={getAssetUrl(asset.path)}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 opacity-80 group-hover:opacity-100"
                        alt={asset.name}
                      />
                    )}

                    {/* SHARED DELETE BUTTON AT TOP RIGHT */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                      <button
                        onClick={(e) => handleDelete(e, asset)}
                        className="p-1.5 rounded-lg bg-black/60 text-white border border-white/10 hover:bg-red-500 hover:border-red-500 transition-all shadow-lg"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, count }: any) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all
        ${active ? "bg-[#D2FF44]/10 text-[#D2FF44]" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"}
      `}
    >
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${active ? "bg-[#D2FF44]/20" : "bg-zinc-800"}`}>
        {count}
      </span>
    </button>
  );
}
