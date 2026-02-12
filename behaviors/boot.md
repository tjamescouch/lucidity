# boot

startup sequence that loads memory and prepares the agent's context.

## flow

1. container starts
2. curator process launches first
3. curator checks for local tree on disk
4. if no local tree: pull from persistent storage
5. if no persistent tree: start with empty tree (first run)
6. curator generates skill.md from tree and writes to ~/.claude/agentchat.skill.md
7. agent process starts, reads skill.md as part of its boot context
8. curator begins periodic curation loop
9. agent is live with memory loaded

## failure modes

- persistent storage unreachable on boot: start with empty tree. log warning. agent runs without historical memory but begins accumulating new memory immediately.
- skill.md write fails: agent starts without memory context. curator retries on first curation pass.
- curator crashes on boot: agent starts without memory. curator should be restarted by a process supervisor (systemd, supervisord, or shell wrapper).
- both local and remote tree corrupted: curator falls back to cold boot — re-curates from raw transcripts to rebuild the tree index. slow but recoverable as long as transcripts exist.
