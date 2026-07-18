#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIAGRAM_DIR="$ROOT_DIR/docs/architecture/diagrams"
D2_BIN="${D2_BIN:-d2}"
EXPECTED_D2_VERSION="v0.7.1"

if ! ACTUAL_D2_VERSION="$("$D2_BIN" version 2>/dev/null)"; then
  echo "D2 is required to render the architecture diagrams." >&2
  echo "Install D2 from https://d2lang.com/tour/install or set D2_BIN=/path/to/d2." >&2
  exit 1
fi

if [[ "$ACTUAL_D2_VERSION" != "$EXPECTED_D2_VERSION" ]]; then
  echo "Expected D2 $EXPECTED_D2_VERSION, found $ACTUAL_D2_VERSION." >&2
  echo "Use D2 $EXPECTED_D2_VERSION so generated SVG diffs remain reproducible." >&2
  exit 1
fi

for source in "$DIAGRAM_DIR"/*.d2; do
  output="${source%.d2}.svg"
  echo "Rendering ${source#$ROOT_DIR/}"
  "$D2_BIN" --layout=elk --pad=32 "$source" "$output"
done

echo "Architecture diagrams are current."
