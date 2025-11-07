# Self-Modify System

The self-modify system enables agents to iteratively refine their own prompts through multiple passes with fresh context.

## Overview

An agent in self-modify mode can:
1. Process a task
2. Evaluate if another iteration would be beneficial
3. Write a message to itself with a refined prompt
4. Start fresh with `/clear` (automatically done)
5. Apply a cognitive lens (optional)
6. Repeat until the task is complete

**Note:** Context is automatically cleared before each iteration to ensure fresh perspective.

## Configuration

### Mesh Config

Add `frontmatter` section to your mesh config:

```json
{
  "mesh": "evolver",
  "description": "Self-modifying agent",
  "type": "ephemeral",
  "agents": ["test/evolver"],
  "entry_point": "evolver",
  "completion_agent": "evolver",
  "frontmatter": {
    "self-modify": true,
    "max-iterations": 5
  },
  "workflow_topology": "self-referential"
}
```

### Frontmatter Options

- `self-modify: true` - Enable self-modification mode (automatically clears context before each iteration)
- `max-iterations: <number>` - Maximum iterations before forced stop

## Message Format

### Initial Task Message

```yaml
---
to: evolver/processor
from: user
type: task
self-modify: true
max-iterations: 5
---

Analyze the security of our authentication system
```

### Self-Modification Message (Iteration 2+)

```yaml
---
to: evolver/processor
from: evolver/processor
type: task
iteration: 2
lens: security-audit
confidence: 0.7
---

Focus on OAuth2 token handling:
- Token storage security
- Refresh token rotation
- Timing attacks
```

### Completion Message

```yaml
---
to: core/core
from: evolver/processor
type: task-complete
final-confidence: 0.95
iterations-used: 3
stop-reason: task-complete
---

Security analysis complete. Found 3 critical vulnerabilities...
```

## Lens Configuration

Lenses provide cognitive perspectives that agents can apply during iterations. You control which lenses are available through the mesh config's `frontmatter.lens` setting.

### Quick Start

```json
{
  "frontmatter": {
    "self-modify": true,
    "lens": true  // Enable all lenses
  }
}
```

### Configuration Modes

1. **All Lenses**: `lens: true` - Agent sees all 8 available lenses
2. **Tag Filtering**: `lens: "security"` or `lens: ["security", "performance"]` - Filter by tags
3. **Explicit List**: `lens: ["security-audit", "edge-cases"]` - Specify exact lenses
4. **Disabled**: `lens` omitted - No lenses available

See [Lens Configuration Guide](./lens-configuration.md) for complete documentation.

### Available Lenses

When enabled, agents see lenses in this format:
```
- **security-audit** (security, threat-modeling, validation, owasp)
- **edge-cases** (testing, robustness, qa, validation)
- **performance** (performance, optimization, profiling, benchmarking)
- **maintainability** (clean-code, solid, refactoring, architecture)
- **user-experience** (ux, usability, design, accessibility)
- **critical-analysis** (analysis, critique, logic, reasoning)
- **creative-exploration** (creativity, innovation, brainstorming, exploration)
- **cost-optimization** (simplicity, efficiency, minimalism, pragmatism)
```

The lens list is **automatically injected** into the agent's prompt based on your configuration. When an agent chooses a lens, the full role description is applied to provide cognitive framing.

## How It Works

### 1. Agent Receives Task with `self-modify: true`

The EventLogConsumer detects the `self-modify: true` frontmatter and:
- Automatically clears context with `/clear` for a fresh start
- Loads the mesh config to get settings
- Injects self-modification instructions from template
- Provides guidance on how to iterate

### 2. Agent Processes Task

The agent:
- Works on the current task
- Evaluates confidence in the results
- Decides if another iteration would help

### 3. Agent Writes Self-Modification Message

Using the MessageWriter:

```javascript
const { MessageWriter } = require('./lib/message-writer');

await MessageWriter.write(
  'evolver/processor',      // from
  'evolver/processor',      // to
  'task',                   // type
  generateMsgId(),          // msgId
  'Focus on edge cases...', // content
  {
    iteration: 2,
    lens: 'edge-cases',
    confidence: 0.7
  }
);
```

### 4. System Processes Self-Modification

The EventLogConsumer:
- Automatically clears context with `/clear` for fresh perspective
- Applies lens if specified
- Injects the new prompt
- Agent starts fresh iteration

### 5. Agent Signals Completion

When done, agent sends `task-complete`:

```yaml
type: task-complete
final-confidence: 0.95
iterations-used: 3
stop-reason: "task-complete"
```

## Completion Criteria

The agent should stop iterating when:

1. **Task Complete**: Confidence >= 0.95
2. **Max Iterations**: Reached the configured limit
3. **Convergence**: No meaningful improvements possible
4. **Explicit Decision**: Agent determines further iteration won't help

## Examples

### Example 1: Security Analysis with Lens Progression

```
Iteration 1: Broad security scan (no lens)
Iteration 2: Focus on authentication (lens: security-audit)
Iteration 3: Check edge cases (lens: edge-cases)
Iteration 4: Performance impact (lens: performance)
→ Complete: Comprehensive security report
```

### Example 2: Code Refactoring

```
Iteration 1: Identify code smells
Iteration 2: Apply SOLID (lens: maintainability)
Iteration 3: Optimize performance (lens: performance)
Iteration 4: Improve UX (lens: user-experience)
→ Complete: Refactored, optimized, maintainable code
```

### Example 3: Research Deep Dive

```
Iteration 1: Initial exploration
Iteration 2: Critical analysis (lens: critical-analysis)
Iteration 3: Identify gaps (lens: edge-cases)
Iteration 4: Creative solutions (lens: creative-exploration)
→ Complete: Comprehensive research document
```

## Adding Custom Lenses

Edit `meshes/prompts/lenses/index.json`:

```json
{
  "lenses": {
    "your-lens-name": {
      "role": "Description of the cognitive perspective",
      "tags": ["tag1", "tag2"]
    }
  }
}
```

## Observability

All messages are stored in `.ai/tx/msgs/`:
- Initial task message
- Each iteration's self-modification message
- Final completion message

Use `tx msg` to view the event log and trace iterations.

## Testing

Run the test suite:

```bash
node test-self-modify.js
```

Or spawn an evolver mesh manually:

```bash
tx spawn evolver
```

Then send a task with `self-modify: true` frontmatter.
