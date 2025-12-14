#!/bin/bash
#
# Production Build Script
#
# Loads environment variables and runs the build.
# The build script (build.ts) handles validation and shows which values are used.
#

set -e

echo "🏗️  Building Earthly for production..."
echo ""

# Load environment variables
# Priority: .env.production > .env
if [ -f .env.production ]; then
    echo "📋 Loading environment from .env.production"
    set -a
    source .env.production
    set +a
elif [ -f .env ]; then
    echo "📋 Loading environment from .env"
    set -a
    source .env
    set +a
else
    echo "⚠️  No .env file found - using defaults"
fi

echo ""

# Build the frontend (build.ts validates env and shows config)
bun run build.ts

echo ""
echo "✅ Frontend build complete!"
echo ""
echo "Output:"
echo "  - Frontend: ./dist/"
echo ""
echo "Note: Go relay will be built on the VPS during deployment"
