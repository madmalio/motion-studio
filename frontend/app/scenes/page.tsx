"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Plus, MoreVertical, Film, Search } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { GetProject, CreateScene, GetScenes } from "../../wailsjs/go/main/App";

interface Project {
  id: string;
  name: string;
}
interface Scene {
  id: string;
  name: string;
  shotCount: number;
}

function ScenesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") || "";

  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSceneName, setNewSceneName] = useState("");

  useEffect(() => {
    if (projectId) loadData(projectId);
  }, [projectId]);

  const loadData = async (id: string) => {
    const p = await GetProject(id);
    setProject(p);
    const s = await GetScenes(id);
    setScenes(s || []);
  };

  const handleCreateScene = async () => {
    if (!projectId || !newSceneName) return;
    await CreateScene(projectId, newSceneName);
    await loadData(projectId);
    setIsModalOpen(false);
    setNewSceneName("");
  };

  if (!project) return <div className="p-10 text-white">Loading...</div>;

  return (
    <>
      {/* HEADER: Changed w-screen to w-full */}
      <header className="h-16 w-full border-b border-zinc-800 flex items-center justify-between px-8 bg-[#09090b] shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-3">
            {project.name}
          </h1>
          <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider pl-0.5">
            Scene Manager
          </span>
        </div>

        <div className="flex gap-4">
          <div className="hidden md:flex items-center bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 w-48">
            <Search size={14} className="text-zinc-500 mr-2" />
            <input
              className="bg-transparent outline-none text-xs text-white w-full placeholder-zinc-600"
              placeholder="Find scene..."
            />
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-[#D2FF44] hover:bg-[#c2eb39] text-black text-xs font-bold px-4 py-2 rounded flex items-center gap-2 transition-colors"
          >
            <Plus size={16} strokeWidth={3} />
            NEW SCENE
          </button>
        </div>
      </header>

      {/* GRID: Ensure w-full */}
      <div className="flex-1 w-full overflow-y-auto p-8">
        <div className="max-w-[1600px] mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {/* Create Card */}
          <div
            onClick={() => setIsModalOpen(true)}
            className="aspect-[16/10] border border-dashed border-zinc-800 rounded-lg flex flex-col items-center justify-center gap-3 text-zinc-600 hover:text-[#D2FF44] hover:border-[#D2FF44] hover:bg-zinc-900/40 transition-all cursor-pointer group"
          >
            <div className="h-10 w-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Plus size={20} />
            </div>
            <span className="text-xs font-bold">Add Scene</span>
          </div>

          {/* Scene Cards */}
          {scenes.map((scene) => (
            <div
              key={scene.id}
              onClick={() =>
                router.push(
                  `/studio?sceneId=${scene.id}&projectId=${projectId}`,
                )
              }
              className="group aspect-[16/10] bg-zinc-900 border border-zinc-800 rounded-lg p-5 hover:border-[#D2FF44]/50 hover:shadow-lg transition-all cursor-pointer relative flex flex-col justify-between"
            >
              <div className="flex justify-between items-start">
                <div className="h-8 w-8 bg-zinc-800 rounded flex items-center justify-center text-[#D2FF44]">
                  <Film size={16} />
                </div>
                <button className="text-zinc-600 hover:text-white">
                  <MoreVertical size={16} />
                </button>
              </div>

              <div>
                <h3 className="font-bold text-white group-hover:text-[#D2FF44] transition-colors truncate">
                  {scene.name}
                </h3>
                <p className="text-[10px] text-zinc-500 font-mono mt-1">
                  {scene.shotCount} SHOTS
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <div className="bg-[#09090b] border border-zinc-800 w-96 rounded-lg shadow-2xl p-6">
            <h3 className="font-bold text-white mb-4">New Scene</h3>
            <input
              autoFocus
              className="w-full bg-zinc-900 border border-zinc-700 rounded p-3 text-sm text-white focus:border-[#D2FF44] outline-none placeholder-zinc-500 mb-6"
              placeholder="Scene Name"
              value={newSceneName}
              onChange={(e) => setNewSceneName(e.target.value)}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateScene}
                className="px-6 py-2 text-xs font-bold bg-[#D2FF44] text-black rounded hover:opacity-90"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ScenesPage() {
  return (
    <Suspense
      fallback={<div className="text-white p-10">Loading Scenes...</div>}
    >
      <ScenesContent />
    </Suspense>
  );
}
