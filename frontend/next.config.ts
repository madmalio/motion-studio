import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This tells Next.js to generate static HTML/CSS/JS files
  output: "export",

  // This is required because we don't have a server to optimize images
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
