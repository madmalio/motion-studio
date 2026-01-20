"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { Suspense } from "react";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Logic: If we are on the Home page ("/"), we DO NOT show the sidebar.
  const isDashboard = pathname === "/";

  if (isDashboard) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen w-screen bg-[#09090b] overflow-hidden">
      {/* FIX: Wrap Sidebar in Suspense.
        This prevents the "useSearchParams" build error on static pages like 404.
      */}
      <Suspense
        fallback={
          <div className="w-16 bg-[#09090b] border-r border-zinc-800 h-full" />
        }
      >
        <Sidebar />
      </Suspense>

      {/* The Page Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
