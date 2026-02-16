import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors({
    origin: ["https://banquetpos-production.up.railway.app", "http://localhost:3000", "http://localhost:5173"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // NOTE: Vite config now contains a dev proxy for /api -> FastAPI.
  // To avoid double-handling or conflicting caching, we remove the custom /api proxy here.
  // Keep only local demo routes that do not overlap with backend endpoints.

  // Health check endpoint for Railway
  app.get("/health", (_req, res) => {
    res.status(200).json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      service: "banquet-pos-frontend"
    });
  });

  // Root health check (Railway default)
  app.get("/", (_req, res) => {
    res.status(200).json({ 
      status: "ok", 
      message: "Banquet POS Frontend is running",
      timestamp: new Date().toISOString()
    });
  });

  // Example API routes (local demo)
  app.get("/api/dev-ping", (_req, res) => {
    res.json({ message: "Hello from local Express dev helper!" });
  });

  app.get("/api/dev-demo", handleDemo);

  return app;
}
