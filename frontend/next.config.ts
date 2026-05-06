import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.12"],
  turbopack: {
    // Resolve workspace root relative to this config file's location.
    // Prevents Turbopack from auto-detecting the wrong root when
    // multiple lockfiles exist in parent directories.
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
