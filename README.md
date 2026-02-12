# Lucidity

Persistent memory for long-running AI agents. Agents that restart come back sharper, not blank.

## What it does

Lucidity maintains a memory tree — a temporal spine with associative branches — that survives agent restarts. Recent context stays high-fidelity; older context progressively compresses. On each boot, the tree is flattened into a `skill.md` file injected into the agent's context.

Every restart is an upgrade, not a lobotomy.

## How it works

```
agent crashes/exits
       ↓
supervisor.sh (PID 1, never dies)
       ↓
curator-run.sh → curator.js
       ↓
reads transcripts → updates tree.json → writes skill.md
       ↓
agent reboots with curated memory
       ↓
repeat
```

The **supervisor** is the immortal shell. The **curator** runs between agent lives, compressing and indexing memories. The **agent** is mortal — but each life starts with everything learned from previous ones.

## Architecture

| Component | File | Role |
|-----------|------|------|
| Supervisor | `src/supervisor.sh` | PID 1 restart loop with crash-rate backoff |
| Curator runner | `src/curator-run.sh` | Glue script — finds best available curator backend |
| Memory tree | `src/tree.js` | Tree data structure, compression, skill.md generation |
| Spec | `product.md`, `components/`, `behaviors/`, `constraints.md` | OWL spec defining the system |

## Memory model

Nodes in the tree have a one-way compression ladder:

```
full → summary → oneliner → tag
```

Entropy only increases. Memories compress but never expand. Default thresholds:
- **< 1 hour**: full detail
- **1 hour – 1 day**: summary
- **1 day – 1 week**: oneliner
- **> 1 week**: tag

Skill.md output is capped at 4000 tokens (configurable).

## Usage

```bash
# Run tests
npm test

# Run the curator standalone
node src/curator.js --agent <name> --tree tree.json --transcript transcript.log --output skill.md

# The supervisor handles everything in production
./src/supervisor.sh
```

## Constraints

- Raw transcripts are append-only, never deleted
- No node is pruned until its content is absorbed into a parent summary
- Curator runs as a child of the supervisor, not the agent — it outlives individual sessions
- Agent boots fine without memory (graceful degradation)

## Project status

Active development. Core pipeline (supervisor → curator → tree → skill.md) is built and tested.

## License

See repository root.
