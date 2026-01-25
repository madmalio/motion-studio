"use client";

import Script from "next/script";

export default function WailsScripts() {
  return (
    <>
      {/* Must be early, but client-only to avoid hydration mismatch */}
      <Script src="/wails/ipc.js" strategy="beforeInteractive" />
      <Script src="/wails/runtime.js" strategy="beforeInteractive" />
    </>
  );
}
