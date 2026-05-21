/**
 * tx prompt <mesh> <agent>
 * Display the built prompt for a mesh/agent, with per-section size breakdown.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import YAML from 'yaml';
import { PromptBuilder } from '../prompt/builder.js';
import { buildCorePrompt } from '../prompt/core.js';
import type { PromptContext, PromptSection } from '../prompt/types.js';

interface PromptOptions {
  mesh?: string;
  agent?: string;
  withTask?: string;
  raw?: boolean;
}

function formatBreakdown(sections: PromptSection[], total: number, label: string): string {
  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push(`SECTION BREAKDOWN: ${label}`);
  lines.push('='.repeat(80));
  lines.push('section              bytes    ~tokens   % of total');
  lines.push('-'.repeat(60));
  for (const s of sections) {
    const bytes = s.content.length;
    const tok = Math.ceil(bytes / 4);
    const pct = total > 0 ? ((bytes / total) * 100).toFixed(1) : '0.0';
    lines.push(`${s.name.padEnd(20)} ${String(bytes).padStart(6)}   ${String(tok).padStart(6)}   ${pct.padStart(5)}%`);
  }
  lines.push('-'.repeat(60));
  lines.push(`${'TOTAL'.padEnd(20)} ${String(total).padStart(6)}   ${String(Math.ceil(total / 4)).padStart(6)}`);
  lines.push('='.repeat(80));
  return lines.join('\n');
}

export async function prompt(options: PromptOptions) {
  const workDir = process.env.TX_CWD || process.cwd();
  const txRoot = process.env.TX_ROOT || workDir;

  const meshName = options.mesh;
  let agentName = options.agent;

  if (!meshName) {
    console.error('Usage: tx prompt <mesh> [agent] [--with-task <msg-id>] [--raw]');
    process.exit(1);
  }

  try {
    // Core: use the REAL builder (src/prompt/core.ts), not a CLI duplicate.
    if (meshName === 'core') {
      const meshesDir = join(txRoot, 'meshes');
      const msgsDir = join(workDir, '.ai/tx/msgs');
      const corePrompt = buildCorePrompt({ msgsDir, meshesDir });

      if (options.raw) {
        console.log(corePrompt);
        return;
      }

      console.log('='.repeat(80));
      console.log(`PROMPT: core/core`);
      console.log(`Model: sonnet (dynamic)`);
      console.log(`Type: Orchestrator (real buildCorePrompt)`);
      console.log('='.repeat(80));
      console.log();
      console.log(corePrompt);
      console.log();
      const fakeSection: PromptSection = { name: 'core (monolith)', content: corePrompt, enabled: true };
      console.log(formatBreakdown([fakeSection], corePrompt.length, 'core/core'));
      console.log('NOTE: core prompt is a single monolith — no internal sections yet.');
      return;
    }

    // Load mesh config
    const meshDir = join(txRoot, 'meshes', meshName);
    let meshConfig: any;
    if (existsSync(join(meshDir, 'config.yaml'))) {
      meshConfig = YAML.parse(readFileSync(join(meshDir, 'config.yaml'), 'utf-8'));
    } else if (existsSync(join(meshDir, 'config.yml'))) {
      meshConfig = YAML.parse(readFileSync(join(meshDir, 'config.yml'), 'utf-8'));
    } else if (existsSync(join(meshDir, 'config.json'))) {
      meshConfig = JSON.parse(readFileSync(join(meshDir, 'config.json'), 'utf-8'));
    } else {
      console.error(`Mesh config not found: ${meshName}`);
      console.error(`Tried: ${meshDir}/config.{yaml,yml,json}`);
      process.exit(1);
    }

    if (!agentName) {
      agentName = meshConfig.entry_point || meshConfig.agents?.[0]?.name;
      if (!agentName) {
        console.error(`No agent specified and no entry_point in mesh config`);
        process.exit(1);
      }
      console.log(`Using entry_point agent: ${agentName}`);
    }

    const agentConfig = meshConfig.agents?.find((a: any) => a.name === agentName);
    if (!agentConfig) {
      console.error(`Agent '${agentName}' not found in mesh '${meshName}'`);
      console.error(`Available: ${meshConfig.agents?.map((a: any) => a.name).join(', ') || 'none'}`);
      process.exit(1);
    }

    let taskMessage: string | undefined;
    if (options.withTask) {
      const msgPath = join(workDir, '.ai/tx/msgs', `${options.withTask}.md`);
      try {
        taskMessage = readFileSync(msgPath, 'utf-8');
      } catch {
        console.error(`Failed to load task message: ${options.withTask} (tried ${msgPath})`);
        process.exit(1);
      }
    }

    const promptPath = resolve(meshDir, agentConfig.prompt);
    if (!existsSync(promptPath)) {
      console.error(`Prompt file not found: ${promptPath}`);
      process.exit(1);
    }

    const context: PromptContext = {
      mesh: meshName,
      agent: agentName!,
      model: agentConfig.model || 'sonnet',
      agentPromptPath: promptPath,
      taskMessage,
      agentCount: meshConfig.agents?.length,
      // NOTE: routing/dispatcherRouting omitted — synthesized at spawn time.
      // Real spawn is ~50-200 tokens heavier than what this reports.
    };

    const builder = new PromptBuilder(context);
    const built = builder.build();
    const sections = builder.getSections();
    const total = sections.reduce((sum, s) => sum + s.content.length, 0);

    if (options.raw) {
      console.log(built);
      return;
    }

    console.log('='.repeat(80));
    console.log(`PROMPT: ${meshName}/${agentName}`);
    console.log(`Model: ${context.model}`);
    console.log(`Prompt file: ${agentConfig.prompt}`);
    if (taskMessage) console.log(`Task message: ${options.withTask}`);
    console.log('='.repeat(80));
    console.log();
    console.log(built);
    console.log();
    console.log(formatBreakdown(sections, total, `${meshName}/${agentName}`));
    console.log('NOTE: routing section excluded (synthesized at spawn). Real spawn ~50-200 tokens heavier.');
  } catch (err) {
    console.error('Error building prompt:', err);
    process.exit(1);
  }
}
