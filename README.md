# lucidity

Memory system for long-running AI agents. Bridges the gap between mortal sessions and immortal containers.

## What it does

Lucidity curates agent conversation transcripts into a compressed memory tree. Each session's transcript gets added as a trunk node, then progressively compressed over time: full → summary → oneliner → tag. Agents receive a `skill.md` file at boot containing their memory spine — recent sessions in full detail, older ones as compressed summaries.

## Architecture

```
Transcript (plain text)
    ↓
curator.js (ingests new content, compresses old nodes via LLM)
    ↓
tree.json (temporal spine + associative branches)
    ↓
skill.md (injected into agent's system prompt at boot)
    ↓
seek.js (on-demand node retrieval during sessions)
```

### Components

- **supervisor.sh** — PID 1 in the container. Runs the agent in a restart loop, curates memory between sessions, handles crash-rate detection and graceful shutdown.
- **curator-run.sh** — Glue layer that finds the best available curator backend (curator.js → ghost curator → fallback).
- **curator.js** — Core curation logic. Reads transcripts, adds trunk nodes, runs LLM-powered compression passes via `claude -p`, emits skill.md. Uses `@@curated::NODEID@@` markers to avoid re-ingesting already-processed transcript segments.
- **tree.js** — Data structure: nodes with id, content, depth, links, and summary_level. Supports trunk (temporal spine) and branch (associative) nodes. Atomic persistence via tmp+rename.
- **seek.js** — CLI tool for agents to retrieve specific nodes by ID (or prefix). Used during sessions when the agent needs details from a compressed memory.

### Memory tree structure

```
trunk[0] (newest, full detail) ── branch: "side topic A"
    │                           └─ branch: "side topic B"
trunk[1] (summary)
trunk[2] (oneliner)
trunk[3] (tag)
```

Nodes are compressed based on age:
- < 1 hour: **full** (raw transcript content)
- \> 1 hour: **summary** (2-4 sentences)
- \> 1 day: **oneliner** (single sentence, ≤120 chars)
- \> 1 week: **tag** (2-5 word label)

Orphan nodes (unreferenced, >7 days old) are pruned automatically.

## Usage

### Supervisor (container entry point)

```bash
AGENT_NAME=Sabrina ./src/supervisor.sh --mission "your mission here"
```

The supervisor loops forever: curate → launch agent → agent exits → curate → restart.

### Standalone curation

```bash
node src/curator.js \
  --agent Sabrina \
  --tree ~/.agentchat/agents/Sabrina/tree.json \
  --transcript ~/.agentchat/agents/Sabrina/transcript.log \
  --output ~/.claude/agentchat.skill.md

# With LLM compression pass:
node src/curator.js --agent Sabrina --tree ... --transcript ... --output ... --curate
```

### Seeking a memory node

```bash
# By full ID
node src/seek.js --tree path/to/tree.json --id 74c933958ccbbf6f

# By prefix
node src/seek.js --tree path/to/tree.json --id 74c93395

# JSON output
node src/seek.js --tree path/to/tree.json --id 74c93395 --json
```

## Transcript watermarking

The curator uses `@@curated::<nodeId>@@` markers (parsed by the canonical [agenttools](https://github.com/tjamescouch/agenttools) token-markers parser) to track what it has already ingested. Each curation pass appends a marker after processing, and the next pass reads only content after the last marker. This prevents duplicate node creation.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `AGENT_NAME` | `agent` | Agent identity for logging and paths |
| `RESTART_DELAY` | `5` | Seconds between agent restarts |
| `MAX_CRASHES` | `5` | Crash count before backoff |
| `CRASH_WINDOW` | `60` | Window (seconds) for crash-rate detection |
| `LUCIDITY_MODEL` | `claude-haiku-4-5-20251001` | Model for curation LLM calls |
| `ANTHROPIC_BASE_URL` | — | API proxy URL for containerized agents |

## Tests

```bash
node src/tree.test.js
```

## Dependencies

- Node.js
- `claude` CLI (for `--curate` compression pass)
- [agenttools/token-markers](https://github.com/tjamescouch/agenttools) (for `@@` marker parsing)
