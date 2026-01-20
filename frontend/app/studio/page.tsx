"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Settings,
  Play,
  Image as ImageIcon,
  Plus,
  Wand2,
  Link as LinkIcon,
  Loader2,
  Trash2,
  Ghost,
} from "lucide-react";
import { Suspense, useEffect, useState, useRef } from "react";
import { useConfirm } from "../../components/ConfirmProvider";

// WAILS IMPORTS
import {
  GetProject,
  GetScenes,
  SelectImage,
  ReadImageBase64,
  ExtractLastFrame,
  SaveShots,
  GetShots,
} from "../../wailsjs/go/main/App";

// --- TYPES ---
// FIX: Updated to match the Go Struct exactly
interface Shot {
  id: string;
  sceneId: string; // <--- Added
  name: string;
  sourceImage: string;
  previewBase64?: string;
  prompt: string;
  motionStrength: number;
  seed: number;
  duration: number;
  status: string; // <--- Added (DRAFT, DONE)
  outputVideo: string; // <--- Added
}

interface Project {
  id: string;
  name: string;
}
interface Scene {
  id: string;
  name: string;
}

function StudioContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") || "";
  const sceneId = searchParams.get("sceneId") || "";
  const { confirm } = useConfirm();

  const [project, setProject] = useState<Project | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [showGhost, setShowGhost] = useState(false);

  const initialized = useRef(false);

  // 1. AUTO-SAVE EFFECT
  useEffect(() => {
    // Only save if we have a valid project/scene and initialized at least once
    if (projectId && sceneId && initialized.current && shots.length > 0) {
      // Remove previewBase64 before saving to disk to keep JSON small
      // (The Go backend doesn't need the base64 string saved)
      const cleanShots = shots.map(({ previewBase64, ...keep }) => keep);

      // We need to cast back to any because TypeScript gets confused by the removed prop
      // but the data structure now matches Go perfectly.
      SaveShots(projectId, sceneId, cleanShots as any);
    }
  }, [shots, projectId, sceneId]);

  // 2. LOAD DATA
  useEffect(() => {
    if (projectId && sceneId) loadData(projectId, sceneId);
  }, [projectId, sceneId]);

  const loadData = async (pId: string, sId: string) => {
    try {
      const p = await GetProject(pId);
      setProject(p);
      const sData = await GetScenes(pId);
      const s = sData.find((x: any) => x.id === sId);
      setScene(s || null);

      // LOAD SHOTS FROM DISK
      const savedShots = await GetShots(pId, sId);

      if (savedShots && savedShots.length > 0) {
        // Hydrate the Base64 previews
        const hydratedShots = await Promise.all(
          savedShots.map(async (shot: any) => {
            if (shot.sourceImage) {
              const b64 = await ReadImageBase64(shot.sourceImage);
              return { ...shot, previewBase64: b64 };
            }
            return shot;
          }),
        );

        setShots(hydratedShots);
        setActiveShotId(hydratedShots[0].id);
        initialized.current = true; // Mark as loaded so we don't double-save immediately
      } else {
        // Only if NO saved shots exist, create the default one
        if (!initialized.current) {
          initialized.current = true;
          handleAddShot();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // --- ACTIONS ---

  const handleAddShot = () => {
    if (!sceneId) return;

    setShots((prev) => {
      const newShot: Shot = {
        id: crypto.randomUUID(),
        sceneId: sceneId, // <--- FIX: Pass sceneId
        name: `Shot ${prev.length + 1}`,
        sourceImage: "",
        prompt: "",
        motionStrength: 127,
        seed: Math.floor(Math.random() * 1000000),
        duration: 48,
        status: "DRAFT", // <--- FIX: Default status
        outputVideo: "", // <--- FIX: Empty string
      };
      setActiveShotId((current) => current || newShot.id);
      return [...prev, newShot];
    });
  };

  const handleExtendShot = async (originalShot: Shot) => {
    if (!originalShot.sourceImage) {
      alert("Please select a source image for this shot first.");
      return;
    }

    const lastFramePath = await ExtractLastFrame(originalShot.sourceImage);
    if (!lastFramePath) {
      console.error("Failed to extract frame");
      return;
    }

    const b64 = await ReadImageBase64(lastFramePath);

    setShots((prev) => {
      const newShot: Shot = {
        id: crypto.randomUUID(),
        sceneId: sceneId, // <--- FIX
        name: `${originalShot.name} (Ext)`,
        sourceImage: lastFramePath,
        previewBase64: b64,
        prompt: originalShot.prompt,
        motionStrength: originalShot.motionStrength,
        seed: Math.floor(Math.random() * 1000000),
        duration: 48,
        status: "DRAFT", // <--- FIX
        outputVideo: "", // <--- FIX
      };
      setActiveShotId(newShot.id);
      return [...prev, newShot];
    });
    setShowGhost(true);
  };

  const handleDeleteShot = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    confirm({
      title: "Delete Shot?",
      message: "This will permanently remove the shot.",
      confirmText: "Delete",
      variant: "danger",
      onConfirm: () => {
        setShots((prev) => {
          const newShots = prev.filter((s) => s.id !== id);
          if (activeShotId === id) {
            const newActive =
              newShots.length > 0 ? newShots[newShots.length - 1].id : null;
            setActiveShotId(newActive);
          }
          // If we deleted everything, add a new blank shot?
          // Or just leave it empty. Let's leave it empty but update persistent store will handle it.
          return newShots;
        });
      },
    });
  };

  const updateActiveShot = (updates: Partial<Shot>) => {
    if (!activeShotId) return;
    setShots((prev) =>
      prev.map((s) => (s.id === activeShotId ? { ...s, ...updates } : s)),
    );
  };

  const handleUpload = async () => {
    const path = await SelectImage();
    if (path) {
      const b64 = await ReadImageBase64(path);
      updateActiveShot({ sourceImage: path, previewBase64: b64 });
    }
  };

  const activeShotIndex = shots.findIndex((s) => s.id === activeShotId);
  const activeShot = shots[activeShotIndex];
  const prevShot = shots[activeShotIndex - 1];

  if (!project || !scene)
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#09090b] text-[#D2FF44] gap-2">
        <Loader2 className="animate-spin" /> Loading Studio...
      </div>
    );

  return (
    <div className="flex-1 w-full flex flex-col overflow-hidden bg-[#09090b]">
      {/* HEADER */}
      <header className="h-14 w-full border-b border-zinc-800 bg-[#09090b] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold text-white flex items-center gap-2">
            {scene.name} <span className="text-zinc-600">/</span>{" "}
            <span className="text-zinc-500 font-normal">{project.name}</span>
          </h1>
        </div>
        <button className="bg-[#D2FF44] text-black text-xs font-bold px-4 py-1.5 rounded hover:opacity-90 flex items-center gap-2">
          <Play size={14} fill="black" /> RENDER SCENE
        </button>
      </header>

      {/* WORKSPACE */}
      <div className="flex-1 w-full flex overflow-hidden">
        {/* INSPECTOR */}
        <aside className="w-80 border-r border-zinc-800 bg-[#09090b] flex flex-col overflow-y-auto">
          {activeShot ? (
            <div className="p-4 space-y-6">
              {/* Image Input */}
              <div>
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <ImageIcon size={12} /> Source
                </h3>
                <div
                  onClick={handleUpload}
                  className="aspect-video border border-dashed border-zinc-800 rounded-lg bg-zinc-900/50 flex flex-col items-center justify-center gap-2 text-zinc-600 hover:text-white hover:border-[#D2FF44] cursor-pointer transition-all overflow-hidden relative group"
                >
                  {activeShot.previewBase64 ? (
                    <img
                      src={activeShot.previewBase64}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <>
                      <ImageIcon size={24} />
                      <span className="text-xs">Select Image</span>
                    </>
                  )}
                </div>
              </div>
              {/* Prompt Input */}
              <div>
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Wand2 size={12} /> Prompt
                </h3>
                <textarea
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md p-3 text-xs text-white focus:border-[#D2FF44] outline-none resize-none h-24 leading-relaxed placeholder-zinc-600"
                  placeholder="Describe the motion..."
                  value={activeShot.prompt}
                  onChange={(e) => updateActiveShot({ prompt: e.target.value })}
                />
              </div>
              {/* Settings */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <Settings size={12} /> Settings
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <label>Motion Strength</label>
                    <span>{activeShot.motionStrength}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="255"
                    className="w-full accent-[#D2FF44] h-1 bg-zinc-800 rounded appearance-none"
                    value={activeShot.motionStrength}
                    onChange={(e) =>
                      updateActiveShot({
                        motionStrength: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-zinc-400">
                    <label>Seed</label>
                    <span className="font-mono text-[10px]">
                      {activeShot.seed}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white outline-none focus:border-[#D2FF44]"
                      value={activeShot.seed}
                      onChange={(e) =>
                        updateActiveShot({ seed: parseInt(e.target.value) })
                      }
                    />
                    <button
                      onClick={() =>
                        updateActiveShot({
                          seed: Math.floor(Math.random() * 1000000),
                        })
                      }
                      className="bg-zinc-800 px-2 rounded hover:bg-zinc-700 text-zinc-400"
                      title="Randomize"
                    >
                      🎲
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-10 text-center text-zinc-600 text-xs">
              Select a shot to edit
            </div>
          )}
        </aside>

        {/* VIEWPORT */}
        <div className="flex-1 bg-black flex flex-col items-center justify-center relative border-r border-zinc-800 overflow-hidden">
          <div className="absolute top-4 flex gap-2 z-10 bg-zinc-900/80 backdrop-blur rounded-full px-2 py-1 border border-zinc-800">
            <button
              onClick={() => setShowGhost(!showGhost)}
              className={`p-1.5 rounded-full transition-all ${showGhost ? "bg-[#D2FF44] text-black" : "text-zinc-400 hover:text-white"}`}
              title="Toggle Onion Skinning (Ghosting)"
            >
              <Ghost size={14} />
            </button>
          </div>
          <div className="relative max-h-[80%] max-w-[80%] aspect-video flex items-center justify-center">
            {activeShot?.previewBase64 ? (
              <img
                src={activeShot.previewBase64}
                className="w-full h-full object-contain shadow-2xl relative z-0"
              />
            ) : (
              <div className="text-zinc-600 text-sm font-mono flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center">
                  <ImageIcon size={20} />
                </div>
                NO IMAGE
              </div>
            )}
            {showGhost && prevShot?.previewBase64 && (
              <img
                src={prevShot.previewBase64}
                className="absolute inset-0 w-full h-full object-contain opacity-40 pointer-events-none z-10 mix-blend-overlay"
                style={{ filter: "grayscale(100%)" }}
              />
            )}
          </div>
        </div>
      </div>

      {/* TIMELINE */}
      <div className="h-48 border-t border-zinc-800 bg-[#09090b] flex flex-col shrink-0">
        <div className="h-8 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-900/50">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
            Timeline
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            Total Duration: {shots.length * 4}s
          </span>
        </div>
        <div className="flex-1 overflow-x-auto p-4 flex items-center gap-2">
          {shots.map((shot, index) => (
            <div
              key={shot.id}
              onClick={() => setActiveShotId(shot.id)}
              className={`relative group flex-shrink-0 w-48 h-28 rounded-lg border-2 overflow-hidden cursor-pointer transition-all ${activeShotId === shot.id ? "border-[#D2FF44] shadow-[0_0_15px_rgba(210,255,68,0.1)]" : "border-zinc-800 hover:border-zinc-600"}`}
            >
              <div className="absolute inset-0 bg-zinc-900">
                {shot.previewBase64 && (
                  <img
                    src={shot.previewBase64}
                    className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                  />
                )}
              </div>
              <div className="absolute top-2 left-2 bg-black/60 backdrop-blur px-1.5 py-0.5 rounded text-[10px] font-bold text-white border border-white/10">
                {index + 1}
              </div>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExtendShot(shot);
                  }}
                  className="bg-black/60 hover:bg-[#D2FF44] hover:text-black text-white p-1 rounded backdrop-blur transition-colors"
                >
                  <LinkIcon size={12} />
                </button>
                <button
                  onClick={(e) => handleDeleteShot(e, shot.id)}
                  className="bg-black/60 hover:bg-red-500 text-white p-1 rounded backdrop-blur transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/90 to-transparent p-2">
                <div className="text-[10px] font-bold text-white truncate">
                  {shot.name}
                </div>
                <div className="text-[9px] text-zinc-400 font-mono">4s</div>
              </div>
            </div>
          ))}
          <button
            onClick={handleAddShot}
            className="flex-shrink-0 w-12 h-28 rounded-lg border border-dashed border-zinc-800 hover:border-[#D2FF44] hover:bg-zinc-900/50 flex items-center justify-center text-zinc-600 hover:text-[#D2FF44] transition-all"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={<div className="p-10 text-[#D2FF44]">Loading...</div>}>
      <StudioContent />
    </Suspense>
  );
}
