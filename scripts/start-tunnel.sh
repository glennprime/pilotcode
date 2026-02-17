#!/bin/bash
# Start PilotCode server + Cloudflare Named Tunnel
# Accessible at https://pilotcode.bantuary.com

cd /Users/glennprime/Dev/pilotcode

echo "Starting PilotCode server..."
npx tsx src/server.ts &
SERVER_PID=$!
sleep 3

echo ""
echo "Starting Cloudflare Tunnel (pilotcode)..."
echo ""
echo "  ======================================"
echo "  PilotCode will be live at:"
echo "  https://pilotcode.bantuary.com"
echo "  ======================================"
echo ""

cloudflared tunnel run pilotcode 2>&1

# Cleanup on exit
kill $SERVER_PID 2>/dev/null
