"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

// 1. Define the Options
interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "info";
  onConfirm: () => void;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => void;
  close: () => void;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

// 2. The Hook to use it anywhere
export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context)
    throw new Error("useConfirm must be used within a ConfirmProvider");
  return context;
};

// 3. The Provider Component
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const confirm = (opts: ConfirmOptions) => {
    setOptions(opts);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    // slight delay to clear options so text doesn't vanish while animating out
    setTimeout(() => setOptions(null), 300);
  };

  const handleConfirm = () => {
    if (options?.onConfirm) {
      options.onConfirm();
    }
    close();
  };

  return (
    <ConfirmContext.Provider value={{ confirm, close }}>
      {children}

      {/* --- THE GLOBAL MODAL --- */}
      {isOpen && options && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#09090b] border border-zinc-800 w-full max-w-md rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] transform scale-100 animate-in zoom-in-95 duration-200 p-6 relative">
            {/* Close Icon */}
            <button
              onClick={close}
              className="absolute top-4 right-4 text-zinc-500 hover:text-white"
            >
              <X size={18} />
            </button>

            {/* Header */}
            <div className="flex items-start gap-4 mb-4">
              <div
                className={`
                p-3 rounded-full shrink-0
                ${options.variant === "danger" ? "bg-red-500/10 text-red-500" : "bg-[#D2FF44]/10 text-[#D2FF44]"}
              `}
              >
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white mb-1">
                  {options.title}
                </h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {options.message}
                </p>
              </div>
            </div>

            {/* Footer / Buttons */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={close}
                className="px-4 py-2 text-sm font-bold text-zinc-400 hover:text-white transition-colors"
              >
                {options.cancelText || "Cancel"}
              </button>

              <button
                onClick={handleConfirm}
                className={`
                  px-6 py-2 text-sm font-bold rounded shadow-lg hover:brightness-110 transition-all
                  ${
                    options.variant === "danger"
                      ? "bg-red-600 text-white shadow-red-900/20"
                      : "bg-[#D2FF44] text-black shadow-[#D2FF44]/20"
                  }
                `}
              >
                {options.confirmText || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
