import type { Metadata } from "next";
import "./globals.css";
import Shell from "../components/Shell";
import { ConfirmProvider } from "../components/ConfirmProvider"; // <--- Import

export const metadata: Metadata = {
  title: "Motion Studio",
  description: "Professional Video Editor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#09090b] text-white">
        {/* Wrap Shell inside ConfirmProvider */}
        <ConfirmProvider>
          <Shell>{children}</Shell>
        </ConfirmProvider>
      </body>
    </html>
  );
}
