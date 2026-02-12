# tree

the memory data structure. a temporal spine (trunk) with associative branches, rooted at NOW.

## state

a collection of nodes forming a tree. each node has:

- `id` - unique identifier
- `created_at` - timestamp when the node was first created
- `updated_at` - timestamp of last modification
- `depth` - 0 for trunk nodes, 1+ for branch nodes
- `content` - the actual memory text (varies in detail by age)
- `links` - list of @@seek@@ pointers to other nodes (branches)
- `summary_level` - one of: `full`, `summary`, `oneliner`, `tag`

## capabilities

- represents the current session in full detail at the trunk root
- chains previous session summaries along the trunk, newest first
- branches off the trunk into topical deep-dives via @@seek@@ links
- degrades gracefully: older trunk nodes hold less detail
- fragments naturally at the far end — old nodes may be disconnected

## interfaces

exposes:
- the root node (current session, full detail) for immediate agent context
- @@seek@@ links for on-demand traversal into branches
- a flattened view (skill.md) for boot-time injection into agent context

depends on:
- curator to create, compress, and link nodes
- store to persist and retrieve the tree across sessions

## invariants

- the root node always represents the current session
- trunk nodes are ordered by recency (newest first)
- every branch node is reachable from at least one trunk node via @@seek@@ links, or is a candidate for pruning
- `summary_level` never increases (a `summary` never becomes `full` again)
- raw transcript data is never deleted — the tree is an index, not the source of truth
