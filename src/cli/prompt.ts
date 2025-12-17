/**
 * tx prompt <mesh> <agent>
 * Display the built prompt for a mesh/agent
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildMeshPrompt } from '../prompt/index.js';

interface PromptOptions {
  mesh?: string;
  agent?: string;
  withTask?: string;
  raw?: boolean;
}

export async function prompt(options: PromptOptions) {
  const meshName = options.mesh;
  const agentName = options.agent;

  if (!meshName || !agentName) {
    console.error('Usage: tx prompt <mesh> <agent> [--with-task <msg-id>] [--raw]');
    process.exit(1);
  }

  try {
    // Load mesh config
    const meshConfigPath = resolve(`meshes/configs/${meshName}.json`);
    const meshConfig = JSON.parse(readFileSync(meshConfigPath, 'utf-8'));

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
      const msgPath = resolve(`.ai/tx/msgs/${options.withTask}.md`);
      try {
        taskMessage = readFileSync(msgPath, 'utf-8');
      } catch (err) {
        console.error(`Failed to load task message: ${options.withTask}`);
        console.error(`Tried: ${msgPath}`);
        process.exit(1);
      }
    }

    // Build prompt
    const builtPrompt = buildMeshPrompt(
      meshName,
      agentName,
      agentConfig.prompt,
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
