#!/bin/bash
# Update DuckDNS with current public IP
DOMAIN="pilotcode"
TOKEN="5849f5c3-f339-4d76-afc5-8d1a2424406f"
LOGFILE="/Users/glennprime/Dev/pilotcode/data/duckdns.log"

RESULT=$(curl -s "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip=")
echo "$(date): ${RESULT}" >> "$LOGFILE"
