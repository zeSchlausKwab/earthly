#!/bin/bash

# Kill any process using port 3334
echo "🔍 Looking for processes on port 3334..."

# Find and kill the process
PID=$(lsof -ti:3334)

if [ -z "$PID" ]; then
  echo "✅ No process found on port 3334"
else
  echo "🔫 Killing process $PID on port 3334..."
  kill -9 $PID
  echo "✅ Process killed"
fi

# Also kill any go run processes that might be stuck
echo "🔍 Looking for go run relay processes..."
pkill -f "go run.*relay" && echo "✅ Killed go run relay processes" || echo "✅ No go run relay processes found"

# Wipe the canonical LMDB event store, large-content sidecar, and derived
# search index. Leaving any canonical part behind would make `bun run dev`
# accumulate another complete seed set while claiming the database was clean.
echo "🗑️  Wiping database and search index..."
rm -rf relay/data/events-lmdb
rm -f relay/data/large-event-content.db
rm -rf relay/data/search
echo "✅ Database wiped"

echo "✅ Cleanup complete!"
