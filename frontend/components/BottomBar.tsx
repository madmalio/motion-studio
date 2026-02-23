"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Home, Settings, Clapperboard, Layers, ChevronRight, Download, Library } from "lucide-react";
import { useSettings } from "./SettingsProvider";
import { useStudio } from "./StudioProvider";
import { useEffect, useState } from "react";
import { GetProject, GetScenes } from "../lib/wailsSafe";

interface Project {
  id: string;
  name: string;
}

interface Scene {
  id: string;
  name: string;
}

export default function BottomBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { openSettings } = useSettings();
  const { openExportModal, openAssetLibrary } = useStudio();

  const projectId = searchParams.get("projectId");
  const sceneId = searchParams.get("sceneId");

  const [project, setProject] = useState<Project | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);

  useEffect(() => {
    if (projectId) {
      GetProject(projectId).then(setProject).catch(console.error);
    } else {
      setProject(null);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId && sceneId) {
      GetScenes(projectId).then(scenes => {
        const found = scenes.find((s: any) => s.id === sceneId);
        setScene(found || null);
      }).catch(console.error);
    } else {
      setScene(null);
    }
  }, [projectId, sceneId]);

  if (!projectId) return null;

  const isScenes = pathname.includes("/scenes");
  const isStudio = pathname.includes("/studio");

  return (
    <footer className="h-12 bg-[#09090b]/80 backdrop-blur-md border-t border-zinc-800 flex flex-row items-center px-4 gap-4 shrink-0 z-50 w-full justify-between relative">
      {/* LEFT: CONTEXT & BREADCRUMBS */}
      <div className="flex flex-row items-center gap-3 min-w-0">
        <button
          onClick={() => router.push("/")}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800/50 transition-all shrink-0"
          title="Back to Dashboard"
        >
          <Home size={16} />
        </button>
        
        <div className="w-px h-4 bg-zinc-800 mx-1 shrink-0" />

        <div className="flex items-center gap-2 text-[11px] font-medium tracking-tight overflow-hidden whitespace-nowrap">
          <span className="text-zinc-600 uppercase tracking-widest text-[9px] font-bold shrink-0">Project</span>
          <span className="text-zinc-200 truncate max-w-[120px] font-bold">{project?.name || "..."}</span>
          
          {scene && (
            <>
              <ChevronRight size={12} className="text-zinc-700 shrink-0" />
              <span className="text-zinc-600 uppercase tracking-widest text-[9px] font-bold shrink-0">Scene</span>
              <span className="text-[#D2FF44] truncate max-w-[120px] font-bold">{scene.name}</span>
            </>
          )}
        </div>
      </div>

      {/* CENTER: MODE SWITCHER */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-zinc-900/40 border border-zinc-800/50 rounded-full p-1 gap-0.5">
        <ModeButton
          active={isScenes}
          onClick={() => router.push(`/scenes?projectId=${projectId}`)}
          icon={<Layers size={14} />}
          label="Manager"
        />
        <ModeButton
          active={isStudio}
          onClick={() => sceneId && router.push(`/studio?sceneId=${sceneId}&projectId=${projectId}`)}
          icon={<Clapperboard size={14} />}
          label="Studio"
          disabled={!sceneId}
        />
      </div>

      {/* RIGHT: STATUS & UTILS */}
      <div className="flex items-center gap-4">
        {isStudio && (
          <>
            <button
              onClick={() => openAssetLibrary()}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-[#D2FF44] hover:bg-zinc-800/50 transition-all flex items-center gap-2"
              title="Asset Library"
            >
              <Library size={16} />
              <span className="text-[10px] font-bold uppercase tracking-wider hidden lg:block">Assets</span>
            </button>
            <div className="w-px h-4 bg-zinc-800" />

            <button
              onClick={() => openExportModal()}
              className="bg-[#D2FF44] hover:bg-[#c2eb39] text-black text-[10px] font-black px-4 py-1.5 rounded-full flex items-center gap-2 transition-all hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(210,255,68,0.2)]"
            >
              <Download size={14} strokeWidth={3} />
              EXPORT
            </button>
            <div className="w-px h-4 bg-zinc-800 hidden md:block" />
          </>
        )}

        <button
          onClick={() => openSettings()}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-[#D2FF44] hover:bg-zinc-800/50 transition-all"
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </footer>
  );
}

function ModeButton({ active, onClick, icon, label, disabled }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center gap-2 px-4 py-1.5 rounded-full transition-all duration-300
        ${disabled ? "opacity-20 cursor-not-allowed" : "cursor-pointer"}
        ${active 
          ? "bg-zinc-800 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]" 
          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30"}
      `}
    >
      <span className={`${active ? "text-[#D2FF44]" : "text-zinc-600"} transition-colors`}>{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}
