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
  Upload,
} from "lucide-react";
import {
  GetComfyURL,
  SetComfyURL,
  TestComfyConnection,
  CheckWorkflowExists,
  SelectAndSaveWorkflow,
} from "../wailsjs/go/main/App";

interface SettingsContextType {
  openSettings: () => void;
  closeSettings: () => void;
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
  const [url, setUrl] = useState("http://127.0.0.1:8188");
  const [status, setStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [hasWorkflow, setHasWorkflow] = useState(false);
  const [workflowMsg, setWorkflowMsg] = useState("");

  // Load initial URL when modal opens
  useEffect(() => {
    if (isOpen) {
      GetComfyURL().then((current: string) => {
        if (current) setUrl(current);
        setStatus("idle");
      });
      CheckWorkflowExists().then(setHasWorkflow);
    }
  }, [isOpen]);

  const handleSave = async () => {
    await SetComfyURL(url);
    setIsOpen(false);
  };

  const handleTest = async () => {
    setStatus("testing");
    // First update the backend with current input so it tests the right URL
    await SetComfyURL(url);
    const success = await TestComfyConnection();
    setStatus(success ? "success" : "error");
  };

  const handleImportWorkflow = async () => {
    const res = await SelectAndSaveWorkflow();
    if (res === "Success") {
      setHasWorkflow(true);
      setWorkflowMsg("Workflow updated successfully!");
      setTimeout(() => setWorkflowMsg(""), 3000);
    } else if (res) {
      setWorkflowMsg("Error: " + res);
    }
  };

  return (
    <SettingsContext.Provider
      value={{
        openSettings: () => setIsOpen(true),
        closeSettings: () => setIsOpen(false),
      }}
    >
      {children}

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#09090b] border border-zinc-800 w-full max-w-md rounded-xl shadow-2xl p-6 relative animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-white"
            >
              <X size={18} />
            </button>

            <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
              Settings
            </h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <Server size={12} /> ComfyUI Backend URL
                </label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded p-2 text-sm text-white focus:border-[#D2FF44] outline-none font-mono placeholder-zinc-600"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setStatus("idle");
                    }}
                    placeholder="http://127.0.0.1:8188"
                  />
                  <button
                    onClick={handleTest}
                    disabled={status === "testing"}
                    className="px-3 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 transition-colors disabled:opacity-50"
                    title="Test Connection"
                  >
                    {status === "testing" ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      "Test"
                    )}
                  </button>
                </div>

                {/* Status Feedback */}
                {status === "success" && (
                  <p className="text-xs text-[#D2FF44] flex items-center gap-1.5">
                    <CheckCircle2 size={12} /> Connection Successful
                  </p>
                )}
                {status === "error" && (
                  <p className="text-xs text-red-500 flex items-center gap-1.5">
                    <XCircle size={12} /> Connection Failed
                  </p>
                )}
              </div>

              {/* Workflow Section */}
              <div className="space-y-2 pt-4 border-t border-zinc-800">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <FileJson size={12} /> Workflow Template
                </label>
                <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded p-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${hasWorkflow ? "bg-[#D2FF44]" : "bg-red-500"}`}
                    />
                    <span className="text-sm text-zinc-300">
                      {hasWorkflow ? "Workflow Loaded" : "No Workflow Found"}
                    </span>
                  </div>
                  <button
                    onClick={handleImportWorkflow}
                    className="text-xs bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                  >
                    <Upload size={12} /> Import JSON
                  </button>
                </div>
                {workflowMsg && (
                  <p className="text-xs text-[#D2FF44]">{workflowMsg}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-zinc-800">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-6 py-2 text-xs font-bold bg-[#D2FF44] text-black rounded hover:opacity-90"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsContext.Provider>
  );
}
