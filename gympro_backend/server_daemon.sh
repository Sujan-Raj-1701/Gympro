#!/bin/bash

# Background service management for FastAPI server
# Usage: 
#   ./server_daemon.sh start [port]    - Start server in background
#   ./server_daemon.sh stop            - Stop background server
#   ./server_daemon.sh restart [port]  - Restart server
#   ./server_daemon.sh status          - Show server status
#   ./server_daemon.sh logs            - Show server logs

set -e

# Configuration
DEFAULT_PORT=8005
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PID_FILE="$SCRIPT_DIR/server.pid"
LOG_FILE="$SCRIPT_DIR/server.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Check if server is running
is_running() {
    if [[ -f "$PID_FILE" ]]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0  # Running
        else
            rm -f "$PID_FILE"  # Clean up stale PID file
            return 1  # Not running
        fi
    fi
    return 1  # Not running
}

# Start server in background
start_server() {
    local port=${1:-$DEFAULT_PORT}
    
    if is_running; then
        local pid=$(cat "$PID_FILE")
        warn "Server is already running with PID $pid"
        return 1
    fi
    
    info "Starting server on port $port..."
    
    # Activate virtual environment
    if [[ -d "$PROJECT_ROOT/venv" ]]; then
        source "$PROJECT_ROOT/venv/bin/activate"
    fi
    
    # Load environment
    if [[ -f "$SCRIPT_DIR/.env" ]]; then
        export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
    elif [[ -f "$SCRIPT_DIR/.env.production" ]]; then
        export $(grep -v '^#' "$SCRIPT_DIR/.env.production" | xargs)
    fi
    
    # Change to fastapi_backend directory
    cd "$SCRIPT_DIR"
    
    # Start server in background
    nohup uvicorn "main:app" \
        --host "0.0.0.0" \
        --port "$port" \
        --log-level info \
        --access-log > "$LOG_FILE" 2>&1 &
    
    # Save PID
    echo $! > "$PID_FILE"
    
    # Wait a moment and check if it started successfully
    sleep 2
    if is_running; then
        local pid=$(cat "$PID_FILE")
        info "Server started successfully with PID $pid"
        info "Access at: http://0.0.0.0:$port"
        info "Health check: http://0.0.0.0:$port/health"
        info "Logs: tail -f $LOG_FILE"
    else
        error "Server failed to start. Check logs: $LOG_FILE"
        return 1
    fi
}

# Stop server
stop_server() {
    if ! is_running; then
        warn "Server is not running"
        return 1
    fi
    
    local pid=$(cat "$PID_FILE")
    info "Stopping server with PID $pid..."
    
    kill "$pid"
    
    # Wait for graceful shutdown
    local count=0
    while ps -p "$pid" > /dev/null 2>&1 && [ $count -lt 10 ]; do
        sleep 1
        ((count++))
    done
    
    # Force kill if still running
    if ps -p "$pid" > /dev/null 2>&1; then
        warn "Force killing server..."
        kill -9 "$pid"
    fi
    
    rm -f "$PID_FILE"
    info "Server stopped"
}

# Show status
show_status() {
    if is_running; then
        local pid=$(cat "$PID_FILE")
        info "Server is running with PID $pid"
        
        # Try to get port info
        if command -v ss >/dev/null 2>&1; then
            local port_info=$(ss -tlnp | grep "$pid" | head -1)
            if [[ -n "$port_info" ]]; then
                echo "   $port_info"
            fi
        fi
    else
        warn "Server is not running"
    fi
}

# Show logs
show_logs() {
    if [[ -f "$LOG_FILE" ]]; then
        tail -f "$LOG_FILE"
    else
        error "Log file not found: $LOG_FILE"
    fi
}

# Main command handling
case "${1:-}" in
    start)
        start_server "$2"
        ;;
    stop)
        stop_server
        ;;
    restart)
        stop_server || true
        sleep 1
        start_server "$2"
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs} [port]"
        echo ""
        echo "Commands:"
        echo "  start [port]    Start server in background (default port: $DEFAULT_PORT)"
        echo "  stop            Stop background server"
        echo "  restart [port]  Restart server"
        echo "  status          Show server status"
        echo "  logs            Follow server logs (Ctrl+C to stop)"
        echo ""
        echo "Examples:"
        echo "  $0 start        # Start on port $DEFAULT_PORT"
        echo "  $0 start 8001   # Start on port 8001"
        echo "  $0 status       # Check if running"
        echo "  $0 logs         # View live logs"
        echo "  $0 stop         # Stop server"
        exit 1
        ;;
esac