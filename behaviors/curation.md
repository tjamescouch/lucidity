# curation

periodic process that compresses the trunk, maintains branches, and keeps the tree within the agent's attention budget.

## flow

1. curator wakes on timer (every N minutes)
2. reads transcript delta since last curation
3. creates or updates the root trunk node with current session content (full detail)
4. walks the trunk from root backward:
   - nodes older than 1 hour and still `full` -> compress to `summary`
   - nodes older than 1 day and still `summary` -> compress to `oneliner`
   - nodes older than 1 week and still `oneliner` -> compress to `tag`
5. scans for recurring topics or cross-references across trunk nodes
6. creates or updates branch nodes for significant topics, linked from trunk via @@seek@@
7. prunes orphan branch nodes (no inbound links, older than threshold)
8. regenerates skill.md from the current tree state
9. writes tree to local disk
10. syncs to persistent storage

## failure modes

- transcript unavailable: skip this curation pass, retry on next interval. log warning.
- disk write fails: retry once. if still failing, log error and continue running (tree is in memory).
- compression produces poor summary: acceptable — next curation pass can re-summarize. lossy compression is expected.
- unclean shutdown mid-curation: tree on disk may be from previous pass. acceptable data loss bounded by one interval.
