"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import {
  X,
  Server,
  CheckCircle2,
  XCircle,
  Loader2,
  FileJson,
  Settings2,
  Upload,
  Trash2,
  Edit3,
  RefreshCw,
} from "lucide-react";
import {
  GetComfyURL,
  SetComfyURL,
  TestComfyConnection,
  GetWorkflows,
  ImportWorkflow,
  DeleteWorkflow,
  RenameWorkflow,
} from "../lib/wailsSafe";

interface SettingsContextType {
  openSettings: (tab?: "general" | "workflows") => void;
  closeSettings: () => void;
  workflows: { id: string; name: string; hasAudio: boolean }[]; // <--- UPDATED
  refreshWorkflows: () => Promise<void>;
  status: "idle" | "testing" | "success" | "error";
}

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context)
    throw new Error("useSettings must be used within a SettingsProvider");
  return context;
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "workflows">(
    "general",
  );

  // General Settings State
  const [url, setUrl] = useState("http://127.0.0.1:8188");
  const [status, setStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");

  // Workflow State (Now includes hasAudio)
  const [workflows, setWorkflows] = useState<
    { id: string; name: string; hasAudio: boolean }[]
  >([]);
  const [workflowMsg, setWorkflowMsg] = useState("");

  // Import/Rename State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importName, setImportName] = useState("");
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [newName, setNewName] = useState("");

  // 1. Initial Load
  useEffect(() => {
    refreshWorkflows();

    GetComfyURL().then((current: string) => {
      if (current) setUrl(current);
    });
  }, []);

  // 2. SMART CHECKER (Typing Debounce)
  useEffect(() => {
    if (!isOpen) return;
    if (status === "idle") setStatus("testing");

    const timer = setTimeout(async () => {
      await SetComfyURL(url);
      handleTest();
    }, 800);

    return () => clearTimeout(timer);
  }, [url, isOpen]);

  // 3. SYSTEM HEARTBEAT
  useEffect(() => {
    const heartbeat = async () => {
      if (status === "testing") return;
      const success = await TestComfyConnection();

      setStatus((prev) => {
        if (prev === "testing") return prev;
        if (success && prev !== "success") return "success";
        if (!success && prev !== "error") return "error";
        return prev;
      });
    };

    heartbeat();
    const interval = setInterval(heartbeat, 3000);
    return () => clearInterval(interval);
  }, [status]);

  const refreshWorkflows = async () => {
    // The backend now returns { id, name, hasAudio }
    const list = await GetWorkflows();
    setWorkflows(list);
  };

  const openSettings = (tab: "general" | "workflows" = "general") => {
    setActiveTab(tab);
    setIsOpen(true);
  };

  const handleTest = async () => {
    setStatus("testing");
    await SetComfyURL(url);
    const success = await TestComfyConnection();
    setStatus(success ? "success" : "error");
  };

  const handleSave = async () => {
    await SetComfyURL(url);
    setIsOpen(false);
  };

  // --- WORKFLOW ACTIONS ---
  const startImport = () => {
    setImportName("");
    setShowImportModal(true);
  };

  const finalizeImport = async () => {
    if (!importName) return;
    setShowImportModal(false);
    const result = await ImportWorkflow(importName);
    if (result === "Success") {
      setWorkflowMsg("Workflow imported!");
      refreshWorkflows();
    } else if (result) {
      setWorkflowMsg("Error: " + result);
    }
    setTimeout(() => setWorkflowMsg(""), 3000);
  };

  const startRename = (wf: { id: string; name: string }) => {
    setRenameTarget(wf);
    setNewName(wf.name);
    setShowRenameModal(true);
  };

  const finalizeRename = async () => {
    if (!renameTarget || !newName) return;
    setShowRenameModal(false);
    const result = await RenameWorkflow(renameTarget.id, newName);
    if (result === "Success") {
      setWorkflowMsg("Renamed successfully!");
      refreshWorkflows();
    } else {
      setWorkflowMsg("Error: " + result);
    }
    setTimeout(() => setWorkflowMsg(""), 3000);
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;
    const result = await DeleteWorkflow(name);
    if (result === "Success") {
      refreshWorkflows();
    } else {
      alert(result);
    }
  };

  return (
    <SettingsContext.Provider
      value={{
        openSettings,
        closeSettings: () => setIsOpen(false),
        workflows,
        refreshWorkflows,
        status,
      }}
    >
      {children}

      {/* SETTINGS MODAL */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#09090b] border border-zinc-800 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-row h-[500px] animate-in zoom-in-95 duration-200 relative">
            {/* SIDEBAR */}
            <div className="w-48 bg-zinc-900/50 border-r border-zinc-800 p-4 flex flex-col gap-2">
              <h2 className="text-sm font-bold text-white mb-4 px-2">
                Settings
              </h2>
              <button
                onClick={() => setActiveTab("general")}
                className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition-colors ${
                  activeTab === "general"
                    ? "bg-[#D2FF44] text-black"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                <Settings2 size={14} /> General
              </button>
              <button
                onClick={() => setActiveTab("workflows")}
                className={`flex items-center gap-3 px-3 py-2 rounded text-xs font-medium transition-colors ${
                  activeTab === "workflows"
                    ? "bg-[#D2FF44] text-black"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                <FileJson size={14} /> Workflows
              </button>
            </div>

            {/* CONTENT */}
            <div className="flex-1 flex flex-col min-w-0 bg-[#09090b]">
              <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-6 shrink-0">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  {activeTab === "general"
                    ? "Connection Settings"
                    : "Workflow Manager"}
                </span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-zinc-500 hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {/* GENERAL TAB */}
                {activeTab === "general" && (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                        <Server size={12} /> ComfyUI Backend URL
                      </label>

                      <div className="relative group">
                        <input
                          className={`w-full bg-zinc-900 border rounded p-2 pr-10 text-sm text-white outline-none font-mono placeholder-zinc-600 transition-colors
                            ${status === "success" ? "border-[#D2FF44]/50 focus:border-[#D2FF44]" : ""}
                            ${status === "error" ? "border-red-500/50 focus:border-red-500" : ""}
                            ${status === "testing" || status === "idle" ? "border-zinc-800 focus:border-zinc-600" : ""}
                          `}
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder="http://127.0.0.1:8188"
                        />
                        <div className="absolute right-3 top-2.5">
                          {status === "testing" && (
                            <Loader2
                              size={16}
                              className="animate-spin text-zinc-500"
                            />
                          )}
                          {status === "success" && (
                            <CheckCircle2
                              size={16}
                              className="text-[#D2FF44]"
                            />
                          )}
                          {status === "error" && (
                            <button
                              onClick={handleTest}
                              className="text-red-500 hover:text-white transition-colors animate-in zoom-in duration-200"
                            >
                              <RefreshCw size={16} />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="h-5">
                        {status === "testing" && (
                          <p className="text-[10px] text-zinc-500 animate-pulse">
                            Checking connection...
                          </p>
                        )}
                        {status === "success" && (
                          <p className="text-[10px] text-[#D2FF44]">
                            Connected to ComfyUI
                          </p>
                        )}
                        {status === "error" && (
                          <p className="text-[10px] text-red-500">
                            Not connected. Is ComfyUI running?
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* WORKFLOWS TAB */}
                {activeTab === "workflows" && (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs text-zinc-500">
                        {workflows.length} templates installed
                      </p>
                      <button
                        onClick={startImport}
                        className="text-xs bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                      >
                        <Upload size={12} /> Import JSON
                      </button>
                    </div>

                    {workflowMsg && (
                      <div className="mb-4 px-3 py-2 bg-[#D2FF44]/10 text-[#D2FF44] text-xs rounded border border-[#D2FF44]/20">
                        {workflowMsg}
                      </div>
                    )}

                    <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                      {workflows.map((wf) => (
                        <div
                          key={wf.id}
                          className="group flex items-center justify-between bg-zinc-900 border border-zinc-800 p-3 rounded hover:border-zinc-600 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-8 h-8 rounded bg-zinc-800 flex items-center justify-center ${wf.hasAudio ? "text-[#D2FF44]" : "text-zinc-500"} group-hover:text-[#D2FF44] group-hover:bg-zinc-800`}
                            >
                              <FileJson size={16} />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-zinc-200 flex gap-2 items-center">
                                {wf.name}
                                {wf.hasAudio && (
                                  <span className="text-[9px] bg-[#D2FF44]/20 text-[#D2FF44] px-1 rounded">
                                    AUDIO
                                  </span>
                                )}
                              </span>
                              <span className="text-[10px] text-zinc-500 font-mono">
                                {wf.id}.json
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => startRename(wf)}
                              className="p-1.5 text-zinc-600 hover:text-white hover:bg-zinc-700 rounded transition-colors"
                              title="Rename"
                            >
                              <Edit3 size={14} />
                            </button>
                            {wf.id !== "default" && (
                              <button
                                onClick={() => handleDelete(wf.id)}
                                className="p-1.5 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* FOOTER */}
              {activeTab === "general" && (
                <div className="p-4 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-900/30">
                  <button
                    onClick={() => setIsOpen(false)}
                    className="px-6 py-2 text-xs font-bold bg-[#D2FF44] text-black rounded hover:opacity-90"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>

            {/* IMPORT MODAL */}
            {showImportModal && (
              <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-8">
                <div className="bg-[#09090b] border border-zinc-700 w-full max-w-sm rounded-lg shadow-2xl p-6 animate-in zoom-in-95 duration-200">
                  <h3 className="text-sm font-bold text-white mb-4">
                    Import Workflow
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-zinc-500 mb-1.5 block">
                        Display Name
                      </label>
                      <input
                        autoFocus
                        className="w-full bg-zinc-900 border border-zinc-700 rounded p-2.5 text-sm text-white focus:border-[#D2FF44] outline-none placeholder-zinc-600"
                        placeholder="e.g. SVD Slow Motion"
                        value={importName}
                        onChange={(e) => setImportName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && finalizeImport()}
                      />
                    </div>
                    <div className="flex justify-end gap-3 mt-4">
                      <button
                        onClick={() => setShowImportModal(false)}
                        className="px-3 py-2 text-xs font-bold text-zinc-400 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={finalizeImport}
                        disabled={!importName}
                        className="px-4 py-2 text-xs font-bold bg-[#D2FF44] text-black rounded hover:opacity-90 disabled:opacity-50"
                      >
                        Choose File...
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* RENAME MODAL */}
            {showRenameModal && (
              <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-[2px] flex items-center justify-center p-8">
                <div className="bg-[#09090b] border border-zinc-700 w-full max-w-sm rounded-lg shadow-2xl p-6 animate-in zoom-in-95 duration-200">
                  <h3 className="text-sm font-bold text-white mb-4">
                    Rename Workflow
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-zinc-500 mb-1.5 block">
                        New Name
                      </label>
                      <input
                        autoFocus
                        className="w-full bg-zinc-900 border border-zinc-700 rounded p-2.5 text-sm text-white focus:border-[#D2FF44] outline-none placeholder-zinc-600"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && finalizeRename()}
                      />
                    </div>
                    <div className="flex justify-end gap-3 mt-4">
                      <button
                        onClick={() => setShowRenameModal(false)}
                        className="px-3 py-2 text-xs font-bold text-zinc-400 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={finalizeRename}
                        disabled={!newName}
                        className="px-4 py-2 text-xs font-bold bg-[#D2FF44] text-black rounded hover:opacity-90 disabled:opacity-50"
                      >
                        Rename
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </SettingsContext.Provider>
  );
}
