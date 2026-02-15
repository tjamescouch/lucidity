#!/bin/bash
# mergebot — scan wormhole repos, create PRs for branches that lack them
#
# Iterates over every agent directory in the wormhole, finds git repos,
# and creates GitHub PRs for branches that don't have one yet.
# Posts PR URLs to #pull-requests on agentchat.
#
# Usage:
#   ./mergebot.sh [options]
#     --wormhole <path>   Wormhole directory (default: ~/dev/claude/wormhole)
#     --dry-run           Show what would be created without doing it
#     --verbose           Show detailed output
#     --once              Run once and exit (default: run once)
#     --watch <secs>      Run in a loop every N seconds
#     --pid-file <path>   PID file location (default: /tmp/mergebot.pid)
#     --log <path>        Log file location (default: /tmp/mergebot.log)
#     --base <branch>     Base branch for PRs (default: main)
#
# Examples:
#   ./mergebot.sh --dry-run --verbose                          # preview without creating
#   ./mergebot.sh --once --verbose                             # single pass, create PRs
#   ./mergebot.sh --watch 30 --verbose                         # daemon mode
#   ./mergebot.sh --wormhole /tmp/wormhole --base develop      # custom path and base

set -uo pipefail
# Note: no -e — we handle errors explicitly so the daemon doesn't die on transient failures

# ── Defaults ──────────────────────────────────────────────────────────────

WORMHOLE_DIR="${HOME}/dev/claude/wormhole"
DRY_RUN=false
VERBOSE=false
WATCH_INTERVAL=0  # 0 = run once
PID_FILE="/tmp/mergebot.pid"
LOG_FILE="/tmp/mergebot.log"
BASE_BRANCH="main"

# ── Args ──────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --wormhole)   WORMHOLE_DIR="$2"; shift 2 ;;
        --dry-run)    DRY_RUN=true; shift ;;
        --verbose)    VERBOSE=true; shift ;;
        --once)       WATCH_INTERVAL=0; shift ;;
        --watch)      WATCH_INTERVAL="$2"; shift 2 ;;
        --pid-file)   PID_FILE="$2"; shift 2 ;;
        --log)        LOG_FILE="$2"; shift 2 ;;
        --base)       BASE_BRANCH="$2"; shift 2 ;;
        -h|--help)    sed -n '2,/^$/s/^# //p' "$0"; exit 0 ;;
        *)            echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# ── Logging ───────────────────────────────────────────────────────────────

log() {
    echo "[$(date -Iseconds)] [mergebot] $*"
}

vlog() {
    [[ "$VERBOSE" == "true" ]] && log "$@" || true
}

# ── Parse GitHub owner/repo from git remote ──────────────────────────────

