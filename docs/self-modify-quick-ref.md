# Self-Modify Quick Reference

## Mesh Config

```json
{
  "frontmatter": {
    "self-modify": true,
    "max-iterations": 5,
    "clear-context": true,
    "lens": true  // or "tag" or ["lens1", "lens2"]
  }
}
```

## Lens Configuration

| Mode | Config | Effect |
|------|--------|--------|
| All lenses | `"lens": true` | Agent sees all 8 lenses |
| Tag filtering | `"lens": "security"` | Filter by single tag |
| Multi-tag | `"lens": ["security", "performance"]` | Filter by multiple tags |
| Explicit list | `"lens": ["security-audit", "edge-cases"]` | Specific lenses only |
| Disabled | `lens` omitted | No lenses available |

## Initial Message

```yaml
---
to: mesh/agent
from: user
type: task
self-modify: true
---

Your task description
```

## Self-Modify Message

```yaml
---
to: mesh/agent
from: mesh/agent
type: task
iteration: 2
clear-context: true
lens: security-audit
confidence: 0.7
---

Refined focus for next iteration
```

## Completion Message

```yaml
---
to: core/core
from: mesh/agent
type: task-complete
final-confidence: 0.95
iterations-used: 3
stop-reason: task-complete
---

Final results
```

## Available Lenses

| Lens | Purpose |
|------|---------|
| `security-audit` | Find vulnerabilities, think like attacker |
| `edge-cases` | Boundary conditions, failure modes |
| `performance` | Speed, memory, resource efficiency |
| `maintainability` | SOLID principles, technical debt |
| `user-experience` | Clarity, usability, delight |
| `critical-analysis` | Question assumptions, find gaps |
| `creative-exploration` | Divergent thinking, unconventional solutions |
| `cost-optimization` | Minimize complexity, simplest solution |

## Commands

```bash
# Test the system
node test-self-modify.js

# Spawn evolver mesh
tx spawn evolver

# View message log
tx msg

# View message log (follow mode)
tx msg --follow
```

## Files

- **Config**: `meshes/mesh-configs/evolver.json`
- **Lenses**: `meshes/prompts/lenses/index.json`
- **Template**: `lib/templates/self-modify.md`
- **Docs**: `docs/self-modify.md`
- **Code**: `lib/event-log-consumer.js`
