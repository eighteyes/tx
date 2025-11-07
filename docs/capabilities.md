# Agent Capabilities

Agents can declare capabilities in their config to receive specialized instructions and tools.

## Config Format

Agents declare capabilities in their `config.json` file using the `capabilities` array:

```json
{
  "name": "architect",
  "runtime": "claude",
  "capabilities": ["know", "hitl", "search"]
}
```

## Available Capabilities

The following capabilities are available for agents:

- **know** - Access to spec-graph and code-graph via know CLI
  - Query and manage product architecture (spec-graph)
  - Query and manage implementation architecture (code-graph)
  - Track dependencies, build order, and completeness
  - Cross-graph linking and validation
  - Full documentation injected into agent prompt

- **hitl** - Human-in-the-loop escalation for all agents
  - Escalate questions to humans using `type: ask-human` messages
  - Get clarification on ambiguous requirements
  - Request approval for major decisions
  - Receive guidance when multiple valid approaches exist
  - Stop and wait pattern - agent blocks until human responds

- **search** - Web search integration via tx tool search
  - Search across 30+ sources (DuckDuckGo, Stack Overflow, Reddit, GitHub, arXiv, etc.)
  - Topic-based filtering (dev, docs, news, science, packages, repos)
  - Source-specific searches (stackoverflow, github, reddit, etc.)
  - SearXNG integration with fallback to individual APIs
  - Fetch and read web content with `tx tool get-www`

- **spawn** - Ability to spawn other meshes dynamically
  - Launch new mesh instances using `tx spawn [mesh-name]`
  - Coordinate multi-mesh workflows
  - Delegate specialized work to other meshes
  - Write task messages before spawning
  - Wait patiently for mesh responses

- **watch** - File monitoring and delta tracking
  - Monitor files for changes with `tx watch <file> --mesh <mesh-name>`
  - Automatic delta extraction (only new content sent)
  - Debounced processing (1s delay after changes stop)
  - Background mode for programmatic use (-d flag)
  - State persistence across restarts

## How It Works

The capability injection system follows these steps:

1. **Agent config lists capabilities** - Mesh creator adds `"capabilities": ["know"]` to agent config
2. **Prompt builder reads capabilities array** - On agent spawn, prompt builder checks config
3. **For each capability, loads markdown** - Loads `meshes/prompts/capabilities/{name}.md`
4. **Injects capability documentation into agent prompt** - Adds full capability docs to prompt
5. **Agent receives complete instructions** - Agent spawns with all capability knowledge

This happens automatically during agent spawn. The agent receives the full capability documentation as part of its initial prompt.

## Creating New Capabilities

To create a new capability that any agent can use:

1. **Create capability markdown file**
   ```bash
   # Create new capability documentation
   touch meshes/prompts/capabilities/my-capability.md
   ```

2. **Document the capability**
   - Write clear documentation in the .md file
   - Include commands, usage patterns, and examples
   - Explain what the capability enables
   - Provide best practices

3. **Add capability name to agent config**
   ```json
   {
     "capabilities": ["know", "my-capability"]
   }
   ```

4. **Capability automatically injected on spawn**
   - No code changes needed
   - Prompt builder automatically loads and injects the capability
   - Agent receives instructions on next spawn

## Examples

### Example 1: Agent with Know Capability

```json
{
  "name": "architect",
  "runtime": "claude",
  "capabilities": ["know"],
  "description": "Product architecture agent"
}
```

When this agent spawns, it will receive:
- Full know CLI reference
- Spec-graph and code-graph documentation
- Command examples and best practices
- Cross-graph query patterns

### Example 2: Agent with Multiple Capabilities

```json
{
  "name": "product-manager",
  "runtime": "claude",
  "capabilities": ["know", "hitl", "search"],
  "description": "Product management agent"
}
```

This agent receives three capabilities:
- **know** - To query and manage product architecture
- **hitl** - To ask humans for product decisions
- **search** - To research market trends and competitors

### Example 3: Agent with No Capabilities

```json
{
  "name": "simple-agent",
  "runtime": "claude",
  "description": "Simple agent with no special capabilities"
}
```

Agents without a `capabilities` array work normally - they just don't receive additional capability documentation.

## Capability Structure

Each capability markdown file should follow this structure:

```markdown
# Capability Name

Brief description of what this capability provides.

## Overview

Explain the purpose and use cases.

## Commands/Tools

Document available commands, APIs, or tools.

## Usage Examples

Show practical examples.

## Best Practices

Guidance on effective use.

## Quick Reference

Optional quick reference table or cheat sheet.
```

## Notes

- Capabilities are modular - add only what agents need
- Capability files are plain markdown - easy to create and maintain
- System automatically handles missing capabilities (logs error, continues)
- Capabilities can be shared across all meshes
- Create capabilities once, use in any agent config
