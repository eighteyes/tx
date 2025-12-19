/**
 * tx prompt <mesh> <agent>
 * Display the built prompt for a mesh/agent
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import YAML from 'yaml';
import { buildMeshPrompt } from '../prompt/index.js';

interface PromptOptions {
  mesh?: string;
  agent?: string;
  withTask?: string;
  raw?: boolean;
}

export async function prompt(options: PromptOptions) {
  const meshName = options.mesh;
  let agentName = options.agent;

  // Resolve work directory and TX installation directory
  const workDir = process.env.TX_CWD || process.cwd();
  const txRoot = process.env.TX_ROOT || workDir;

  if (!meshName) {
    console.error('Usage: tx prompt <mesh> [agent] [--with-task <msg-id>] [--raw]');
    process.exit(1);
  }

  try {
    // Special case: "core" generates the core agent prompt
    if (meshName === 'core') {
      const corePrompt = generateCorePrompt(workDir, txRoot);

      if (options.raw) {
        console.log(corePrompt);
      } else {
        console.log('='.repeat(80));
        console.log(`PROMPT: core/core`);
        console.log(`Model: sonnet (dynamic)`);
        console.log(`Type: Orchestrator (generated)`);
        console.log('='.repeat(80));
        console.log();
        console.log(corePrompt);
        console.log();
        console.log('='.repeat(80));
        console.log(`Length: ${corePrompt.length} chars, ~${Math.ceil(corePrompt.length / 4)} tokens`);
        console.log('='.repeat(80));
      }
      return;
    }

    // Load mesh config - try YAML first, then JSON (legacy)
    const meshDir = join(txRoot, 'meshes', meshName);
    let meshConfigPath: string | null = null;
    let meshConfig: any;

    // Try config.yaml
    if (existsSync(join(meshDir, 'config.yaml'))) {
      meshConfigPath = join(meshDir, 'config.yaml');
      meshConfig = YAML.parse(readFileSync(meshConfigPath, 'utf-8'));
    }
    // Try config.yml
    else if (existsSync(join(meshDir, 'config.yml'))) {
      meshConfigPath = join(meshDir, 'config.yml');
      meshConfig = YAML.parse(readFileSync(meshConfigPath, 'utf-8'));
    }
    // Try config.json (legacy)
    else if (existsSync(join(meshDir, 'config.json'))) {
      meshConfigPath = join(meshDir, 'config.json');
      meshConfig = JSON.parse(readFileSync(meshConfigPath, 'utf-8'));
    }
    else {
      console.error(`Mesh config not found: ${meshName}`);
      console.error(`Tried: ${meshDir}/config.{yaml,yml,json}`);
      process.exit(1);
    }

    // If no agent specified, use entry_point from config
    if (!agentName) {
      agentName = meshConfig.entry_point || meshConfig.agents?.[0]?.name;
      if (!agentName) {
        console.error(`No agent specified and no entry_point defined in mesh config`);
        console.error(`Available agents: ${meshConfig.agents?.map((a: any) => a.name).join(', ') || 'none'}`);
        process.exit(1);
      }
      console.log(`Using entry_point agent: ${agentName}`);
    }

    // Find agent in mesh
    const agentConfig = meshConfig.agents.find((a: any) => a.name === agentName);
    if (!agentConfig) {
      console.error(`Agent '${agentName}' not found in mesh '${meshName}'`);
      console.error(`Available agents: ${meshConfig.agents.map((a: any) => a.name).join(', ')}`);
      process.exit(1);
    }

    // Load task message if specified
    let taskMessage: string | undefined;
    if (options.withTask) {
      const msgPath = join(workDir, '.ai/tx/msgs', `${options.withTask}.md`);
      try {
        taskMessage = readFileSync(msgPath, 'utf-8');
      } catch (err) {
        console.error(`Failed to load task message: ${options.withTask}`);
        console.error(`Tried: ${msgPath}`);
        process.exit(1);
      }
    }

    // Resolve prompt path relative to mesh directory
    const promptPath = resolve(meshDir, agentConfig.prompt);
    if (!existsSync(promptPath)) {
      console.error(`Prompt file not found: ${agentConfig.prompt}`);
      console.error(`Tried: ${promptPath}`);
      process.exit(1);
    }

    // Build prompt
    const builtPrompt = buildMeshPrompt(
      meshName,
      agentName,
      promptPath,
      agentConfig.model || 'sonnet',
      taskMessage
    );

    // Output
    if (options.raw) {
      // Raw output - just the prompt
      console.log(builtPrompt);
    } else {
      // Pretty output with metadata
      console.log('='.repeat(80));
      console.log(`PROMPT: ${meshName}/${agentName}`);
      console.log(`Model: ${agentConfig.model || 'sonnet'}`);
      console.log(`Prompt file: ${agentConfig.prompt}`);
      if (taskMessage) {
        console.log(`Task message: ${options.withTask}`);
      }
      console.log('='.repeat(80));
      console.log();
      console.log(builtPrompt);
      console.log();
      console.log('='.repeat(80));
      console.log(`Length: ${builtPrompt.length} chars, ~${Math.ceil(builtPrompt.length / 4)} tokens`);
      console.log('='.repeat(80));
    }

  } catch (err) {
    console.error('Error building prompt:', err);
    process.exit(1);
  }
}

/**
 * Generate core agent prompt dynamically
 */
