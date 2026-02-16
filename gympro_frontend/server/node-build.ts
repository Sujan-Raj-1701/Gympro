import path from "path";
import express from "express";
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

console.log('🔄 Starting Banquet POS server...');
console.log('📊 Environment:', process.env.NODE_ENV);
console.log('🔌 Port:', process.env.PORT || '8080 (default)');

try {
  const port = Number(process.env.PORT) || 8080;
  
  // Create basic express app
  const app = express();
  
  // Basic middleware
  app.use(express.json());
  
  // Health check endpoints
  app.get("/", (req, res) => {
    console.log('✅ Health check hit');
    res.status(200).json({ 
      status: "ok", 
      message: "Banquet POS Frontend is running",
      timestamp: new Date().toISOString()
    });
  });
  
  app.get("/health", (req, res) => {
    console.log('✅ /health endpoint hit');
    res.status(200).json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      service: "banquet-pos-frontend"
    });
  });

  // Static files path
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distPath = path.join(__dirname, "../spa");

  console.log('📁 Static files path:', distPath);

  // Check if dist directory exists
  if (existsSync(distPath)) {
    console.log('✅ Static files directory found');
    app.use(express.static(distPath));
    
    // Serve index.html for all other routes (React Router)
    app.get("*", (req, res) => {
      console.log('🔄 Serving index.html for:', req.path);
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    console.error('❌ Static files directory not found:', distPath);
    
    // Fallback route when no static files
    app.get("*", (req, res) => {
      res.status(503).json({ 
        error: "Static files not found", 
        path: distPath,
        message: "Application not properly built" 
      });
    });
  }

  // Start server
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server started successfully!`);
    console.log(`📱 Frontend: http://0.0.0.0:${port}`);
    console.log(`❤️ Health: http://0.0.0.0:${port}/health`);
  });

  server.on('error', (err) => {
    console.error('❌ Server error:', err);
    process.exit(1);
  });

} catch (error) {
  console.error('❌ Startup error:', error);
  process.exit(1);
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 Received SIGINT, shutting down gracefully");
  process.exit(0);
});
