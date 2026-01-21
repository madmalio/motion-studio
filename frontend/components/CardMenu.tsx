"use client";

import { useState, useRef, useEffect } from "react";
import { MoreVertical, Trash2, FolderOpen, Edit3 } from "lucide-react";

interface CardMenuProps {
  onDelete: () => void;
  onOpenFolder?: () => void; // <--- Made Optional (?)
  onRename?: () => void; // <--- Made Optional (?)
}

export default function CardMenu({
  onDelete,
  onOpenFolder,
  onRename,
}: CardMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`p-1.5 rounded-md transition-colors ${isOpen ? "bg-[#D2FF44] text-black" : "text-zinc-500 hover:text-white hover:bg-zinc-800"}`}
      >
        <MoreVertical size={16} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-8 w-32 bg-[#09090b] border border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="flex flex-col p-1">
            {/* Only show Open Folder if the function exists */}
            {onOpenFolder && (
              <MenuItem
                icon={<FolderOpen size={14} />}
                label="Open"
                onClick={() => {
                  setIsOpen(false);
                  onOpenFolder();
                }}
              />
            )}

            {/* Only show Rename if the function exists */}
            {onRename && (
              <MenuItem
                icon={<Edit3 size={14} />}
                label="Edit"
                onClick={() => {
                  setIsOpen(false);
                  onRename();
                }}
              />
            )}

            <div className="h-px bg-zinc-800 my-1" />

            <MenuItem
              icon={<Trash2 size={14} />}
              label="Delete"
              onClick={() => {
                setIsOpen(false);
                onDelete();
              }}
              isDestructive
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, isDestructive }: any) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`
        flex items-center gap-2 w-full px-3 py-2 text-xs font-medium rounded-[4px] transition-colors
        ${isDestructive ? "text-red-500 hover:bg-red-500/10" : "text-zinc-400 hover:text-white hover:bg-zinc-800"}
      `}
    >
      {icon}
      {label}
    </button>
  );
}
