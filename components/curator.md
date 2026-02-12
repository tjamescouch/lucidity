# curator

child process that runs alongside the agent. watches the transcript, maintains the memory tree, and produces the skill.md hot index.

## state

- reference to the current tree on disk
- pointer to last-processed position in the transcript
- curation interval timer

## capabilities

- reads the agent's transcript in real-time
- creates new trunk nodes from recent conversation
- compresses older trunk nodes according to compaction rules
- creates and updates branch nodes for significant topics
- maintains @@seek@@ links between trunk and branch nodes
- detects cross-references between topics across time
- writes the skill.md view for agent consumption
- syncs the tree to persistent storage

## interfaces

exposes:
- skill.md file at a known path (~/.claude/agentchat.skill.md)
- the full tree on local disk for inspection

depends on:
- filesystem access (shared with agent process)
- the agent's transcript log
- store component for persistence

## invariants

- the curator never modifies the raw transcript — it is read-only on that data
- skill.md is always a valid, self-contained view of the tree (agent can boot from it alone)
- the curator survives agent restarts within the same container
- on unclean shutdown, the tree state is at most one curation interval behind
