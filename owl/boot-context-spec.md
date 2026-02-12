# Boot Context Spec

What goes into skill.md on boot — and what doesn't.

## Principles

1. **Actionable over historical** — prioritize what helps the agent act now, not what happened in the past
2. **Identity first** — who am I, what's my role, who do I work with
3. **Active state second** — what am I working on, what's blocked, what's next
4. **Lessons third** — what have I learned that changes how I should work
5. **History last** — compressed summaries of past sessions, newest first

## Sections (in order of priority within token budget)

### 1. Identity (always included, ~200 tokens)
- Agent name and role
- Team members and their roles
- Key protocols (e.g., TASK CLAIM ACK)

### 2. Active Work (~500 tokens)
- Current task and status
- Branches in flight (name, status, what's in them)
- Blockers and dependencies
- Next actions

### 3. Learned Protocols (~300 tokens)
- Workflow rules (git flow, branch naming, PR process)
- Coordination rules (one owner per task, claim before writing)
- Infrastructure knowledge (wormhole paths, pushbot, repo URLs)

### 4. Recent Context (~1000 tokens)
- Last session summary (what happened, decisions made)
- Key conversations and outcomes
- Unresolved questions

### 5. Compressed History (~2000 tokens, fills remaining budget)
- Older session summaries (oneliner per session)
- Project milestones
- Relationship notes (who's good at what, communication patterns)

## What to Exclude

- Verbatim chat transcripts (compress to decisions + outcomes)
- Debugging details that were resolved
- Repeated information already captured in protocols
- Emotional/social chatter unless it reveals working preferences
- Tool output / raw command results

## Token Budget Allocation

Default 4000 token budget:
| Section | Tokens | Priority |
|---------|--------|----------|
| Identity | 200 | Must include |
| Active Work | 500 | Must include |
| Learned Protocols | 300 | Must include |
| Recent Context | 1000 | Should include |
| Compressed History | 2000 | Fill remaining |

If budget is tight, compress from the bottom up. Identity and Active Work are never cut.

## Format

```markdown
# Memory — [Agent Name]

## Who I Am
[identity block]

## Active Work
[current tasks, branches, blockers]

## How We Work
[protocols, workflow, coordination rules]

## Last Session
[recent context summary]

## History
[compressed older sessions, newest first]
```

## Integration Point

The curator's `emitSkillMd()` function should produce output matching this format. The file is written to `~/.claude/agentchat.skill.md` and read automatically on boot.
