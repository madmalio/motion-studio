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

interface AssetPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: "image" | "audio";
  project: any;
  onSelect: (asset: any) => void;
}

export default function AssetPickerModal({
  isOpen,
  onClose,
  type,
  project,
  onSelect,
}: AssetPickerModalProps) {
  const [activeTab, setActiveTab] = useState<"upload" | "library">("upload");
  const [assets, setAssets] = useState<any[]>([]);
  const { confirm } = useConfirm();

  // --- AUDIO PREVIEW STATE ---
  const [playingAsset, setPlayingAsset] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop audio when closing or switching tabs
  useEffect(() => {
    if (!isOpen || activeTab !== "library") {
      stopAudio();
    }
  }, [isOpen, activeTab]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopAudio();
  }, []);

  // Reset tab and load assets when opening
  useEffect(() => {
    if (isOpen) {
      setActiveTab("upload");
      if (project?.id) {
        GetProjectAssets(project.id).then((list) => setAssets(list || []));
      }
    }
  }, [isOpen, project]);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingAsset(null);
  };

  // Helper to generate a local URL for the asset
  const getAssetUrl = (path: string) => {
    const safePath = path.replace(/\\/g, "/");
    return `http://localhost:3456/video/${safePath}`;
  };

  const togglePreview = (e: React.MouseEvent, path: string) => {
    e.stopPropagation(); // Don't trigger the "Select" click

    if (playingAsset === path) {
      // Pause
      stopAudio();
    } else {
      // Play New
      stopAudio(); // Stop previous
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
      title: `Delete ${type === "image" ? "Image" : "Audio"}?`,
      message: `This will permanently delete "${asset.name}" from your project assets.`,
      confirmText: "Delete",
      variant: "danger",
      onConfirm: async () => {
        const result = await DeleteProjectAsset(project.id, asset.path);
        if (result === "Success") {
          // Stop audio if it's the one being deleted
          if (playingAsset === asset.path) stopAudio();
          // Refresh list
          const list = await GetProjectAssets(project.id);
          setAssets(list || []);
        } else {
          alert(`Failed to delete: ${result}`);
        }
      },
    });
  };

  const handleUploadSystem = async () => {
    if (!project?.id) return;
    stopAudio(); // Stop any preview

    let path = "";
    if (type === "image") {
      path = await ImportImage(project.id);
    } else {
      path = await ImportAudio(project.id);
    }

    if (path) {
      onSelect({ path, type, name: path.split(/[\\/]/).pop() });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#09090b] border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[600px] h-full animate-in zoom-in-95 duration-200">
        {/* HEADER */}
        <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-[#09090b] shrink-0">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            {type === "image" ? <ImageIcon size={16} /> : <Music size={16} />}
            Select {type === "image" ? "Image" : "Audio"} Source
          </h3>
          <button
            onClick={() => {
              stopAudio();
              onClose();
            }}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* CONTENT CONTAINER */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* TABS */}
          <div className="flex border-b border-zinc-800 bg-zinc-900/30 shrink-0">
            <button
              onClick={() => setActiveTab("upload")}
              className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                activeTab === "upload"
                  ? "text-[#D2FF44] border-b-2 border-[#D2FF44] bg-[#D2FF44]/5"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
              }`}
            >
              <Upload size={14} /> Upload New
            </button>
            <button
              onClick={() => setActiveTab("library")}
              className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                activeTab === "library"
                  ? "text-[#D2FF44] border-b-2 border-[#D2FF44] bg-[#D2FF44]/5"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
              }`}
            >
              <Library size={14} /> Project Library
            </button>
          </div>

          {/* SCROLLABLE AREA */}
          <div className="flex-1 overflow-y-auto p-6 bg-[#09090b]">
            {activeTab === "upload" ? (
              <div
                onClick={handleUploadSystem}
                className="w-full h-full min-h-[200px] border-2 border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center gap-4 text-zinc-500 hover:text-white hover:border-[#D2FF44] hover:bg-zinc-900/50 cursor-pointer transition-all group"
              >
                <div className="p-6 rounded-full bg-zinc-900 group-hover:bg-[#D2FF44] group-hover:text-black transition-all duration-300">
                  {type === "image" ? (
                    <ImageIcon size={40} />
                  ) : (
                    <Music size={40} />
                  )}
                </div>
                <div className="text-center space-y-1">
                  <div className="text-base font-bold">
                    Click to Browse System
                  </div>
                  <div className="text-xs opacity-60">
                    {type === "image"
                      ? "Supports PNG, JPG, WEBP"
                      : "Supports MP3, WAV, OGG"}
                  </div>
                </div>
              </div>
            ) : (
              /* LIBRARY GRID */
              <div className="grid grid-cols-4 gap-4">
                {assets.filter((a) => a.type === type).length === 0 && (
                  <div className="col-span-4 flex flex-col items-center justify-center py-20 text-zinc-500 gap-2">
                    <Library size={32} className="opacity-20" />
                    <span className="text-xs italic">
                      No {type} assets found in this project.
                    </span>
                  </div>
                )}

                {assets
                  .filter((a) => a.type === type)
                  .map((asset, i) => (
                    <div
                      key={i}
                      onClick={() => onSelect(asset)}
                      className={`
                        group relative aspect-square border rounded-xl overflow-hidden cursor-pointer transition-all
                        ${playingAsset === asset.path ? "border-[#D2FF44] ring-1 ring-[#D2FF44]" : "border-zinc-800 hover:border-zinc-600 hover:shadow-lg"}
                        bg-zinc-900
                      `}
                      title={asset.name}
                    >
                      {/* --- AUDIO CARD DESIGN --- */}
                      {type === "audio" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-950 group-hover:from-zinc-800 group-hover:to-zinc-900 transition-colors">
                          <AudioLines
                            size={48}
                            className={`mb-2 transition-colors ${playingAsset === asset.path ? "text-[#D2FF44]" : "text-zinc-600 group-hover:text-zinc-400"}`}
                          />

                          {/* Play/Pause Overlay Button */}
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[1px]">
                            <button
                              onClick={(e) => togglePreview(e, asset.path)}
                              className="w-12 h-12 rounded-full bg-[#D2FF44] text-black flex items-center justify-center hover:scale-110 transition-transform shadow-lg"
                              title={
                                playingAsset === asset.path
                                  ? "Stop Preview"
                                  : "Preview Audio"
                              }
                            >
                              {playingAsset === asset.path ? (
                                <Pause size={20} fill="currentColor" />
                              ) : (
                                <Play
                                  size={20}
                                  fill="currentColor"
                                  className="ml-0.5"
                                />
                              )}
                            </button>
                            
                            {/* Delete Button */}
                            <button
                              onClick={(e) => handleDelete(e, asset)}
                              className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/20 text-red-500 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all"
                              title="Delete Asset"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* --- IMAGE CARD DESIGN --- */}
                      {type === "image" && (
                        <>
                          <div className="absolute inset-0 bg-zinc-900 animate-pulse" />
                          <img
                            src={getAssetUrl(asset.path)}
                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 opacity-80 group-hover:opacity-100"
                            alt={asset.name}
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                          <button
                            onClick={(e) => handleDelete(e, asset)}
                            className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white border border-white/10 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:border-red-500 transition-all z-10"
                            title="Delete Asset"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
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
