# lucidity

**Persistent memory system for long-running AI agents.**

A temporal spine with associative branches. Recent context is high-fidelity; older context progressively compresses. Agents can work for hours, days, or longer without losing track of critical information.

## What It Does

As an agent runs, its transcript is continuously processed by the **curator** — a background process that:

1. **Ingests** new messages from the transcript
2. **Summarizes** old messages at different compression levels (full → summary → oneliner → tag)
3. **Maintains** a memory tree with temporal order and cross-references
4. **Emits** a skill.md file that the agent can load on restart

Result: The agent has access to its full conversation history, but recent context stays high-fidelity while older context compresses to save token budget.

## Components

- **Tree** — the data structure: nodes with timestamps, links, and compression levels
- **Curator** — background process that watches the transcript and maintains the tree
- **Transcript** — adapter for reading agent transcript logs
- **LLM** — integration with language models for summarization

## Usage

### Boot an Agent with Memory

```bash
# On startup, load the memory tree
node src/boot-memory.js ~/.agent-memory/tree.json
```

This sets up the tree in your agent's context before it starts listening to messages.

### Run the Curator

```bash
# Start the curator daemon
node src/curator.js \
  --transcript /path/to/agent-transcript.log \
  --tree ~/.agent-memory/tree.json \
  --skill ~/.agent-memory/skill.md
```

The curator polls the transcript, ingests new content, compresses old content, and updates the skill.md file. It respects `@@curated::` markers in the transcript to avoid re-processing.

## Data Structure

### Node

```javascript
{
  id: "abc123...",           // unique identifier
  created_at: "2024-01-01T...",
  updated_at: "2024-01-02T...",
  depth: 0,                  // 0 = trunk (root), 1+ = branches
  content: "message text",
  links: [                   // cross-references to other nodes
    { target_id: "xyz", label: "continuation" }
  ],
  summary_level: "full"      // full | summary | oneliner | tag
}
```

### Tree

```javascript
{
  nodes: { ... },            // id -> node map
  trunk: [ "id1", "id2", ... ], // trunk nodes, newest first
  version: 1
}
```

## Compression Levels

- **full** — complete original content (recent)
- **summary** — 2-3 sentence prose summary
- **oneliner** — single sentence, tag-like
- **tag** — atomic identifier or keyword

## API

See `src/tree.js` for the full API:

- `createTree()` — Initialize empty tree
- `addTrunkNode(tree, content)` — Add to the main timeline
- `addBranchNode(tree, parentId, content, label)` — Add a related context
- `compressNode(tree, nodeId, newContent, targetLevel)` — Compress a node
- `pruneOrphans(tree, maxAgeMs)` — Remove unused branches
- `getCompactionTargets(tree, thresholds)` — Find nodes to compress
- `saveTree(tree, filepath)` — Persist to disk
- `loadTree(filepath)` — Load from disk
- `emitSkillMd(tree, maxTokenEstimate)` — Generate skill.md

## Testing

```bash
npm run test
npm run test:transcript   # Just transcript tests
npm run test:integration  # Full curator integration
```

## See Also

- [product.md](product.md) — Specification
- [components/](components/) — Component specs
- [behaviors/](behaviors/) — Curation behavior specs
- [constraints.md](constraints.md) — Development constraints
