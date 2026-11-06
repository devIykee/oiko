#!/bin/sh
# Starts the web app once the chain container has written /state/relayer.json, then prints the ready line.
set -e
until [ -f /state/ready ]; do echo "waiting for the local chain…"; sleep 1; done
cd /app/apps/web
./node_modules/.bin/next start -p 3000 &
PID=$!
until curl -fsS http://localhost:3000/api/config >/dev/null 2>&1; do sleep 1; done
echo ""
echo "oiko ready at ${OIKO_PUBLIC_URL:-http://localhost:3000}"
echo ""
wait $PID
