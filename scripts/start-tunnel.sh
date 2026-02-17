#!/bin/bash
# Start PilotCode server + Cloudflare Named Tunnel
# Configure TUNNEL_NAME to match your cloudflared tunnel

TUNNEL_NAME="${CLOUDFLARE_TUNNEL:-pilotcode}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "Starting PilotCode server..."
npx tsx src/server.ts &
SERVER_PID=$!
sleep 3

echo ""
echo "Starting Cloudflare Tunnel ($TUNNEL_NAME)..."
echo ""

cloudflared tunnel run "$TUNNEL_NAME" 2>&1

# Cleanup on exit
kill $SERVER_PID 2>/dev/null
