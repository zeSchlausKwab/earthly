#!/bin/bash

# Cleanup function to kill all background processes
cleanup() {
  echo ""
  echo "🛑 Shutting down..."
  
  # Kill all child processes
  pkill -P $$
  
  # Kill specific processes
  pkill -f "go run.*relay"
  pkill -f "bun.*contextvm"
  pkill -f "bun --hot"
  
  # Kill process on port 3334
  lsof -ti:3334 | xargs kill -9 2>/dev/null
  
  echo "✅ Cleanup complete"
  exit 0
}

# Set trap to call cleanup on Ctrl+C or script exit
trap cleanup INT TERM EXIT

echo "🚀 Starting development environment..."
echo "Press Ctrl+C to stop all processes"
echo ""

# Kill any existing processes and wipe database
./scripts/kill-relay.sh

# Start relay in background
echo "📡 Starting relay..."
cd relay && go run . --port 3334 &
RELAY_PID=$!

# Wait for relay to start
sleep 2

# Seed the local relay with the current v1.2 entity model via the unified
# seeder (scripts/seed.ts — seed:entities/seed:sightings are thin aliases):
#   seed full      → Groups (governance ladder) + curated/foreign datasets +
#                    contributor profiles + Stories (37520) + Live Beacons (37521)
#                    + geo-annotated comment threads (37517) + reactions (7)
#   seed sightings → Temporal Sightings (37522) — distinct points, live/upcoming/past
echo "🌱 Seeding v1.2 entities (groups / datasets / stories / beacons)..."
bun run seed:entities
echo "🌱 Seeding temporal sightings..."
bun run seed:sightings

# Start ContextVM in background
echo "🤖 Starting ContextVM..."
bun run contextvm/server.ts &
CONTEXTVM_PID=$!

# Start Blossom server in background
# echo "🌸 Starting Blossom server..."
# bun --hot src/blossom.ts &
# BLOSSOM_PID=$!

# Start frontend (this will stay in foreground)
echo "⚛️  Starting frontend..."
bun --hot src/index.ts --host 0.0.0.0

# If we get here, frontend was stopped
cleanup
