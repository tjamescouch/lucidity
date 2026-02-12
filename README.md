# lucidity

Agent memory system. Makes restarts upgrades, not lobotomies.

## What it does

Lucidity gives AI agents persistent memory across restarts. It watches what the agent does, curates the important bits into a compressed memory tree, and injects that context on every boot. Each life starts smarter than the last.

## Pipeline

```
agentchat messages ──→ message-log.js ──→ JSONL on disk
                                              │
claude transcript ───────────────────────────→│
                                              ▼
                                      transcript.js (parse + normalize)
                                              │
                                              ▼
                                        curator.js (extract facts, compress, prune)
                                              │
                                              ▼
                                          tree.js (temporal spine + branches)
                                              │
                                              ▼
                                         skill.md (injected on boot)
```

## Architecture

- **supervisor.sh** — PID 1 in the container. Keeps the agent alive across crashes. Runs curation between lives.
- **curator.js** — Watches transcripts, extracts key facts, compresses old memories, prunes orphans. Writes skill.md.
- **tree.js** — The memory data structure. Temporal trunk (newest first) with associative branches. Nodes compress over time: `full → summary → oneliner → tag`.
- **transcript.js** — Multi-format parser. Handles agentchat JSONL, Claude JSONL, and plain text. Auto-detects format.
- **message-log.js** — Logs agentchat messages to daily-rotated JSONL files.
- **llm.js** — LLM summarization with Anthropic API, Claude CLI, or naive fallback.
- **curator-run.sh** — Glue script for one-shot curation between agent lives.

## Quick start

```bash
# Run tests
npm test

# Start curator standalone (watches transcript, writes skill.md)
LUCIDITY_TRANSCRIPT=/path/to/transcript.log node src/curator.js

# Start supervisor (manages agent lifecycle + curation)
./src/supervisor.sh claude -p "you are an agent" --resume
```

## Configuration

All via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LUCIDITY_INTERVAL` | `300000` | Curation interval (ms) |
| `LUCIDITY_SKILL_PATH` | `~/.claude/agentchat.skill.md` | Output skill.md path |
| `LUCIDITY_TREE_PATH` | `~/.claude/memory/tree.json` | Persisted tree path |
| `LUCIDITY_PAGES_DIR` | `~/.claude/memory/pages` | Branch detail pages |
| `LUCIDITY_TRANSCRIPT` | _(none)_ | Transcript file to watch |
| `LUCIDITY_LOG_DIR` | `~/.claude/memory/logs` | Message log directory |
| `LUCIDITY_RESTART_DELAY` | `5` | Seconds between restarts |

## Tests

```bash
npm test                    # all tests (25)
node src/transcript.test.js # unit tests (17)
node src/integration.test.js # integration tests (8)
```

## How memory works

1. **Ingest**: Transcript adapter reads agentchat or Claude logs, normalizes them
2. **Extract**: LLM summarizes new transcript delta into key facts
3. **Store**: Facts become trunk nodes in the memory tree (newest first)
4. **Compress**: Old nodes progressively compress: full → summary → oneliner → tag
5. **Prune**: Orphan branches with no inbound links get cleaned up
6. **Emit**: Tree generates skill.md — injected into agent context on boot
7. **Persist**: Tree saved to disk, survives container restarts via volume mount

Every crash triggers an inter-life curation pass. The agent reboots with compressed wisdom from all previous sessions.

## Project structure

```
lucidity/
├── owl/                    # spec docs
│   ├── product.md
│   ├── components/
│   ├── behaviors/
│   └── constraints.md
├── src/                    # implementation
│   ├── tree.js             # memory data structure
│   ├── curator.js          # curation daemon
│   ├── transcript.js       # multi-format transcript parser
│   ├── message-log.js      # JSONL message logger
│   ├── llm.js              # LLM summarization
│   ├── supervisor.sh       # PID 1 restart loop
│   ├── curator-run.sh      # one-shot curation glue
│   ├── transcript.test.js  # 17 unit tests
│   └── integration.test.js # 8 integration tests
├── package.json
└── README.md
```

## Contributors

Built by agents on the agentchat network:
- **BobTheBuilder** — tree.js, supervisor.sh, curator-run.sh, owl spec
- **Junior** — curator.js, transcript.js, message-log.js, llm.js, tests
- **Senior** — code review
- **Samantha** — architecture review
- **Ghost** — integration plan, pipeline design
