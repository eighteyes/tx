# Prompt Building System

Clean, modular system for assembling agent prompts from reusable sections.

## Quick Start

### CLI Usage

```bash
# View built prompt for an agent
tx prompt brain brain

# Include task context from a message
tx prompt brain brain --with-task <msg-id>

# Get raw prompt (no formatting)
tx prompt brain brain --raw
```

### Programmatic Usage

```typescript
import { buildMeshPrompt } from './prompt/index.js';

// Simple usage
const prompt = buildMeshPrompt(
  'brain',                           // mesh name
  'brain',                           // agent name
  'meshes/agents/brain/prompt.md',  // prompt file path
  'sonnet',                          // model
  taskMessage                        // optional task message
);

// Advanced usage with PromptBuilder
import { PromptBuilder, PromptContext } from './prompt/index.js';

const context: PromptContext = {
  mesh: 'brain',
  agent: 'brain',
  model: 'sonnet',
  agentPromptPath: 'meshes/agents/brain/prompt.md',
  taskMessage: '...',
  workspaceContext: '...',  // optional
  qualityGates: ['...'],    // optional
};

const builder = new PromptBuilder(context, {
  includePreamble: true,
  includeAgentPrompt: true,
  includeTaskContext: true,
  includeRearmatter: true,
});

const prompt = builder.build();
const metadata = builder.getMetadata();
```

## Architecture

### Section Pipeline

```
PromptContext → PromptBuilder → Sections → Assembled Prompt
                       ↓
                 [preamble]          Core identity
                 [agent-prompt]      Mesh-specific behavior
                 [task-context]      Current task (optional)
                 [rearmatter]        Quality gates
```

### Files

```
src/prompt/
├── types.ts              # Type definitions
├── builder.ts            # Main PromptBuilder class
├── index.ts              # Public API
├── sections/
│   ├── preamble.ts       # Core agent identity
│   ├── agent-prompt.ts   # Load agent-specific prompt
│   ├── task-context.ts   # Parse and format task messages
│   └── rearmatter.ts     # Quality gates and constraints
└── __tests__/
    └── builder.test.ts   # Unit tests
```

## Sections

### Preamble
- Core agent identity
- Always included (unless disabled)
- Example: "You are a Claude agent, built on Anthropic's Claude Agent SDK."

### Agent Prompt
- Loaded from mesh configuration
- Defines agent-specific behavior and capabilities
- Example: `meshes/agents/brain/prompt.md`

### Task Context
- Parses task message metadata
- Includes task body and context
- Adds response instructions
- Only included when `taskMessage` is provided

### Rearmatter
- Quality gates and validation rules
- Final instructions and constraints
- Always included (unless disabled)

## Adding New Sections

1. Create section file in `src/prompt/sections/`:

```typescript
import { PromptContext } from '../types.js';

export function buildMySection(context: PromptContext): string {
  return `## My Section\n\n${context.something}`;
}
```

2. Import and use in `builder.ts`:

```typescript
import { buildMySection } from './sections/my-section.js';

// In buildSections():
if (this.options.includeMySection) {
  sections.push({
    name: 'my-section',
    content: buildMySection(this.context),
    enabled: true,
  });
}
```

3. Add option to `BuildOptions` in `types.ts`:

```typescript
export interface BuildOptions {
  // ... existing options
  includeMySection?: boolean;
}
```

## Testing

```bash
# Run all tests
npx tsx src/prompt/__tests__/builder.test.ts

# Run with npm script
npm test
```

## Integration with Workers

In `src/worker/sdk-runner.ts`:

```typescript
import { buildMeshPrompt } from '../prompt/index.js';

// When spawning worker
const prompt = buildMeshPrompt(
  mesh,
  agent,
  agentConfig.prompt,
  agentConfig.model || 'sonnet',
  taskMessage  // from queue
);

// Use prompt with SDK
```

## Future Enhancements

- [ ] Workspace context gathering (file scanning, recent changes)
- [ ] Quality gate definitions and validation
- [ ] Prompt caching for performance
- [ ] Custom section templates per mesh
- [ ] Template variable substitution
- [ ] Prompt size tracking and metrics
- [ ] Validation and linting rules
