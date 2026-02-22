import type { Metadata } from "next";
import "./globals.css";
import Shell from "../components/Shell";
import { ConfirmProvider } from "../components/ConfirmProvider";
import { SettingsProvider } from "../components/SettingsProvider";
import { StudioProvider } from "../components/StudioProvider";
import WailsScripts from "../components/WailsScripts";

export const metadata: Metadata = {
  title: "Motion Studio",
  description: "Professional Video Editor",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#09090b] text-white">
        {/* Wails bridge – client-only, early, safe */}
        <WailsScripts />

        <ConfirmProvider>
          <SettingsProvider>
            <StudioProvider>
              <Shell>{children}</Shell>
            </StudioProvider>
          </SettingsProvider>
        </ConfirmProvider>
      </body>
    </html>
  );
}
