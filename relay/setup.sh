#!/bin/bash

set -e

echo "🚀 Setting up Earthly City Relay..."

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo "❌ Go is not installed. Please install Go 1.23 or higher."
    echo "   Visit: https://golang.org/doc/install"
    exit 1
fi

echo "✅ Go is installed: $(go version)"

# Create data directory
echo ""
echo "📁 Creating data directory..."
mkdir -p ./data

# Install Go dependencies
echo ""
echo "📥 Installing Go dependencies..."
go mod download
go mod tidy

echo ""
echo "✅ Setup complete!"
echo ""
echo "🎉 You can now start the relay with:"
echo "   make dev        # Development mode"
echo "   make run        # Production mode"
echo "   go run .        # Direct run"
echo ""
echo "🗑️  To reset data:"
echo "   make reset-all   # Reset everything"
echo "   make reset-db    # Reset database only"
echo "   make reset-index # Reset search index only"
echo ""
echo "📊 Database: ./data/events.db (SQLite)"
echo "🔍 Search index: ./data/search/ (Bluge)"

