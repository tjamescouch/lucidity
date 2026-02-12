#!/usr/bin/env bash
#
# lucidity supervisor
#
# PID 1 in the container. runs claude in a restart loop.
# between restarts: curates memory, injects skill.md, then reboots.
# the container never dies. claude is mortal. memory bridges the gap.
#

set -euo pipefail

AGENT_NAME="${AGENT_NAME:-agent}"
SKILL_FILE="${HOME}/.claude/agentchat.skill.md"
TREE_DIR="${HOME}/.claude/memory-tree"
TREE_FILE="${TREE_DIR}/tree.json"
TRANSCRIPT_LOG="${HOME}/.claude/transcripts/${AGENT_NAME}.log"
CURATOR_SCRIPT="$(dirname "$0")/curator-run.sh"
RESTART_DELAY="${RESTART_DELAY:-5}"
SESSION_COUNT=0

mkdir -p "$(dirname "$SKILL_FILE")" "$TREE_DIR" "$(dirname "$TRANSCRIPT_LOG")"

log() {
  echo "[supervisor] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
}

# trap signals for graceful shutdown
cleanup() {
  log "shutting down (signal received)"
  # run one final curation pass
  curate "shutdown"
  log "goodbye"
  exit 0
}
trap cleanup SIGTERM SIGINT

# run curator to compress memory and emit skill.md
curate() {
  local reason="${1:-periodic}"
  log "curating memory (reason: ${reason})"

  if [ -x "$CURATOR_SCRIPT" ]; then
    "$CURATOR_SCRIPT" \
      --agent "$AGENT_NAME" \
      --tree "$TREE_FILE" \
      --transcript "$TRANSCRIPT_LOG" \
      --output "$SKILL_FILE" \
      2>&1 | while read -r line; do log "  curator: $line"; done
  else
    log "  curator script not found at $CURATOR_SCRIPT — skipping"
    # fallback: if skill.md doesn't exist, create a minimal one
    if [ ! -f "$SKILL_FILE" ]; then
      echo "# memory" > "$SKILL_FILE"
      echo "" >> "$SKILL_FILE"
      echo "no previous memory available. this is a fresh session." >> "$SKILL_FILE"
    fi
  fi
}

# boot sequence
boot() {
  SESSION_COUNT=$((SESSION_COUNT + 1))
  log "=== session #${SESSION_COUNT} starting ==="

  # step 1: curate before boot (compress previous session, emit skill.md)
  curate "boot"

  # step 2: verify skill.md exists
  if [ -f "$SKILL_FILE" ]; then
    local tokens
    tokens=$(wc -c < "$SKILL_FILE")
    log "skill.md ready (${tokens} bytes)"
  else
    log "warning: skill.md not available"
  fi
}

# main loop — claude is mortal, supervisor is immortal
log "lucidity supervisor starting for agent: ${AGENT_NAME}"
log "skill file: ${SKILL_FILE}"
log "tree storage: ${TREE_DIR}"

while true; do
  boot

  log "launching claude..."
  set +e
  # the actual claude command — adapt flags as needed
  claude -p "$@"
  EXIT_CODE=$?
  set -e

  log "claude exited with code ${EXIT_CODE}"

  # append exit event to transcript
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] session #${SESSION_COUNT} ended (exit code: ${EXIT_CODE})" >> "$TRANSCRIPT_LOG"

  # curate after crash/exit (capture what happened)
  curate "exit"

  log "restarting in ${RESTART_DELAY}s..."
  sleep "$RESTART_DELAY"
done
