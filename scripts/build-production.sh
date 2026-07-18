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

# A signed Android release preloads its validated public configuration in the
# parent process so Cargo and the nested frontend build compile the same values.
if [ "${EARTHLY_PUBLIC_ENV_PRELOADED:-}" = "1" ]; then
    echo "📋 Using preloaded public application environment"
elif [ -f .env.production ]; then
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

if [ "${EARTHLY_PUBLIC_ENV_PRELOADED:-}" = "1" ]; then
    : # The Android release wrapper already validated its public environment.
elif [ -f .env.production ]; then
    bun --env-file=.env.production scripts/validate-production-env.ts
elif [ "${NODE_ENV:-}" = "production" ]; then
    bun scripts/validate-production-env.ts
fi

# Build the frontend (build.ts validates env and shows config)
bun run build.ts

echo ""
echo "✅ Frontend build complete!"
echo ""
echo "Output:"
echo "  - Frontend: ./dist/"
echo ""
echo "Note: Go relay will be built on the VPS during deployment"
