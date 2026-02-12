# constraints

## token budget

- skill.md must fit within 4000 tokens by default (configurable per agent)
- if the tree exceeds this budget, the curator aggressively compresses older trunk nodes first, then prunes low-value branches

## compression thresholds (defaults, configurable)

- trunk nodes older than 1 hour: compress to summary
- trunk nodes older than 1 day: compress to oneliner
- trunk nodes older than 1 week: compress to tag

## data loss prevention

- write-before-delete: no node is pruned until its content has been absorbed into a parent summary
- raw transcripts are append-only, never modified, never deleted
- persistence sync completes before any destructive operation

## timing

- curation interval: 5 minutes (configurable)
- shutdown grace period: 10 seconds for final sync before SIGKILL

## file paths

- skill.md output: ~/.claude/agentchat.skill.md
- tree storage (local): ~/.claude/memory-tree/
- raw transcripts: ~/.claude/transcripts/

## storage

- raw transcripts are append-only, never modified, never deleted
- tree index files are JSON (one file per node, or a single tree.json — implementation decides)

## process model

- curator runs as a child process of the launch script, not of the agent
- curator must not depend on the agent process being alive (it outlives individual sessions)
- agent must not depend on the curator being alive (it can boot without memory)

## implementation notes

> the curator is an LLM call — it uses a language model to summarize and compress, not string manipulation. this is the only way to produce meaningful summaries.
