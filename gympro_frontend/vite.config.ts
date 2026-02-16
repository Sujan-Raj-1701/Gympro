import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
  port: 8080,
    // Proxy API calls directly to FastAPI backend to avoid Vite HTML fallback
    proxy: {
      '/api': {
    // In dev, proxy to the remote backend by default to avoid CORS when the client uses '/api' base
    // You can override with FASTAPI_URL env var if running backend locally
    target: process.env.FASTAPI_URL || 'https://hub.techiesmagnifier.com/',
        changeOrigin: true,
        // Do not let Vite rewrite the path; backend already expects /api/... (alias routes also exist)
        configure: (proxy, _options) => {
          proxy.on('error', (err) => {
            console.error('[ViteProxy] /api error', err?.message);
          });
        }
      }
    }
  },
  build: {
    outDir: "dist/spa",
    // Ensure all public files (including .htaccess) are copied
    copyPublicDir: true,
  },
  publicDir: 'public', // Ensure public directory (including .htaccess) is copied
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
}));
