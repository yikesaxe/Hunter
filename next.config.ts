import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval needed for Next.js dev; inline for MapLibre
              "style-src 'self' 'unsafe-inline'",                // unsafe-inline needed for MapLibre CSS
              "img-src 'self' data: blob: https:",               // https: for listing photos from any CDN
              "font-src 'self' data:",
              "connect-src 'self' https:",                       // https: for MapLibre tile fetches
              "worker-src blob:",                                // MapLibre web workers
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default config;
