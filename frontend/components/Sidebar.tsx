"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Home, Settings, Clapperboard, Layers } from "lucide-react";

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The sidebar reads the ID directly from the URL now
  const projectId = searchParams.get("projectId");

  // If we aren't in a project (no ID), don't render the sidebar?
  // actually the parent Shell will handle hiding it, but this is a safe fallback.
  if (!projectId) return null;

  return (
    <aside className="w-16 bg-[#09090b] border-r border-zinc-800 flex flex-col items-center py-6 gap-6 shrink-0 z-50 h-full">
      {/* 1. HOME (Exits Project) */}
      <button
        onClick={() => router.push("/")}
        className="p-3 rounded-xl bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all mb-4 border border-zinc-800"
        title="Back to Dashboard"
      >
        <Home size={20} />
      </button>

      {/* 2. SCENES (Project Root) */}
      <NavButton
        active={pathname.includes("/scenes")}
        onClick={() => router.push(`/scenes?projectId=${projectId}`)}
        icon={<Layers size={20} />}
        label="Scenes"
      />

      {/* 3. STUDIO (Editor) */}
      <NavButton
        active={pathname.includes("/studio")}
        onClick={() => {}} // User clicks specific scene to enter
        icon={<Clapperboard size={20} />}
        label="Studio"
        disabled={!pathname.includes("/studio")}
      />

      <div className="flex-1" />

      {/* 4. SETTINGS */}
      <button className="text-zinc-600 hover:text-[#D2FF44] transition-colors mb-4">
        <Settings size={20} />
      </button>
    </aside>
  );
}

function NavButton({ active, onClick, icon, disabled = false, label }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        relative group p-3 rounded-xl transition-all duration-300
        ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
        ${
          active
            ? "bg-[#D2FF44] text-black shadow-[0_0_15px_rgba(210,255,68,0.3)]"
            : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        }
      `}
    >
      {icon}
      {!active && !disabled && (
        <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-zinc-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-zinc-700 z-50">
          {label}
        </div>
      )}
    </button>
  );
}
