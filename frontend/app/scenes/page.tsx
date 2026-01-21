"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Plus, MoreVertical, Film, Search } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import {
  GetProject,
  CreateScene,
  GetScenes,
  DeleteScene,
  ReadImageBase64,
} from "../../wailsjs/go/main/App";
import CardMenu from "../../components/CardMenu";
import { useConfirm } from "../../components/ConfirmProvider";

interface Project {
  id: string;
  name: string;
}
interface Scene {
  id: string;
  name: string;
  shotCount: number;
  thumbnail: string;
  displayThumbnail?: string;
}

function ScenesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") || "";

  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newSceneName, setNewSceneName] = useState("");
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const { confirm } = useConfirm();

  useEffect(() => {
    if (projectId) loadData(projectId);
  }, [projectId]);

  const loadData = async (id: string) => {
    const p = await GetProject(id);
    setProject(p);
    const s = await GetScenes(id);

    if (s) {
      const hydrated = await Promise.all(
        s.map(async (scene: any) => {
          if (scene.thumbnail) {
            const b64 = await ReadImageBase64(scene.thumbnail);
            return { ...scene, displayThumbnail: b64 };
          }
          return scene;
        }),
      );
      setScenes(hydrated);
    } else {
      setScenes([]);
    }
  };

  const handleSave = async () => {
    if (!projectId || !newSceneName) return;

    if (editingScene) {
      // TODO: Implement UpdateScene in backend
      // For now, just update local state to reflect change immediately
      setScenes((prev) =>
        prev.map((s) =>
          s.id === editingScene.id ? { ...s, name: newSceneName } : s,
        ),
      );
    } else {
      await CreateScene(projectId, newSceneName);
      await loadData(projectId);
    }

    setIsModalOpen(false);
    setNewSceneName("");
    setEditingScene(null);
  };

  const openNewSceneModal = () => {
    setEditingScene(null);
    setNewSceneName("");
    setIsModalOpen(true);
  };

  const handleEdit = (scene: Scene) => {
    setEditingScene(scene);
    setNewSceneName(scene.name);
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    confirm({
      title: "Delete Scene?",
      message: "This will permanently delete the scene and all its shots.",
      confirmText: "Delete",
      variant: "danger",
      onConfirm: async () => {
        await DeleteScene(projectId, id);
        setScenes((prev) => prev.filter((s) => s.id !== id));
      },
    });
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
            onClick={openNewSceneModal}
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
            onClick={openNewSceneModal}
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
              className="group aspect-[16/10] bg-zinc-900 border border-zinc-800 rounded-lg hover:border-[#D2FF44]/50 hover:shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-all cursor-pointer relative"
            >
              {/* Image Area */}
              <div className="absolute inset-0 overflow-hidden rounded-lg bg-zinc-950">
                {scene.displayThumbnail ? (
                  <img
                    src={scene.displayThumbnail}
                    className="w-full h-full object-cover opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center opacity-60 group-hover:opacity-100 transition-all">
                    <Film className="text-zinc-700" size={32} />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
              </div>

              {/* Content Footer */}
              <div className="absolute bottom-0 left-0 w-full p-3 flex justify-between items-end z-10">
                <div>
                  <h3 className="text-sm font-bold text-white group-hover:text-[#D2FF44] transition-colors leading-tight truncate pr-2">
                    {scene.name}
                  </h3>
                  <p className="text-[10px] text-zinc-400 font-bold tracking-wider mt-0.5 uppercase">
                    {scene.shotCount} SHOTS
                  </p>
                </div>
                <CardMenu
                  onDelete={() => handleDelete(scene.id)}
                  onRename={() => handleEdit(scene)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <div className="bg-[#09090b] border border-zinc-800 w-96 rounded-lg shadow-2xl p-6">
            <h3 className="font-bold text-white mb-4">
              {editingScene ? "Edit Scene" : "New Scene"}
            </h3>
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
                onClick={handleSave}
                className="px-6 py-2 text-xs font-bold bg-[#D2FF44] text-black rounded hover:opacity-90"
              >
                {editingScene ? "Save" : "Create"}
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
