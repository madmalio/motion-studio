"use client";

import {
  ImageIcon,
  Wand2,
  Loader2,
  Play,
  Settings,
  Music,
  X,
} from "lucide-react";
import { memo, useState, useEffect, useRef } from "react";
import {
  SelectImage,
  SelectAudio,
  ReadImageBase64,
  RenderShot,
  SetProjectThumbnail,
} from "../../wailsjs/go/main/App";
import { EventsOn, EventsOff } from "../../wailsjs/runtime";
import { useSettings } from "../SettingsProvider";
import AudioWaveform from "./AudioWaveform";

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
  const { workflows, openSettings, status } = useSettings();
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>("");

  // --- PROGRESS STATE ---
  const [progress, setProgress] = useState(0);
  const [progressStatus, setProgressStatus] = useState("Initializing...");

  // Auto-select workflow
  useEffect(() => {
    if (workflows && workflows.length > 0 && !selectedWorkflow) {
      setSelectedWorkflow(workflows[0].id);
    }
  }, [workflows, selectedWorkflow]);

  // Determine if audio is needed
  const currentWorkflowData = workflows.find((w) => w.id === selectedWorkflow);
  const showAudioInput = currentWorkflowData?.hasAudio;

  // --- LISTENER (WEBSOCKET PROGRESS) ---
  useEffect(() => {
    if (!isRendering) return;

    const stopProgress = EventsOn("comfy:progress", (p: number) => {
      setProgress(p);
      setProgressStatus(`Rendering (${p}%)`);
    });

    const stopStatus = EventsOn("comfy:status", (s: string) => {
      setProgressStatus(s);
    });

    return () => {
      stopProgress(); // Clean up listeners
      stopStatus();
    };
  }, [isRendering]);

  // --- HANDLERS ---

  const handleUpload = async () => {
    const path = await SelectImage();
    if (path) {
      const b64 = await ReadImageBase64(path);
      updateActiveShot({ sourceImage: path, previewBase64: b64 });
    }
  };

  const handleAudioUpload = async () => {
    const path = await SelectAudio();
    if (path) {
      // Reset trim settings when new file is loaded
      updateActiveShot({ audioPath: path, audioStart: 0, audioDuration: 0 });
    }
  };

  const handleClearAudio = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateActiveShot({ audioPath: "", audioStart: 0, audioDuration: 0 });
  };

  // Helper to stream local files
  const getLocalMediaUrl = (path: string) => {
    if (!path) return "";
    const cleanPath = path.replace(/\\/g, "/");
    return `http://localhost:3456/video/${cleanPath}`;
  };

  const handleSetThumbnail = async () => {
    if (!activeShot?.sourceImage || !project) return;
    await SetProjectThumbnail(project.id, activeShot.sourceImage);
    alert("Project thumbnail updated!");
  };

  const handleRenderShot = async () => {
    if (!activeShot?.id || !project || !scene) return;

    setIsRendering(true);
    setProgress(0);
    setProgressStatus("Starting...");

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
    setProgress(0);
  };

  if (!activeShot)
    return <div className="p-10 text-xs text-zinc-500">Select a shot</div>;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      {/* STATUS PILL */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-100">Generator</h2>
        <div
          onClick={() => status === "error" && openSettings("general")}
          className={`
                flex items-center gap-2 px-2 py-0.5 rounded-full border cursor-default transition-all
                ${status === "success" ? "border-[#D2FF44]/30 bg-[#D2FF44]/5 text-[#D2FF44]" : ""}
                ${status === "error" ? "border-red-500/30 bg-red-500/5 text-red-500 cursor-pointer hover:bg-red-500/10" : ""}
                ${status === "testing" || status === "idle" ? "border-zinc-700 bg-zinc-900 text-zinc-500" : ""}
            `}
        >
          {status === "testing" ? (
            <Loader2 size={8} className="animate-spin" />
          ) : (
            <div
              className={`w-1.5 h-1.5 rounded-full ${status === "success" ? "bg-[#D2FF44]" : status === "error" ? "bg-red-500" : "bg-zinc-600"}`}
            />
          )}
          <span className="text-[9px] font-bold uppercase tracking-wider">
            {status === "success" && "System Ready"}
            {status === "error" && "Offline"}
            {(status === "testing" || status === "idle") && "Connecting..."}
          </span>
        </div>
      </div>

      {/* IMAGE INPUT */}
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
            className="w-full mt-2 text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white py-1 rounded"
          >
            Set as Project Thumbnail
          </button>
        )}
      </div>

      {/* SMART AUDIO INPUT */}
      {showAudioInput && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Music size={12} /> Audio Source
          </h3>

          {!activeShot.audioPath && (
            <div
              onClick={handleAudioUpload}
              className="w-full h-10 border border-dashed border-zinc-800 rounded px-3 flex items-center gap-3 cursor-pointer bg-zinc-900/50 hover:border-[#D2FF44] hover:text-white text-zinc-600 transition-all"
            >
              <Music size={14} />
              <span className="text-xs font-mono">Select Audio File...</span>
            </div>
          )}

          {activeShot.audioPath && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1">
                <span className="truncate max-w-[200px]">
                  {activeShot.audioPath.split(/[\\/]/).pop()}
                </span>
                <button
                  onClick={handleClearAudio}
                  className="hover:text-red-500 flex items-center gap-1"
                >
                  <X size={10} /> Clear
                </button>
              </div>

              <AudioWaveform
                url={getLocalMediaUrl(activeShot.audioPath)}
                startTime={activeShot.audioStart || 0}
                duration={activeShot.audioDuration || 0}
                onTrimChange={(start, duration) => {
                  updateActiveShot({
                    audioStart: start,
                    audioDuration: duration,
                  });
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* PROMPT INPUT */}
      <div>
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Wand2 size={12} /> Prompt
        </h3>
        <textarea
          className="w-full bg-zinc-900 border border-zinc-800 rounded-md p-3 text-xs text-white focus:border-[#D2FF44] outline-none resize-none h-24 placeholder-zinc-600"
          placeholder="Describe the motion..."
          value={activeShot.prompt}
          onChange={(e) => updateActiveShot({ prompt: e.target.value })}
        />
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs text-zinc-400">Workflow</label>
          <div className="flex gap-2">
            <select
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white outline-none focus:border-[#D2FF44]"
              value={selectedWorkflow}
              onChange={(e) => setSelectedWorkflow(e.target.value)}
            >
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name} {wf.hasAudio ? "(Audio)" : ""}
                </option>
              ))}
            </select>
            <button
              onClick={() => openSettings("workflows")}
              className="px-2 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white"
              title="Manage"
            >
              <Settings size={14} />
            </button>
          </div>
        </div>

        {/* SEED SETTING */}
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

        {/* RENDER BUTTON WITH PROGRESS BAR */}
        <div className="mt-4">
          {isRendering ? (
            <div className="w-full h-10 bg-zinc-900 rounded border border-zinc-800 relative overflow-hidden flex items-center justify-center">
              {/* Background Bar */}
              <div
                className="absolute left-0 top-0 h-full bg-[#D2FF44]/20 transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
              <span className="relative text-xs font-bold text-[#D2FF44] flex items-center gap-2">
                <Loader2 className="animate-spin" size={12} />
                {progressStatus}
              </span>
            </div>
          ) : (
            <button
              onClick={handleRenderShot}
              disabled={status !== "success"}
              className={`w-full py-3 rounded font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all
                    ${status !== "success" ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" : "bg-[#D2FF44] text-black hover:bg-[#c2eb39]"}`}
            >
              <Play size={14} fill={status === "success" ? "black" : "gray"} />
              {status === "success" ? "Render Shot" : "System Offline"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default GeneratorPanel;
