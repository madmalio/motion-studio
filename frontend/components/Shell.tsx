"use client";

import { usePathname } from "next/navigation";
import BottomBar from "./BottomBar";
import { Suspense, useEffect } from "react";
import { WindowMaximise, WindowUnmaximise } from "../wailsjs/runtime/runtime";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Logic: If we are on the Home page ("/"), we DO NOT show the sidebar.
  const isDashboard = pathname === "/";

  useEffect(() => {
    if (isDashboard) {
      WindowUnmaximise();
    } else {
      WindowMaximise();
    }
  }, [isDashboard]);

  if (isDashboard) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-[#09090b] overflow-hidden">
      {/* The Page Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {children}
      </div>

      {/* FIX: Wrap BottomBar in Suspense.
        This prevents the "useSearchParams" build error on static pages like 404.
      */}
      <Suspense
        fallback={
          <div className="h-14 bg-[#09090b] border-t border-zinc-800 w-full" />
        }
      >
        <BottomBar />
      </Suspense>
    </div>
  );
}
