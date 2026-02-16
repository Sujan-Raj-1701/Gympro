#!/bin/bash

# Simple FastAPI server startup script
# Usage: ./start_server.sh [port]

set -e

# Configuration
DEFAULT_PORT=8005
PORT=${1:-$DEFAULT_PORT}
HOST=${HOST:-0.0.0.0}
APP_MODULE="fastapi_backend.main:app"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🚀 Starting Salon POS FastAPI Backend..."
echo "📁 Project root: $PROJECT_ROOT"
echo "🌐 Host: $HOST"
echo "🔌 Port: $PORT"
echo "📦 Module: $APP_MODULE"

# Check if we're in the right directory
if [[ ! -f "$SCRIPT_DIR/main.py" ]]; then
    echo "❌ Error: main.py not found in $SCRIPT_DIR"
    echo "   Make sure you're running this from the fastapi_backend directory"
    exit 1
fi

# Check for virtual environment
if [[ -d "$PROJECT_ROOT/venv" ]]; then
    echo "🐍 Using virtual environment: $PROJECT_ROOT/venv"
    source "$PROJECT_ROOT/venv/bin/activate"
elif [[ -d "$SCRIPT_DIR/venv" ]]; then
    echo "🐍 Using virtual environment: $SCRIPT_DIR/venv"
    source "$SCRIPT_DIR/venv/bin/activate"
else
    echo "⚠️  No virtual environment found. Using system Python."
fi

# Check for .env file
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    echo "⚙️  Environment file found: $SCRIPT_DIR/.env"
    export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
elif [[ -f "$SCRIPT_DIR/.env.production" ]]; then
    echo "⚙️  Using production environment: $SCRIPT_DIR/.env.production"
    export $(grep -v '^#' "$SCRIPT_DIR/.env.production" | xargs)
else
    echo "⚠️  No .env file found. Using default settings."
fi

# Check if port is available
if command -v ss >/dev/null 2>&1; then
    if ss -tlnp | grep -q ":$PORT "; then
        echo "❌ Error: Port $PORT is already in use"
        echo "   Try a different port: ./start_server.sh 8001"
        exit 1
    fi
elif command -v netstat >/dev/null 2>&1; then
    if netstat -tlnp | grep -q ":$PORT "; then
        echo "❌ Error: Port $PORT is already in use"
        echo "   Try a different port: ./start_server.sh 8001"
        exit 1
    fi
fi

# Check if uvicorn is available
if ! command -v uvicorn >/dev/null 2>&1; then
    echo "❌ Error: uvicorn not found"
    echo "   Install it with: pip install uvicorn"
    exit 1
fi

echo ""
echo "🎯 Starting server..."
echo "   Access at: http://$HOST:$PORT"
echo "   Health check: http://$HOST:$PORT/health"
echo "   API docs: http://$HOST:$PORT/docs"
echo ""
echo "Press Ctrl+C to stop the server"
echo "--------------------------------------------"

# Change to script directory (fastapi_backend) so main.py import works
cd "$SCRIPT_DIR"

# Start the server (use main:app since we're in the fastapi_backend directory)
exec uvicorn "main:app" \
    --host "$HOST" \
    --port "$PORT" \
    --reload \
    --log-level info \
    --access-log