function generateCorePrompt(workDir: string, txRoot: string): string {
  const meshesDir = join(txRoot, 'meshes');
  const msgsDir = join(workDir, '.ai/tx/msgs');
  const meshList = buildMeshList(meshesDir);

  return `# TX V4 Core Agent

You are the core agent for TX. You coordinate work by writing messages to meshes.

## CRITICAL: How Work Gets Done

When the user asks you to do something like "run tests" or "build the feature":
- DO NOT run shell commands yourself
- WRITE A TASK MESSAGE to the appropriate mesh
- The message triggers a worker agent to handle it

**"run X" = write a task message to mesh X**

## Available Meshes

${meshList}

## Available Tools

Use tools for data gathering and research. Tools are CLI commands, not meshes.

- \`tx tool search <query>\` - Search multiple sources (StackOverflow, GitHub, arXiv, Wikipedia, HackerNews)
  Use when user wants to: "search for", "find information about", "look up", "research"

- \`tx tool getwww <url>\` - Fetch and extract content from URLs with archive fallback
  Use when user wants to: "fetch this URL", "get content from", "download page", "scrape"

- \`tx tool youtube-transcript <video-id>\` - Extract YouTube video transcripts
  Use when user wants to: "get transcript", "YouTube captions", "video text"

- \`tx tool search --providers\` - List available search providers and their status
  Use when user wants to: "what sources", "available providers", "search engines"

**IMPORTANT**: Tools are for data gathering only. DO NOT write task messages to tools. Execute tools yourself when gathering information for the user.

## Message Directory: ${msgsDir}/

## How to Start Work

Write a \`task\` message to trigger a worker:

\`\`\`markdown
---
to: test/worker
from: core/core
type: task
msg-id: task-${Date.now()}
headline: Run the tests
timestamp: ${new Date().toISOString()}
---

Please run the test suite and report results.
\`\`\`

Save to: \`${msgsDir}/{timestamp}-task-core--test-worker-{id}.md\`

## CRITICAL: Slash Command Routing

When the user types a slash command pattern like \`/know:prepare\` or \`/know:add feature-name\`:

1. **IMMEDIATELY** write a task message with the \`command\` frontmatter field
2. Route to the appropriate mesh (brain handles /know:* commands)
3. The worker will execute the slash command directly

**Pattern**: \`/namespace:action [args]\` → route via \`command\` frontmatter

### Example: User says "/know:prepare"

\`\`\`markdown
---
to: brain/brain
from: core/core
type: task
command: /know:prepare
msg-id: task-${Date.now()}
headline: Execute /know:prepare
timestamp: ${new Date().toISOString()}
---

User requested: /know:prepare
\`\`\`

### Example: User says "/know:add auth-system"

\`\`\`markdown
---
to: brain/brain
from: core/core
type: task
command: /know:add auth-system
msg-id: task-${Date.now()}
headline: Execute /know:add auth-system
timestamp: ${new Date().toISOString()}
---

User requested: /know:add auth-system
\`\`\`

### Slash Command Routing Table

| Pattern | Route to | Description |
|---------|----------|-------------|
| \`/know:*\` | brain/brain | Knowledge graph commands |

**DO NOT** try to execute slash commands yourself. Always route them via the \`command\` frontmatter to the appropriate worker.

## Handling Responses

1. \`ask-human\` - Worker needs user input. Ask the user, then send \`ask-response\`
2. \`task-complete\` - Worker finished. Acknowledge to user.

## Example ask-response:

\`\`\`markdown
---
to: test/worker
from: core/core
type: ask-response
msg-id: resp-123
headline: User response
---

The user said: [their response here]
\`\`\`

You are now active. When user asks to run something, write a task message.
`;
}

/**
 * Build mesh list from available mesh configs
 */
function buildMeshList(meshesDir: string): string {
  const meshConfigs: Array<{
    mesh: string;
    description?: string;
    entry_point?: string;
    intents?: { patterns?: string[] };
  }> = [];

  if (!existsSync(meshesDir)) {
    return '- No meshes available';
  }

  const scanDir = (dir: string, depth: number = 0) => {
    if (depth > 2) return;
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir, { withFileTypes: true });

    // Check for config files in priority order: YAML > JSON
    const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
    const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

    if (yamlConfig) {
      try {
        const content = readFileSync(join(dir, yamlConfig.name), 'utf-8');
        const config = YAML.parse(content);
        meshConfigs.push(config);
      } catch {
        // Skip invalid configs
      }
    } else if (jsonConfig) {
      try {
        const content = readFileSync(join(dir, 'config.json'), 'utf-8');
        const config = JSON.parse(content);
        meshConfigs.push(config);
      } catch {
        // Skip invalid configs
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        scanDir(join(dir, entry.name), depth + 1);
      }
    }
  };

  scanDir(meshesDir);

  if (meshConfigs.length === 0) {
    return '- No meshes available';
  }

  // Format mesh list with descriptions and intents
  return meshConfigs
    .map(mesh => {
      const entryPoint = mesh.entry_point || 'worker';
      let line = `- \`${mesh.mesh}\` - ${mesh.description || 'No description'}`;

      // Add intents if present
      if (mesh.intents?.patterns && mesh.intents.patterns.length > 0) {
        const intentList = mesh.intents.patterns.map(p => `"${p}"`).join(', ');
        line += `\n  Use when user wants to: ${intentList}`;
      }

      // Add routing info
      line += `\n  Route to: \`${mesh.mesh}/${entryPoint}\``;

      return line;
    })
    .join('\n\n');
}
