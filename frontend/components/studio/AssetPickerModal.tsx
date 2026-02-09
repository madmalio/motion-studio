"use client";

import { useState, useEffect } from "react";
import {
  X,
  Upload,
  Library,
  Image as ImageIcon,
  Music,
  FileAudio,
} from "lucide-react";
import {
  ImportImage,
  ImportAudio,
  GetProjectAssets,
} from "../../wailsjs/go/main/App";

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

  // Reset tab and load assets when opening
  useEffect(() => {
    if (isOpen) {
      setActiveTab("upload");
      if (project?.id) {
        GetProjectAssets(project.id).then((list) => setAssets(list || []));
      }
    }
  }, [isOpen, project]);

  const handleUploadSystem = async () => {
    if (!project?.id) return;

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

  // Helper to generate a local URL for the asset
  const getAssetUrl = (path: string) => {
    const safePath = path.replace(/\\/g, "/");
    return `http://localhost:3456/video/${safePath}`;
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
            onClick={onClose}
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
                      className="group relative aspect-square border border-zinc-800 rounded-xl bg-zinc-900 overflow-hidden cursor-pointer hover:border-[#D2FF44] hover:shadow-[0_0_15px_rgba(210,255,68,0.1)] transition-all"
                      title={asset.name} // Tooltip on hover
                    >
                      {/* Audio Item */}
                      {type === "audio" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-700 group-hover:text-[#D2FF44] transition-colors bg-zinc-950/50">
                          <FileAudio size={40} />
                        </div>
                      )}

                      {/* Image Item */}
                      {type === "image" && (
                        <>
                          <div className="absolute inset-0 bg-zinc-900 animate-pulse" />
                          <img
                            src={getAssetUrl(asset.path)}
                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 opacity-80 group-hover:opacity-100"
                            alt={asset.name}
                            loading="lazy"
                          />
                        </>
                      )}

                      {/* Removed the text label overlay */}
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
