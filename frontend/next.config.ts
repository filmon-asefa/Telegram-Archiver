import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow all origins in dev mode only (tunnel, LAN access)
  ...(process.env.NODE_ENV === "development"
    ? { experimental: { allowedDevOrigins: ["*"] } }
    : {}),
};

export default nextConfig;
