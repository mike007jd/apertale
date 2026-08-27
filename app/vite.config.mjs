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
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    headers: webMcpHeaders,
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  preview: {
    headers: webMcpHeaders,
  },
  plugins: [react()],
});
