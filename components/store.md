# store

persistence layer. ensures the memory tree survives container restarts.

## state

- local tree files on disk (hot)
- external persistent copy (cold) — the durable backup

## capabilities

- writes the tree to local disk on every curation pass
- syncs the tree to external persistent storage on each curation pass and on exit [not-implemented: local disk only, no external sync yet]
- loads the tree from persistent storage on boot (if local copy is missing) [not-implemented: no remote loading yet]
- loads the tree from local disk on boot (if available, preferred over remote)
- preserves raw transcripts indefinitely

## interfaces

exposes:
- load(path) - returns the tree from storage
- save(tree, path) - writes the tree to storage
- sync() - pushes local state to persistent storage

depends on:
- local filesystem for hot storage
- external storage backend for cold persistence (git, S3, mounted volume, or equivalent)

## invariants

- raw transcripts are never deleted
- the tree on persistent storage is never older than one curation interval behind the local copy (under graceful operation)
- local disk is the primary read source; external storage is the backup
- on boot, if both local and remote exist, the more recent one wins [not-implemented: no remote storage yet]
