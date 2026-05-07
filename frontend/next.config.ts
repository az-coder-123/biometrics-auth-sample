import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow HMR WebSocket connections from LAN IPs and ngrok tunnels.
  // Next.js 15+ blocks WebSocket HMR by default for non-localhost origins.
  allowedDevOrigins: [
    "192.168.1.11",
    "192.168.1.12",
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    "*.ngrok.io",
  ],

  // Proxy /api/* to the NestJS backend running on the same machine.
  //
  // Why this is needed when accessed via ngrok or a LAN IP:
  //   - NEXT_PUBLIC_API_URL can be set to /api (relative), so the browser
  //     always calls the same HTTPS origin (no mixed-content errors).
  //   - The Next.js server (co-located with the backend) then forwards the
  //     request to http://localhost:3000/api/* server-side.
  //   - This avoids exposing the backend port publicly at all.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
