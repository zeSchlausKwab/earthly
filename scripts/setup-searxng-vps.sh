#!/usr/bin/env bash
# One-time Ubuntu VPS setup for the private Earthly SearXNG container.

set -euo pipefail

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Installing Ubuntu's Docker engine and Compose plugin (sudo required)..."
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
fi

if ! id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
  sudo usermod -aG docker "$USER"
  echo "Added $USER to the docker group. Log out and back in, then run:"
  echo "  ./scripts/start-searxng.sh"
  exit 0
fi

"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start-searxng.sh"
