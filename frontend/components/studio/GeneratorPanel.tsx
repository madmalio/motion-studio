"use client";

import { ImageIcon, Wand2, Loader2, Play, FileJson } from "lucide-react";
import { memo, useEffect, useState } from "react";
import {
  SelectImage,
  ReadImageBase64,
  RenderShot,
  SetProjectThumbnail,
  GetWorkflows,
} from "../../wailsjs/go/main/App";

const GeneratorPanel = memo(function GeneratorPanel({
  activeShot,
  updateActiveShot,
  project,
  scene,
  isRendering,
  setIsRendering,
  setVideoCache,
  setVideoSrc,
}: any) {
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>("");

  useEffect(() => {
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    const wfs = await GetWorkflows();
    setWorkflows(wfs);
    if (wfs.length > 0 && !selectedWorkflow) setSelectedWorkflow(wfs[0].id);
  };

  const handleUpload = async () => {
    const path = await SelectImage();
    if (path) {
      const b64 = await ReadImageBase64(path);
      updateActiveShot({ sourceImage: path, previewBase64: b64 });
    }
  };

  const handleSetThumbnail = async () => {
    if (!activeShot?.sourceImage || !project) return;
    await SetProjectThumbnail(project.id, activeShot.sourceImage);
    alert("Project thumbnail updated!");
  };

  const handleRenderShot = async () => {
    if (!activeShot?.id || !project || !scene) return;
    setIsRendering(true);
    try {
      const updatedShot = await RenderShot(
        project.id,
        scene.id,
        activeShot.id,
        selectedWorkflow,
      );
      if (updatedShot.outputVideo) {
        const b64 = await ReadImageBase64(updatedShot.outputVideo);
        setVideoCache(updatedShot.id, b64);
        setVideoSrc(b64);
      }
      updateActiveShot(updatedShot);
    } catch (err) {
      console.error("Render failed:", err);
      alert(`Render failed: ${err}`);
    }
    setIsRendering(false);
  };

  if (!activeShot) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
        Select a shot to edit
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      {/* Image Input */}
      <div>
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <ImageIcon size={12} /> Source Image
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
        {activeShot.sourceImage && (
          <button
            onClick={handleSetThumbnail}
            className="w-full mt-2 text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 py-1 rounded transition-colors"
          >
            Set as Project Thumbnail
          </button>
        )}
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
        <div className="space-y-2">
          <label className="text-xs text-zinc-400">Workflow</label>
          <select
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white outline-none focus:border-[#D2FF44]"
            value={selectedWorkflow}
            onChange={(e) => setSelectedWorkflow(e.target.value)}
          >
            {workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>
                {wf.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs text-zinc-400">
            <label>Seed</label>
            <span className="font-mono text-[10px]">{activeShot.seed}</span>
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
                updateActiveShot({ seed: Math.floor(Math.random() * 1000000) })
              }
              className="bg-zinc-800 px-2 rounded hover:bg-zinc-700 text-zinc-400"
              title="Randomize"
            >
              🎲
            </button>
          </div>
        </div>

        <button
          onClick={handleRenderShot}
          disabled={isRendering}
          className={`w-full py-3 mt-4 rounded font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all
                        ${isRendering ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" : "bg-[#D2FF44] text-black hover:bg-[#c2eb39]"}
                    `}
        >
          {isRendering ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <Play size={14} fill="black" />
          )}
          {isRendering ? "Rendering..." : "Render Shot"}
        </button>
      </div>
    </div>
  );
});

export default GeneratorPanel;
