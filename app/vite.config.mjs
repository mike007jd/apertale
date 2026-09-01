import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const webMcpHeaders = {
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "tools=(self)",
};

export default defineConfig({
  build: {
    outDir: "dist/client",
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    headers: webMcpHeaders,
  },
  preview: {
    headers: webMcpHeaders,
  },
  plugins: [react()],
});
