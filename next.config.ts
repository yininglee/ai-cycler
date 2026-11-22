import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "192.168.31.*", "10.22.47.192"],
};

export default nextConfig;
