"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface StudioContextType {
  isExportModalOpen: boolean;
  openExportModal: () => void;
  closeExportModal: () => void;
  isAssetLibraryOpen: boolean;
  openAssetLibrary: () => void;
  closeAssetLibrary: () => void;
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
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);

  const openExportModal = () => setIsExportModalOpen(true);
  const closeExportModal = () => setIsExportModalOpen(false);

  const openAssetLibrary = () => setIsAssetLibraryOpen(true);
  const closeAssetLibrary = () => setIsAssetLibraryOpen(false);

  return (
    <StudioContext.Provider
      value={{
        isExportModalOpen,
        openExportModal,
        closeExportModal,
        isAssetLibraryOpen,
        openAssetLibrary,
        closeAssetLibrary,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
}
