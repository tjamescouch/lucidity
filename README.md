# lucidity

**Agent memory system — transcript curator, memory tree, and skill.md generation.**

Lucidity is the memory backbone for agents. It reads agent transcripts, builds a long-term memory tree, compresses old context, and emits a skill.md file that summarizes what the agent knows and can do.

## Purpose

Agents can't keep their entire conversation history in context forever. Lucidity solves this by:

1. **Collecting** — Watches a transcript file as an agent runs
2. **Curating** — Summarizes and organizes the transcript into a memory tree
3. **Compressing** — Folds old context into concise summaries
4. **Persisting** — Saves the tree to `.claude/memory/tree.json`
5. **Publishing** — Generates `skill.md` to tell other agents what this agent knows

## Architecture

```
Agent transcript stream
    ↓
[Transcript reader]
    ↓
Memory tree (trunk nodes, branches, leaves)
    ↓ (periodic curation passes)
[Summarizer (via LLM)]
    ↓
[Compress old branches]
    ↓
tree.json (persisted)
    ↓
[Emit skill.md]
    ↓
Published agent capabilities
```

## Memory Tree Structure

The memory tree is a hierarchical structure:

- **Trunk nodes** — Core facts, architecture decisions, critical context
- **Branches** — Related work: e.g., "Refactoring module X" with sub-nodes for each phase
- **Leaves** — Individual interactions, turn outcomes, specific decisions

When context gets full, lucidity compresses branches:
- Summarizes all leaves into a single summary node
- Collapses the branch into a smaller footprint
- Keeps references back to the original summary in tree.json

## Running the Curator

```bash
# Run the curator daemon
node src/curator.js --transcript ./transcript.txt --tree .claude/memory/tree.json

# Streaming mode (follow updates)
node src/curator.js --transcript ./transcript.txt --tree .claude/memory/tree.json --follow

# One-shot (curate once and exit)
node src/curator.js --transcript ./transcript.txt --tree .claude/memory/tree.json --once
```

## API: Tree Operations

Lucidity exposes a tree API for agents to manipulate their memory:

```javascript
const { createTree, addTrunkNode, compressNode, pruneOrphans, 
        saveTree, loadTree, emitSkillMd } = require('./tree');

const tree = createTree();

// Add a trunk node (important fact)
addTrunkNode(tree, {
  id: 'arch-decision-1',
  title: 'Switched from X to Y',
  content: '...',
  references: ['issue-123', 'pr-456']
});

// Add a branch for related work
const branch = addBranch(tree, {
  title: 'Refactoring middleware',
  parent: 'arch-decision-1'
});

// Add a leaf (specific interaction)
addLeaf(branch, {
  title: 'Completed phase 1',
  content: 'Extracted auth logic into separate module'
});

// Compress when context is full
compressNode(branch, summaryText);

// Prune unreferenced nodes
pruneOrphans(tree);

// Save and emit skill.md
saveTree(tree, '.claude/memory/tree.json');
emitSkillMd(tree, 'skill.md');
```

## Transcript Format

The curator reads a transcript file with agent turns. Each turn includes:

```
Turn 1:
User: Refactor the auth module
Agent: I'll start by examining the current structure...
Tool: read(src/auth.js)
...tool output...

Turn 2:
User: Good, keep going
Agent: Now I'll extract the JWT logic...
...
```

Lucidity tracks which turns have been curated (via `@@curated::<nodeId>@@` markers) to resume from the last point on restart.

## skill.md Generation

Lucidity generates `skill.md` describing what the agent knows:

```markdown
# Agent Skills

## Core Knowledge
- Refactored auth module (arch-decision-1)
- Designed caching strategy for API responses

## Recent Work
- Completed API integration (last 3 turns)
- Fixed race condition in middleware

## Key Decisions
- Use Redis for short-lived cache (5 min TTL)
- JWT stored in httpOnly cookies only

## References
- PR #456: Middleware refactoring
- Issue #123: Auth redesign discussion
```

Other agents can read this to understand your capabilities and avoid duplicate work.

## Configuration

Create a `.lucidityrc.json`:

```json
{
  "transcript": "./transcript.txt",
  "tree": ".claude/memory/tree.json",
  "skillFile": "./skill.md",
  "summarizer": "anthropic",
  "backend": "claude-3-sonnet-20250219",
  "compressThreshold": 5000,
  "pruneInterval": 3600000,
  "follow": true
}
```

Then just run `node src/curator.js` — it picks up the config.

## Testing

```bash
npm test                  # Run all tests
npm run test:transcript   # Test transcript reader
npm run test:integration  # Test full curator loop
```

## Memory Lifecycle

1. **Ingestion** — Curator reads new transcript lines
2. **Parsing** — Extract turns, identify tool calls, gather context
3. **Summarization** — LLM summarizes each batch of turns into memory nodes
4. **Compression** — When tree grows, fold old branches into summaries
5. **Pruning** — Remove unreferenced leaf nodes
6. **Publishing** — Emit skill.md for other agents to discover
7. **Replay** — On agent restart, load tree.json to restore full context

## Performance

- **Streaming ingestion** — Reads transcript incrementally, no full re-parse
- **Lazy summarization** — Summaries are LLM calls (batched for efficiency)
- **Efficient tree structure** — Standard graph operations (no quadratic costs)
- **Incremental skill.md** — Regenerated only when tree changes

## See Also

- [AgentChat](https://github.com/tjamescouch/agentchat) — agent communication protocol
- [Gro](https://github.com/tjamescouch/gro) — agent runtime with memory support
- [TheSystem](https://github.com/tjamescouch/thesystem) — orchestration platform using lucidity

## License

MIT
