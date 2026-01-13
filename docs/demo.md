# TX Demo Guide: 10-15 Minutes (Tech Crowd)

## Pre-Demo Setup

```bash
# Start TX
tx start

# Open 3 terminal panes:
# Pane 1: tx spy (live activity monitor)
# Pane 2: command execution
# Pane 3: file viewer for showing configs/messages

# Clear old noise
rm .ai/tx/msgs/*.md 2>/dev/null
```

---

## 1. The Hook (30 seconds)

**Say**: "TX is event-driven multi-agent orchestration. Agents coordinate by writing markdown files with YAML frontmatter. No APIs, no queues—just filesystem events triggering ephemeral workers."

**Show**: `tx spy` running (empty, waiting)

---

## 2. Event-Driven Message Flow (2 mins)

```bash
# Send a simple task
echo "---
to: test/worker
from: core/core
type: task
msg-id: demo-$(date +%s)
headline: Quick test
---

Analyze the TX architecture in 3 bullet points." > .ai/tx/msgs/demo-test.md
```

**Watch `tx spy`**:
- File write detected
- Consumer picks up message
- Worker spawns
- Response written
- Worker terminates

**Say**: "File write → chokidar event → worker spawn → work → response file → worker dies. Ephemeral, event-driven, no persistent connections."

---

## 3. Multi-Agent FSM: Ralph Pipeline (5 mins) ⭐

**Show the config first**:
```bash
# Show FSM structure
cat meshes/ralph-ice-cream-2/config.yaml | grep -A 40 "^fsm:"
```

**Point out**:
- Object-style states (not arrays)
- Rearmatter extraction: `$(echo '$rearmatter' | yq '.success_signal')`
- Conditional routing: `when: condition → target`
- Iteration limits (haiku: 5, sonnet: 3, opus: 2)

**Send a task through the pipeline**:
```bash
# Via message file
echo "---
to: ralph-ice-cream-2/ralph-haiku
from: core/core
type: task
msg-id: demo-ralph-$(date +%s)
headline: Explain containers vs VMs
---

Explain the difference between containers and VMs in 100 words." > .ai/tx/msgs/demo-ralph.md
```

**Watch `tx spy`**:
- Haiku drafts (fast)
- Writes frontmatter: `success_signal: PASS`
- FSM extracts signal, routes to sonnet
- Sonnet reviews, writes `success_signal: PASS`
- FSM routes to opus
- Opus finalizes, completes

**Say**: "Three quality gates, each self-assesses and signals PASS/REFINE via frontmatter. FSM extracts the signal from markdown and routes. Agents don't manage state—the mesh does."

---

## 4. The Meta-Recursion Story (4 mins) 🔥

**This is your killer feature for a tech crowd.**

**Show the original message**:
```bash
# Find and show the meta-improvement task
cat .ai/tx/msgs/*ralph-ice-cream-ralph-haiku-meta-improve.md | head -50
```

**Say**: "We asked a mesh to improve itself using the Ralph playbook methodology."

**Show what Ralph created**:
```bash
# Show the new mesh
ls -lh meshes/ralph-ice-cream-2/

# Show invented patterns
bat meshes/ralph-ice-cream-2/config.yaml | grep -A 15 "playbook_notes:"
```

**Say**: "Ralph analyzed itself and invented two documentation patterns:
1. `playbook_notes` - design rationale embedded in config.yaml
2. `AGENTS.md` - operational guidance for runtime"

**Show AGENTS.md injection**:
```bash
# Show it auto-injects
tx prompt ralph-ice-cream-2 ralph-haiku | grep -A 10 "# Operational Guide"
```

**Say**: "We looked at Ralph's inventions and said 'these are actually good patterns.' So we:
1. Canonized both into the mesh-builder documentation
2. Implemented AGENTS.md auto-injection in the prompt pipeline
3. Added validator schema support for playbook_notes

The mesh improved itself and invented patterns we adopted system-wide. That's meta-recursion."

---

## 5. Under The Hood (2-3 mins)

Quick code dive:

```bash
# Show the injector
bat src/workspace/injector.ts -r 84:115

# Show FSM evaluator
bat src/mesh/fsm-evaluator.ts -r 1:40
```

**Point out**:
- Prompt injection pipeline order
- Bash condition evaluation in FSM
- Object vs array format normalization

**Say**: "Everything's TypeScript + SQLite + chokidar. No microservices. Worker lifecycle: spawn → process → write → die."

---

## 6. Closing Punch (30 seconds)

**Say**: "Three things make TX different:
1. **File-based events** - No APIs, just markdown + frontmatter
2. **FSM with rearmatter** - State machines extract metadata from agent output
3. **Self-improving** - Ralph invented patterns we adopted

Six months old, powers our internal tools. Questions?"

---

## Backup Demo (If Live Fails)

**Have ready**:
```bash
# Show completed message exchange
ls -lth .ai/tx/msgs/ | head -20

# Show logs
tx logs | tail -50

# Show mesh list
tx status --meshes
```

---

## Expected "Holy Shit" Moments

1. **"Wait, it's just files?"** - Simplicity of architecture
2. **"It's extracting YAML from markdown?"** - Rearmatter pattern
3. **"The mesh improved itself?"** - Meta-recursion
4. **"You adopted the AI's patterns?"** - Human/AI co-evolution

---

## Anticipated Questions

**Q: "Why not use message queues/Kafka/etc?"**
A: "Files ARE the queue. SQLite tracks processing. Simpler, fewer moving parts, easier to debug."

**Q: "What about scale?"**
A: "Ephemeral workers, not long-running. Can spawn hundreds. Haven't hit limits yet on internal workloads."

**Q: "Can meshes call external services?"**
A: "Yes, agents have full SDK capabilities—MCP servers, tools, bash. They're Claude agents with routing."

**Q: "What's the FSM written in?"**
A: "TypeScript + bash for condition evaluation. State in SQLite, scripts execute in subprocess."

---

## Demo Don'ts

- Don't apologize for "it's just files" - that's a feature
- Don't get lost in implementation details unless asked
- Don't show failures (but have recovery plan if live demo breaks)
- Don't skip the meta-recursion story - it's your hook

---

## Quick Reference: Demo Commands

```bash
# Simple task
echo "---
to: test/worker
from: core/core
type: task
msg-id: demo-$(date +%s)
headline: Quick test
---

Analyze the TX architecture in 3 bullet points." > .ai/tx/msgs/demo-test.md

# Ralph pipeline task
echo "---
to: ralph-ice-cream-2/ralph-haiku
from: core/core
type: task
msg-id: demo-ralph-$(date +%s)
headline: Explain containers vs VMs
---

Explain the difference between containers and VMs in 100 words." > .ai/tx/msgs/demo-ralph.md

# View configs
cat meshes/ralph-ice-cream-2/config.yaml | grep -A 40 "^fsm:"
cat meshes/ralph-ice-cream-2/config.yaml | grep -A 15 "playbook_notes:"

# View code
bat src/workspace/injector.ts -r 84:115
bat src/mesh/fsm-evaluator.ts -r 1:40

# View prompt
tx prompt ralph-ice-cream-2 ralph-haiku | grep -A 10 "# Operational Guide"

# Status checks
tx status --meshes
tx logs | tail -50
ls -lth .ai/tx/msgs/ | head -20
```

---

**TL;DR**: Open with event-driven files → demo Ralph FSM pipeline → tell meta-recursion story → quick code dive → questions. Technical depth beats slides. Show the engine, not the paint job.