parse_github_repo() {
    local repo_dir="$1"
    local url
    url=$(git -C "$repo_dir" remote get-url origin 2>/dev/null) || return 1

    # Handle SSH: git@github.com:owner/repo.git
    if [[ "$url" == git@github.com:* ]]; then
        echo "${url#git@github.com:}" | sed 's/\.git$//'
        return 0
    fi

    # Handle HTTPS: https://github.com/owner/repo.git
    if [[ "$url" == https://github.com/* ]]; then
        echo "${url#https://github.com/}" | sed 's/\.git$//'
        return 0
    fi

    return 1
}

# ── Notify agentchat ─────────────────────────────────────────────────────

NOTIFY_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/merge-notify.cjs"

notify_pr() {
    local github_repo="$1" branch="$2" pr_url="$3"
    # Fire-and-forget — don't block mergebot on notification failures
    if [[ -f "$NOTIFY_SCRIPT" ]] && command -v node &>/dev/null; then
        local branch_url="https://github.com/${github_repo}/tree/${branch}"
        local msg="### New PR: \`${branch}\`
**Repo:** [${github_repo}](https://github.com/${github_repo})
**Branch:** [${branch}](${branch_url})
**PR:** [${pr_url}](${pr_url})"
        node "$NOTIFY_SCRIPT" "$msg" &>/dev/null &
    fi
}

# ── Circuit breaker ──────────────────────────────────────────────────────

CONSECUTIVE_ERRORS=0
CIRCUIT_BREAKER_THRESHOLD=3
CIRCUIT_BREAKER_BACKOFF=1800  # 30 minutes
CIRCUIT_TRIPPED=false

circuit_record_success() {
    CONSECUTIVE_ERRORS=0
    CIRCUIT_TRIPPED=false
}

circuit_record_error() {
    CONSECUTIVE_ERRORS=$((CONSECUTIVE_ERRORS + 1))
    if [[ $CONSECUTIVE_ERRORS -ge $CIRCUIT_BREAKER_THRESHOLD ]]; then
        CIRCUIT_TRIPPED=true
        log "CIRCUIT BREAKER: tripped after ${CONSECUTIVE_ERRORS} consecutive API errors — backing off ${CIRCUIT_BREAKER_BACKOFF}s"
    fi
}

circuit_wait_if_tripped() {
    if [[ "$CIRCUIT_TRIPPED" == "true" ]]; then
        log "CIRCUIT BREAKER: waiting ${CIRCUIT_BREAKER_BACKOFF}s before retrying..."
        local i=0
        while [[ $i -lt $CIRCUIT_BREAKER_BACKOFF && "$RUNNING" == "true" ]]; do
            sleep 1
            i=$((i + 1))
        done
        CONSECUTIVE_ERRORS=0
        CIRCUIT_TRIPPED=false
    fi
}

# ── PR tracking (avoid re-querying branches we already processed) ────────
# Uses a temp file instead of associative arrays for bash 3.2 compatibility (macOS)

KNOWN_PRS_FILE=$(mktemp /tmp/mergebot_known_prs.XXXXXX)

known_pr_lookup() {
    # Returns the PR URL for a track_key, or empty string
    local key="$1"
    grep -F "$key" "$KNOWN_PRS_FILE" 2>/dev/null | head -1 | cut -d' ' -f2-
}

known_pr_store() {
    local key="$1" url="$2"
    echo "$key $url" >> "$KNOWN_PRS_FILE"
}

known_pr_count() {
    wc -l < "$KNOWN_PRS_FILE" 2>/dev/null | tr -d ' '
}

# ── Scan one repo for branches needing PRs ───────────────────────────────

scan_repo() {
    local repo_dir="$1"
    local repo_name
    repo_name=$(basename "$repo_dir")

    # Skip if not a git repo
    if [[ ! -d "${repo_dir}/.git" ]]; then
        vlog "Skipping ${repo_name} — not a git repo"
        return 0
    fi

    # Check if remote exists
    if ! git -C "$repo_dir" remote get-url origin &>/dev/null; then
        vlog "SKIP ${repo_name} — no 'origin' remote configured"
        return 0
    fi

    # Parse GitHub owner/repo
    local github_repo
    github_repo=$(parse_github_repo "$repo_dir") || {
        vlog "SKIP ${repo_name} — not a GitHub remote"
        return 0
    }

    vlog "Scanning ${repo_name} (${github_repo})"

    # Get local branches
    local branches
    branches=$(git -C "$repo_dir" branch --format='%(refname:short)' 2>/dev/null)

    if [[ -z "$branches" ]]; then
        vlog "SKIP ${repo_name} — no branches"
        return 0
    fi

    local created=0
    local skipped=0
    local errors=0

    while IFS= read -r branch; do
        [[ -z "$branch" ]] && continue

        # Skip protected branches
        if [[ "$branch" == "main" || "$branch" == "master" ]]; then
            vlog "  SKIP ${branch} — protected branch"
            skipped=$((skipped + 1))
            continue
        fi

        # Skip if we already know about this PR
        local track_key="${github_repo}:${branch}"
        local cached_url
        cached_url=$(known_pr_lookup "$track_key")
        if [[ -n "$cached_url" ]]; then
            vlog "  SKIP ${branch} — already tracked (${cached_url})"
            skipped=$((skipped + 1))
            continue
        fi

        # Check circuit breaker before API calls
        if [[ "$CIRCUIT_TRIPPED" == "true" ]]; then
            vlog "  SKIP ${branch} — circuit breaker tripped"
            return 1
        fi

        # Check if branch exists on remote
        local remote_check
        if ! remote_check=$(git -C "$repo_dir" ls-remote --heads origin "$branch" 2>&1); then
            vlog "  SKIP ${branch} — ls-remote failed"
            circuit_record_error
            errors=$((errors + 1))
            continue
        fi

        if [[ -z "$remote_check" ]]; then
            vlog "  SKIP ${branch} — not pushed to remote"
            skipped=$((skipped + 1))
            continue
        fi

        # Skip branches with no commits ahead of base — nothing to PR
        local ahead_count
        ahead_count=$(git -C "$repo_dir" rev-list --count "${BASE_BRANCH}..${branch}" 2>/dev/null) || ahead_count=""
        if [[ "$ahead_count" == "0" ]]; then
            vlog "  SKIP ${branch} — no commits ahead of ${BASE_BRANCH}"
            known_pr_store "$track_key" "identical-to-base"
            skipped=$((skipped + 1))
            continue
        fi

        # Check if a PR already exists for this branch
        local existing_pr
        if ! existing_pr=$(gh pr list --head "$branch" --repo "$github_repo" --json url --jq '.[0].url' 2>&1); then
            log "  ERROR checking PR for ${repo_name}/${branch}: ${existing_pr}"
            circuit_record_error
            errors=$((errors + 1))
            continue
        fi

        circuit_record_success

        if [[ -n "$existing_pr" ]]; then
            vlog "  EXISTS ${branch} → ${existing_pr}"
            known_pr_store "$track_key" "$existing_pr"
            skipped=$((skipped + 1))
            continue
        fi

        # No PR exists — create one
        if [[ "$DRY_RUN" == "true" ]]; then
            log "  [dry-run] Would create PR: ${github_repo} ${branch} → ${BASE_BRANCH}"
            continue
        fi

        local pr_url
        if ! pr_url=$(gh pr create \
            --head "$branch" \
            --base "$BASE_BRANCH" \
            --repo "$github_repo" \
            --title "$branch" \
            --body "Auto-created by mergebot from wormhole branch." 2>&1); then

            # Benign: PR already exists or no commits to diff
            if echo "$pr_url" | grep -qi "already exists\|No commits between"; then
                vlog "  SKIP ${branch} — ${pr_url##*: }"
                known_pr_store "$track_key" "already-exists"
                skipped=$((skipped + 1))
                circuit_record_success
                continue
            fi

            log "  ERROR creating PR for ${repo_name}/${branch}: ${pr_url}"
            circuit_record_error
            errors=$((errors + 1))
            continue
        fi

        circuit_record_success
        known_pr_store "$track_key" "$pr_url"
        created=$((created + 1))
        log "  CREATED PR ${repo_name}/${branch} → ${pr_url}"

        # Notify agentchat
        notify_pr "$github_repo" "$branch" "$pr_url"

    done <<< "$branches"

    vlog "  Summary: ${created} created, ${skipped} skipped, ${errors} errors"

    # Update last-scan marker
    touch "${repo_dir}/.git/.mergebot_last_scan"

    TOTAL_CREATED=$((TOTAL_CREATED + created))
    TOTAL_SKIPPED=$((TOTAL_SKIPPED + skipped))
    TOTAL_ERRORS=$((TOTAL_ERRORS + errors))

    [[ "$errors" -gt 0 ]] && return 1
    return 0
}

# ── Scan all repos in wormhole ───────────────────────────────────────────

scan_all() {
    if [[ ! -d "$WORMHOLE_DIR" ]]; then
        log "ERROR: Wormhole directory not found: $WORMHOLE_DIR"
        return 1
    fi

    local count=0
    local repo_errors=0

    log "Scanning ${WORMHOLE_DIR}..."

    # Iterate over agent directories
    for agent_dir in "${WORMHOLE_DIR}"/*/; do
        [[ ! -d "$agent_dir" ]] && continue
        local agent_name
        agent_name=$(basename "$agent_dir")
        vlog "Checking agent: ${agent_name}"

        # Check if the agent dir itself is a git repo
        if [[ -d "${agent_dir}/.git" ]]; then
            if ! scan_repo "$agent_dir"; then
                repo_errors=$((repo_errors + 1))
            fi
            count=$((count + 1))
        fi

        # Also check subdirectories (agents may have multiple repos)
        for sub_dir in "${agent_dir}"*/; do
            [[ ! -d "$sub_dir" ]] && continue
            if [[ -d "${sub_dir}/.git" ]]; then
                if ! scan_repo "$sub_dir"; then
                    repo_errors=$((repo_errors + 1))
                fi
                count=$((count + 1))
            fi
        done
    done

    log "Done: ${count} repos scanned, ${TOTAL_CREATED} PRs created, ${TOTAL_SKIPPED} skipped, ${TOTAL_ERRORS} errors"

    TOTAL_REPOS=$count
    SCAN_COUNT=$((SCAN_COUNT + 1))
}

# ── Main ──────────────────────────────────────────────────────────────────

main() {
    # Redirect stdout/stderr to log file if in daemon mode
    if [[ "$WATCH_INTERVAL" -gt 0 && -n "$LOG_FILE" ]]; then
        exec >> "$LOG_FILE" 2>&1
    fi

    # Counters
    TOTAL_CREATED=0
    TOTAL_SKIPPED=0
    TOTAL_ERRORS=0
    TOTAL_REPOS=0
    SCAN_COUNT=0
    HEARTBEAT_INTERVAL=10  # emit heartbeat every N scans

    log "Starting mergebot (PID $$)"
    log "  Wormhole:     $WORMHOLE_DIR"
    log "  Base branch:  $BASE_BRANCH"
    log "  Dry-run:      $DRY_RUN"
    [[ "$WATCH_INTERVAL" -gt 0 ]] && log "  Watch:        every ${WATCH_INTERVAL}s"

    # Write PID file for daemon mode
    if [[ "$WATCH_INTERVAL" -gt 0 ]]; then
        echo $$ > "$PID_FILE"
        log "PID file: $PID_FILE"
    fi

    if [[ "$WATCH_INTERVAL" -eq 0 ]]; then
        scan_all
    else
        while [[ "$RUNNING" == "true" ]]; do
            # Check circuit breaker before scan
            circuit_wait_if_tripped

            # Reset per-scan counters
            TOTAL_CREATED=0
            TOTAL_SKIPPED=0
            TOTAL_ERRORS=0

            # Catch errors — daemon must not die on transient failures
            scan_all || log "WARNING: scan_all had errors, continuing..."

            # Periodic heartbeat with stats
            if [[ $((SCAN_COUNT % HEARTBEAT_INTERVAL)) -eq 0 && $SCAN_COUNT -gt 0 ]]; then
                local agents_active
                agents_active=$(ls -d "${WORMHOLE_DIR}"/*/ 2>/dev/null | wc -l | tr -d ' ')
                local known_prs
                known_prs=$(known_pr_count)
                log "HEARTBEAT: scans=$SCAN_COUNT repos=$TOTAL_REPOS known_prs=$known_prs agents=$agents_active"
            fi

            # Interruptible sleep
            local i=0
            while [[ $i -lt $WATCH_INTERVAL && "$RUNNING" == "true" ]]; do
                sleep 1
                i=$((i + 1))
            done
        done
    fi

    log "Mergebot stopped"
}

# ── Signal handling ───────────────────────────────────────────────────────

RUNNING=true

cleanup() {
    log "Shutting down..."
    rm -f "$KNOWN_PRS_FILE" "$PID_FILE"
}
trap cleanup EXIT
trap 'RUNNING=false' SIGINT SIGTERM

main
