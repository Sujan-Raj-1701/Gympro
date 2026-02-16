import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

// ESM-safe __dirname for Vite config in Node 18
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server build configuration
export default defineConfig({
  build: {
  // Use SSR build with absolute entry to avoid resolution issues in CI
  ssr: path.resolve(__dirname, "server/node-build.ts"),
  outDir: "dist/server",
  target: "node18",
    rollupOptions: {
      external: [
        // Node.js built-ins
        "fs",
        "path",
        "url",
        "http",
        "https",
        "os",
        "crypto",
        "stream",
        "util",
        "events",
        "buffer",
        "querystring",
        "child_process",
        // External dependencies that should not be bundled
        "express",
        "cors",
      ],
      output: {
        entryFileNames: "node-build.mjs",
        format: "es",
      },
    },
    minify: false, // Keep readable for debugging
    sourcemap: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.VITE_API_BASE_URL": JSON.stringify(process.env.VITE_API_BASE_URL || 'http://localhost:8007/'),
  },
});
