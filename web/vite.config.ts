import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "samples/*.jpg"],
      manifest: {
        name: "NamJai – community water",
        short_name: "NamJai",
        description: "Read meters, catch leaks early, follow repairs and see the repair fund.",
        theme_color: "#1c5cab",
        background_color: "#fcfcfb",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) => url.pathname.startsWith("/api/") && request.method === "GET",
            handler: "NetworkFirst",
            options: { cacheName: "api", networkTimeoutSeconds: 6, expiration: { maxEntries: 200, maxAgeSeconds: 7 * 86400 } },
          },
          {
            urlPattern: ({ url }) => url.hostname.endsWith("tile.openstreetmap.org"),
            handler: "CacheFirst",
            options: { cacheName: "tiles", expiration: { maxEntries: 400, maxAgeSeconds: 30 * 86400 } },
          },
        ],
      },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:8000" } },
  preview: { proxy: { "/api": "http://localhost:8000" } },
});
