"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Home, Settings, Clapperboard, Layers } from "lucide-react";
import { useSettings } from "./SettingsProvider";

export default function BottomBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { openSettings } = useSettings();

  // The sidebar reads the ID directly from the URL now
  const projectId = searchParams.get("projectId");

  // If we aren't in a project (no ID), don't render the sidebar?
  // actually the parent Shell will handle hiding it, but this is a safe fallback.
  if (!projectId) return null;

  return (
    <footer className="h-14 bg-[#09090b] border-t border-zinc-800 flex flex-row items-center px-6 gap-6 shrink-0 z-50 w-full justify-between">
      <div className="flex flex-row items-center gap-6">
        {/* 1. HOME (Exits Project) */}
        <button
          onClick={() => router.push("/")}
          className="p-2 rounded-xl bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all border border-zinc-800"
          title="Back to Dashboard"
        >
          <Home size={18} />
        </button>

        <div className="w-px h-8 bg-zinc-800" />

        {/* 2. SCENES (Project Root) */}
        <NavButton
          active={pathname.includes("/scenes")}
          onClick={() => router.push(`/scenes?projectId=${projectId}`)}
          icon={<Layers size={18} />}
          label="Scenes"
        />

        {/* 3. STUDIO (Editor) */}
        <NavButton
          active={pathname.includes("/studio")}
          onClick={() => {}} // User clicks specific scene to enter
          icon={<Clapperboard size={18} />}
          label="Studio"
          disabled={!pathname.includes("/studio")}
        />
      </div>

      {/* 4. SETTINGS */}
      <button
        onClick={openSettings}
        className="text-zinc-600 hover:text-[#D2FF44] transition-colors"
      >
        <Settings size={18} />
      </button>
    </footer>
  );
}

function NavButton({ active, onClick, icon, disabled = false, label }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        relative group p-2 rounded-xl transition-all duration-300 flex items-center gap-2
        ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
        ${
          active
            ? "bg-[#D2FF44] text-black shadow-[0_0_15px_rgba(210,255,68,0.3)]"
            : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        }
      `}
    >
      {icon}
      <span
        className={`text-xs font-medium ${active ? "text-black" : "text-zinc-400 group-hover:text-zinc-200"}`}
      >
        {label}
      </span>
    </button>
  );
}
