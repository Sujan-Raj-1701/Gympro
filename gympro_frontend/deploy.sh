#!/bin/bash

# Frontend Build and Deploy Script
# Usage: ./deploy.sh [environment]
# Environments: dev, prod, netlify, railway

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_ENV=${1:-prod}

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Check if we're in the right directory
if [[ ! -f "$SCRIPT_DIR/package.json" ]]; then
    error "package.json not found. Run this script from the saloon_frontend directory"
    exit 1
fi

cd "$SCRIPT_DIR"

info "🚀 Frontend Build and Deploy Script"
info "📁 Working directory: $SCRIPT_DIR"
info "🌍 Environment: $NODE_ENV"

# Check Node.js and npm
if ! command -v node >/dev/null 2>&1; then
    error "Node.js not found. Please install Node.js"
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    error "npm not found. Please install npm"
    exit 1
fi

NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
info "📦 Node.js: $NODE_VERSION"
info "📦 npm: $NPM_VERSION"

# Set environment variables based on deployment target
case $NODE_ENV in
    dev|development)
        export VITE_API_BASE_URL="https://hub.techiesmagnifier.com"
        export VITE_BACKEND_ORIGIN="https://hub.techiesmagnifier.com"
        ;;
    prod|production)
        export VITE_API_BASE_URL="http://localhost:8005/"
        export VITE_BACKEND_ORIGIN="http://localhost:8005/"
        ;;
    netlify)
        export VITE_API_BASE_URL="http://localhost:8005/"
        export VITE_BACKEND_ORIGIN="http://localhost:8005/"
        ;;
    railway)
        export VITE_API_BASE_URL="http://localhost:8005/"
        export VITE_BACKEND_ORIGIN="http://localhost:8005/"
        ;;
    *)
        warn "Unknown environment: $NODE_ENV. Using production defaults"
        export VITE_API_BASE_URL="http://localhost:8005/"
        export VITE_BACKEND_ORIGIN="http://localhost:8005/"
        ;;
esac

info "🔗 API Base URL: $VITE_API_BASE_URL"

# Install dependencies
info "📦 Installing dependencies..."
npm install

# Type checking
info "🔍 Running type check..."
npm run typecheck

# Build the project
info "🔨 Building frontend..."
npm run build

# Ensure .htaccess is in the build output for Apache SPA routing
if [[ -f "public/.htaccess" ]] && [[ ! -f "dist/spa/.htaccess" ]]; then
    info "📄 Copying .htaccess for Apache SPA routing..."
    cp "public/.htaccess" "dist/spa/.htaccess"
fi

# Check build output
if [[ ! -d "dist/spa" ]]; then
    error "Build failed - dist/spa directory not found"
    exit 1
fi

BUILD_SIZE=$(du -sh dist/spa | cut -f1)
info "✅ Build completed successfully"
info "📊 Build size: $BUILD_SIZE"
info "📁 Build output: dist/spa/"

# List important files
info "📄 Build contents:"
ls -la dist/spa/ | head -10

# Test API connection (if in dev/prod mode)
if [[ "$NODE_ENV" =~ ^(dev|prod)$ ]]; then
    info "🔍 Testing API connection..."
    if curl -s --max-time 10 "$VITE_API_BASE_URL/health" >/dev/null; then
        info "✅ API health check passed"
    else
        warn "⚠️  API health check failed - ensure backend is running"
    fi
fi

# Environment-specific deployment steps
case $NODE_ENV in
    dev|development)
        info "🚀 Starting development server..."
        info "   Frontend: http://localhost:8080"
        info "   Backend:  $VITE_API_BASE_URL"
        npm run dev
        ;;
    
    netlify)
        info "🚀 Ready for Netlify deployment"
        info "   Build command: npm run build:client"
        info "   Publish directory: dist/spa"
        info "   Environment variables:"
        info "     VITE_API_BASE_URL=$VITE_API_BASE_URL"
        ;;
    
    railway)
        info "🚀 Ready for Railway deployment"
        info "   Build will be handled by Railway"
        info "   Environment variables set in railway.toml"
        ;;
    
    prod|production)
        info "🚀 Production build ready"
        info "   Serve the dist/spa/ directory with a web server"
        info "   Example with Python: cd dist/spa && python -m http.server 8080"
        info "   Example with Node: npx serve dist/spa -l 8080"
        ;;
esac

info "✨ Done!"