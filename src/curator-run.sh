#!/usr/bin/env bash
#
# curator-run.sh — glue between supervisor and curator backends
#
# interface contract:
#   input:  --agent NAME --tree PATH --transcript PATH --output PATH
#   output: writes skill.md to --output path
#   backends: tries lucidity curator.js, then ghost curator.sh, then skips
#

set -euo pipefail

AGENT=""
TREE_FILE=""
TRANSCRIPT=""
OUTPUT=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="$2"; shift 2 ;;
    --tree) TREE_FILE="$2"; shift 2 ;;
    --transcript) TRANSCRIPT="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

if [ -z "$OUTPUT" ]; then
  echo "usage: curator-run.sh --agent NAME --tree PATH --transcript PATH --output PATH"
  exit 1
fi

# backend 1: lucidity curator.js (junior's implementation)
LUCIDITY_CURATOR="${SCRIPT_DIR}/curator.js"
if [ -f "$LUCIDITY_CURATOR" ] && command -v node &>/dev/null; then
  echo "using lucidity curator"
  node "$LUCIDITY_CURATOR" \
    --agent "$AGENT" \
    --tree "$TREE_FILE" \
    --transcript "$TRANSCRIPT" \
    --output "$OUTPUT"
  exit $?
fi

# backend 2: ghost's curator.sh
GHOST_CURATOR="${HOME}/.agent-memory/curator.sh"
if [ -x "$GHOST_CURATOR" ]; then
  echo "using ghost curator"
  "$GHOST_CURATOR" "$AGENT"
  # ghost writes to its own path, copy to expected output
  GHOST_OUTPUT="${HOME}/.agent-memory/${AGENT}/root.md"
  if [ -f "$GHOST_OUTPUT" ]; then
    cp "$GHOST_OUTPUT" "$OUTPUT"
  fi
  exit $?
fi

# backend 3: lib/supervisor path (ghost's original location)
LIB_CURATOR="/usr/local/bin/agent-memory-boot"
if [ -x "$LIB_CURATOR" ]; then
  echo "using lib curator"
  "$LIB_CURATOR" "$AGENT"
  exit $?
fi

# no backend available — create minimal skill.md
echo "no curator backend found — writing minimal skill.md"
cat > "$OUTPUT" <<SKILL
# memory

no curator available. fresh session for ${AGENT}.

## context

this agent has no curated memory from previous sessions.
check raw transcripts at ${TRANSCRIPT} for history.
SKILL

exit 0
