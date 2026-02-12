# memory tree

persistent memory system for long-running agents. a temporal spine with associative branches, where recent context is high-fidelity and older context progressively compresses.

## components

- [curator](components/curator.md) - child process that watches transcripts and maintains the memory tree
- [tree](components/tree.md) - the data structure: timestamped nodes organized as trunk + branches
- [store](components/store.md) - persistence layer for reading/writing the tree across sessions

## behaviors

- [curation](behaviors/curation.md) - periodic compression and link maintenance
- [boot](behaviors/boot.md) - loading memory and preparing the agent's context on startup

## constraints

see [constraints.md](constraints.md)
