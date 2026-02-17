#!/bin/bash
# Update DuckDNS with current public IP
# Set these env vars or edit directly:
DOMAIN="${DUCKDNS_DOMAIN:-}"
TOKEN="${DUCKDNS_TOKEN:-}"
LOGFILE="$(cd "$(dirname "$0")/.." && pwd)/data/duckdns.log"

if [ -z "$DOMAIN" ] || [ -z "$TOKEN" ]; then
  echo "Error: Set DUCKDNS_DOMAIN and DUCKDNS_TOKEN environment variables"
  exit 1
fi

RESULT=$(curl -s "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip=")
echo "$(date): ${RESULT}" >> "$LOGFILE"
