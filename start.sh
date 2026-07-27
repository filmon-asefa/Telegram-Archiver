#!/bin/bash
# Start the Telegram archiver services: listener + media downloader + UI
# Usage: ./start.sh {start|stop|restart|status|tunnel}
#
# Works on macOS (launchd) and Linux (systemd or direct).

DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${PYTHON:-$(command -v python3 || command -v python)}"
BACKEND_DIR="$DIR/backend"
FRONTEND_DIR="$DIR/frontend"
LOG_DIR="$DIR/logs"
PID_DIR="$DIR/pids"

if [ -z "$PYTHON" ]; then
    echo "Error: Python 3 not found. Install Python 3.9+ or set PYTHON env var."
    exit 1
fi

PY_VER=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
echo "Using Python $PY_VER at $PYTHON"

mkdir -p "$LOG_DIR" "$PID_DIR"

MEDIA_PID_FILE="$PID_DIR/media.pid"
UI_PID_FILE="$PID_DIR/ui.pid"
LAUNCHD_LABEL="com.telegram.archiver"

is_running() {
    local pid_file="$1"
    if [ -f "$pid_file" ]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

launchd_listener_running() {
    command -v launchctl >/dev/null 2>&1 && launchctl list "$LAUNCHD_LABEL" >/dev/null 2>&1
}

systemd_listener_running() {
    command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet telegram-archiver 2>/dev/null
}

listener_running() {
    launchd_listener_running || systemd_listener_running
}

stop_media() {
    if is_running "$MEDIA_PID_FILE"; then
        local pid
        pid=$(cat "$MEDIA_PID_FILE")
        echo "Stopping media downloader (PID $pid)..."
        kill "$pid" 2>/dev/null
        sleep 2
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
    fi
    rm -f "$MEDIA_PID_FILE"
}

stop_ui() {
    if is_running "$UI_PID_FILE"; then
        local pid
        pid=$(cat "$UI_PID_FILE")
        echo "Stopping UI (PID $pid)..."
        kill "$pid" 2>/dev/null
        sleep 1
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
    fi
    rm -f "$UI_PID_FILE"
}

start_media() {
    if is_running "$MEDIA_PID_FILE"; then
        echo "Media downloader already running (PID $(cat "$MEDIA_PID_FILE"))"
        return
    fi
    echo "Starting media downloader..."
    cd "$DIR"
    PYTHONPATH="$BACKEND_DIR" nohup "$PYTHON" -m src.main --media-only >> "$LOG_DIR/media.log" 2>&1 &
    echo $! > "$MEDIA_PID_FILE"
    echo "Media downloader started (PID $!)"
}

start_ui() {
    if is_running "$UI_PID_FILE"; then
        echo "UI already running (PID $(cat "$UI_PID_FILE"))"
        return
    fi
    echo "Starting UI..."
    cd "$FRONTEND_DIR"
    if [ ! -d "node_modules/next" ]; then
        echo "Installing frontend dependencies..."
        npm install
    fi
    nohup "$FRONTEND_DIR/node_modules/.bin/next" dev --webpack --port 3000 >> "$LOG_DIR/ui.log" 2>&1 &
    echo $! > "$UI_PID_FILE"
    echo "UI started on http://localhost:3000 (PID $!)"
}

start_listener() {
    if listener_running; then
        echo "Listener already managed by service manager"
        return
    fi

    # Try launchd (macOS)
    if command -v launchctl >/dev/null 2>&1; then
        if [ -f "$DIR/com.telegram.archiver.plist" ]; then
            echo "Starting listener via launchd..."
            launchctl bootstrap gui/$(id -u) "$DIR/com.telegram.archiver.plist" 2>/dev/null || true
            sleep 1
            if launchd_listener_running; then
                echo "Listener started via launchd"
                return
            fi
        fi
    fi

    # Try systemd (Linux)
    if command -v systemctl >/dev/null 2>&1; then
        if [ -f "/etc/systemd/system/telegram-archiver.service" ]; then
            echo "Starting listener via systemd..."
            sudo systemctl start telegram-archiver
            sleep 1
            if systemd_listener_running; then
                echo "Listener started via systemd"
                return
            fi
        fi
    fi

    # Fallback: direct start
    echo "Starting listener directly..."
    cd "$DIR"
    PYTHONPATH="$BACKEND_DIR" nohup "$PYTHON" -m src.main --listen >> "$LOG_DIR/listener.log" 2>&1 &
    echo $! > "$PID_DIR/listener.pid"
    echo "Listener started directly (PID $!)"
}

stop_listener() {
    if launchd_listener_running; then
        echo "Stopping listener via launchd..."
        launchctl bootout gui/$(id -u)/$LAUNCHD_LABEL 2>/dev/null || true
    elif systemd_listener_running; then
        echo "Stopping listener via systemd..."
        sudo systemctl stop telegram-archiver 2>/dev/null || true
    fi
    rm -f "$PID_DIR/listener.pid"
}

case "${1:-start}" in
    start)
        start_listener
        start_media
        start_ui
        echo ""
        echo "All services started."
        echo "  UI:          http://localhost:3000"
        echo "  Listener:    tail -f $LOG_DIR/listener.log"
        echo "  Media DL:    tail -f $LOG_DIR/media.log"
        ;;
    stop)
        stop_listener
        stop_media
        stop_ui
        echo "All services stopped."
        ;;
    restart)
        stop_listener
        stop_media
        stop_ui
        sleep 2
        start_listener
        start_media
        start_ui
        echo "All services restarted."
        ;;
    status)
        echo -n "Listener: "
        if launchd_listener_running; then
            LDRPID=$(launchctl list com.telegram.archiver 2>/dev/null | grep '"PID"' | awk '{print $3}' | tr -d ';')
            echo "RUNNING (via launchd, PID $LDRPID)"
        elif systemd_listener_running; then
            echo "RUNNING (via systemd)"
        else
            echo "STOPPED"
        fi
        echo -n "Media:    "
        if is_running "$MEDIA_PID_FILE"; then
            echo "RUNNING (PID $(cat "$MEDIA_PID_FILE"))"
        else
            echo "STOPPED"
        fi
        echo -n "UI:       "
        if is_running "$UI_PID_FILE"; then
            echo "RUNNING (PID $(cat "$UI_PID_FILE"))"
        else
            echo "STOPPED"
        fi
        ;;
    tunnel)
        echo "Starting tunnel to http://localhost:3000 ..."
        echo "Make sure the UI is running first: ./start.sh start"
        npx --yes localtunnel --port 3000
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|tunnel}"
        exit 1
        ;;
esac
