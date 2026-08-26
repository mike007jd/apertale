import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    headers: {
      "Origin-Agent-Cluster": "?1",
      "Permissions-Policy": "tools=(self)",
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  preview: {
    headers: {
      "Origin-Agent-Cluster": "?1",
      "Permissions-Policy": "tools=(self)",
    },
  },
  plugins: [react()],
});
