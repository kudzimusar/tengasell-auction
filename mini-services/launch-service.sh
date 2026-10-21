#!/usr/bin/env bash
# Tengasell mini-service launcher — idempotent, used by cron to start services
# detached from any agent shell (the sandbox reaps agent-shell process trees).
# Usage: launch-service.sh <service-folder-name> <port> [entry]
set -u

FOLDER_NAME="${1:?usage: launch-service.sh <folder> <port> [entry]}"
PORT="${2:?port required}"
ENTRY="${3:-index.ts}"
BASE="/home/z/my-project/mini-services/${FOLDER_NAME}"

# Already listening? Nothing to do.
if ss -tln "sport = :${PORT}" 2>/dev/null | grep -q "LISTEN"; then
  echo "[launch] ${FOLDER_NAME} already listening on :${PORT}"
  exit 0
fi

cd "${BASE}" || { echo "[launch] folder not found: ${BASE}"; exit 1; }

LOG="${BASE}/${FOLDER_NAME}.log"
setsid nohup bun "${ENTRY}" >> "${LOG}" 2>&1 < /dev/null &
LAUNCHER_PID=$!

# Give it a moment to bind, then confirm.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 0.5
  if ss -tln "sport = :${PORT}" 2>/dev/null | grep -q "LISTEN"; then
    echo "[launch] ${FOLDER_NAME} started on :${PORT} (launcher pid ${LAUNCHER_PID})"
    exit 0
  fi
done

echo "[launch] FAILED to start ${FOLDER_NAME} on :${PORT} — tail of ${LOG}:"
tail -5 "${LOG}"
exit 1
