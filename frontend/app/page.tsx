"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  MoreVertical,
  Clapperboard,
  Search,
  LayoutGrid,
} from "lucide-react";

// --- WAILS IMPORTS ---
import { CreateProject, GetProjects } from "../wailsjs/go/main/App";

// --- TYPES ---
interface Project {
  id: string;
  name: string;
  type: string;
  thumbnail: string;
  updatedAt: string;
}

export default function Dashboard() {
  // --- STATE ---
  const [projects, setProjects] = useState<Project[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const router = useRouter();

  // Form State
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectFormat, setNewProjectFormat] = useState("16:9 (Cinematic)");

  // --- 1. LOAD DATA ON STARTUP ---
  useEffect(() => {
    refreshProjects();
  }, []);

  const refreshProjects = async () => {
    try {
      // Call Go Backend
      const data = await GetProjects();
      // Go returns null if empty, default to []
      setProjects(data || []);
    } catch (err) {
      console.error("Error loading projects:", err);
    }
  };

  // --- 2. CREATE PROJECT HANDLER ---
  const handleCreate = async () => {
    if (!newProjectName) return;

    try {
      // 1. Send data to Go to create folder & JSON
      await CreateProject(newProjectName, newProjectFormat);

      // 2. Refresh the list
      await refreshProjects();

      // 3. Reset & Close
      setNewProjectName("");
      setIsModalOpen(false);
    } catch (err) {
      console.error("Error creating project:", err);
    }
  };

  return (
    <main className="h-screen w-screen bg-[#09090b] text-white font-sans flex flex-col overflow-hidden selection:bg-[#D2FF44]/30">
      {/* --- HEADER --- */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-[#09090b] shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 bg-[#D2FF44] rounded flex items-center justify-center shadow-[0_0_10px_rgba(210,255,68,0.2)]">
            <Clapperboard className="text-black fill-black/10" size={18} />
          </div>
          <h1 className="text-lg font-bold tracking-tight text-white">
            MOTION <span className="text-[#D2FF44]">STUDIO</span>
          </h1>
        </div>

        {/* Search Bar */}
        <div className="hidden md:flex items-center bg-zinc-900 border border-zinc-800 rounded-full px-3 py-1.5 w-64 focus-within:border-[#D2FF44]/50 transition-all">
          <Search size={14} className="text-zinc-500 mr-2" />
          <input
            className="bg-transparent border-none outline-none text-sm text-white placeholder-zinc-600 w-full"
            placeholder="Search..."
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-[#D2FF44] hover:bg-[#c2eb39] text-black text-xs font-bold px-4 py-2 rounded flex items-center gap-2 transition-colors"
          >
            <Plus size={16} strokeWidth={3} />
            NEW PROJECT
          </button>
        </div>
      </header>

      {/* --- GRID AREA --- */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
              Recent Files
            </h2>
            <div className="flex gap-2">
              <LayoutGrid size={16} className="text-zinc-400" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {/* 1. CREATE NEW CARD (The Anchor) */}
            <div
              onClick={() => setIsModalOpen(true)}
              className="aspect-[16/10] border border-dashed border-zinc-800 rounded-lg flex flex-col items-center justify-center gap-3 text-zinc-600 hover:text-[#D2FF44] hover:border-[#D2FF44] hover:bg-zinc-900/40 transition-all cursor-pointer group"
            >
              <div className="h-10 w-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg">
                <Plus size={20} />
              </div>
              <span className="text-xs font-bold tracking-wide">
                Create New
              </span>
            </div>

            {/* 2. REAL PROJECT CARDS (From Go) */}
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => router.push(`/scenes?projectId=${project.id}`)}
                className="group aspect-[16/10] bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-[#D2FF44]/50 hover:shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-all cursor-pointer relative"
              >
                {/* Image Area */}
                <div className="h-full w-full relative bg-zinc-950">
                  {project.thumbnail ? (
                    <img
                      src={project.thumbnail}
                      className="w-full h-full object-cover opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-700">
                      <Clapperboard size={32} />
                    </div>
                  )}

                  {/* Gradient Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

                  {/* Content Footer */}
                  <div className="absolute bottom-0 left-0 w-full p-3 flex justify-between items-end">
                    <div>
                      <h3 className="text-sm font-bold text-white group-hover:text-[#D2FF44] transition-colors leading-tight">
                        {project.name}
                      </h3>
                      <p className="text-[10px] text-zinc-400 font-bold tracking-wider mt-0.5 uppercase">
                        {project.type}
                      </p>
                    </div>

                    {/* Menu Button */}
                    <button className="text-zinc-500 hover:text-white p-1 hover:bg-white/10 rounded">
                      <MoreVertical size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* --- CREATE MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <div className="bg-[#09090b] border border-zinc-800 w-96 rounded-lg shadow-2xl p-6">
            <h3 className="font-bold text-white mb-4 text-lg">New Project</h3>
            <div className="space-y-4">
              <input
                autoFocus
                className="w-full bg-zinc-900 border border-zinc-700 rounded p-3 text-sm text-white focus:border-[#D2FF44] outline-none placeholder-zinc-500"
                placeholder="Project Name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
              <select
                className="w-full bg-zinc-900 border border-zinc-700 rounded p-3 text-sm text-white focus:border-[#D2FF44] outline-none cursor-pointer"
                value={newProjectFormat}
                onChange={(e) => setNewProjectFormat(e.target.value)}
              >
                <option>16:9 (Cinematic)</option>
                <option>9:16 (Social)</option>
                <option>4:3 (Classic)</option>
              </select>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="px-6 py-2 text-xs font-bold bg-[#D2FF44] text-black rounded hover:opacity-90"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
