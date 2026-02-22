"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface StudioContextType {
  isExportModalOpen: boolean;
  openExportModal: () => void;
  closeExportModal: () => void;
}

const StudioContext = createContext<StudioContextType | undefined>(undefined);

export const useStudio = () => {
  const context = useContext(StudioContext);
  if (!context) {
    throw new Error("useStudio must be used within a StudioProvider");
  }
  return context;
};

export function StudioProvider({ children }: { children: ReactNode }) {
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const openExportModal = () => setIsExportModalOpen(true);
  const closeExportModal = () => setIsExportModalOpen(false);

  return (
    <StudioContext.Provider
      value={{
        isExportModalOpen,
        openExportModal,
        closeExportModal,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
}
