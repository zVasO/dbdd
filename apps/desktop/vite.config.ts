import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@codemirror/') || id.includes('/codemirror/') || id.includes('@lezer/')) return 'codemirror';
          if (id.includes('/react-dom/')) return 'vendor';
          if (id.includes('node_modules/react/')) return 'vendor';
          if (id.includes('@tanstack/')) return 'tanstack';
          if (id.includes('/xlsx/')) return 'xlsx';
          if (id.includes('/recharts/') || id.includes('/victory-vendor/')) return 'charts';
          if (id.includes('@xyflow/') || id.includes('/dagre/')) return 'flow';
          if (id.includes('@faker-js/')) return 'faker';
          if (id.includes('/sql-formatter/')) return 'sql-formatter';
          if (id.includes('/lucide-react/')) return 'icons';
          if (id.includes('/papaparse/')) return 'papaparse';
          return undefined;
        },
      },
    },
  },
});
