#!/bin/bash
# Watchdog: ensures listener is always running
# Works on macOS (launchd) and Linux (systemd).

DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${PYTHON:-$(command -v python3 || command -v python)}"
PID_FILE="$DIR/pids/listener.pid"
LOG="$DIR/logs/listener.log"

cd "$DIR"
mkdir -p pids logs

# Check if listener is alive
if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
        # Still running, check log size and rotate if needed
        if [ -f "$LOG" ]; then
            LOG_SIZE=$(wc -c < "$LOG" 2>/dev/null || echo 0)
            if [ "$LOG_SIZE" -gt 10485760 ]; then
                mv "$LOG" "$LOG.old"
                echo "$(date) Log rotated" > "$LOG"
            fi
        fi
        exit 0
    fi
fi

# Not running, restart
echo "$(date) Watchdog restarting listener..."
PYTHONPATH="$DIR/backend" nohup "$PYTHON" -m src.main --listen >> "$LOG" 2>&1 &
echo $! > "$PID_FILE"
