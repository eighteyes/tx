/**
 * Suggest Manifest Post-Hook
 *
 * Responsibilities:
 * - Read guardrail violation logs from v4.jsonl for current mesh run
 * - Skip silently when no violations found
 * - Spawn haiku agent to analyze violations against current manifest
 * - Write manifest change suggestions to core/core
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';

const COMPONENT = 'hooks:suggest-manifest';

const VIOLATION_SOURCES = [
  'guardrail:write-gate',
  'guardrail:read-gate',
  'guardrail:routing-error',
];

const HAIKU_SYSTEM_PROMPT = `Given guardrail violations and current manifest, suggest specific manifest changes. Output YAML diff only. No explanations.

Format:
\`\`\`yaml
# additions to reads:
reads:
  - path/to/add

# additions to writes:
writes:
  - path/to/add
\`\`\``;

interface ViolationEntry {
  timestamp: string;
  event: string;
  agentId: string;
  content: string;
  [key: string]: unknown;
}

/**
 * Read activity log and filter to guardrail violations for this agent
 */
async function readViolations(workDir: string, agentId: string): Promise<ViolationEntry[]> {
  const activityFile = path.join(workDir, '.ai', 'tx', 'logs', 'activity.jsonl');

  if (!fs.existsSync(activityFile)) return [];

  const violations: ViolationEntry[] = [];
  const stream = fs.createReadStream(activityFile, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as ViolationEntry;
      if (
        VIOLATION_SOURCES.includes(entry.event) &&
        entry.agentId === agentId
      ) {
        violations.push(entry);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return violations;
}

/**
 * Load current manifest from mesh config
 */
function loadManifest(meshesDir: string, meshName: string, agentName: string): string {
  const configPath = path.join(meshesDir, meshName, 'config.yaml');
  if (!fs.existsSync(configPath)) return '(no config found)';

  const content = fs.readFileSync(configPath, 'utf-8');

  // Extract the agent's manifest section (best-effort text extraction)
  const agentPattern = new RegExp(`${agentName}:[\\s\\S]*?manifest:[\\s\\S]*?(?=\\n\\s{2}\\w|$)`, 'm');
  const match = content.match(agentPattern);
  return match ? match[0] : content;
}

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const {
    meshInstance,
    meshName,
    agentName,
    agentId,
    workDir: contextWorkDir,
    msgsDir: contextMsgsDir,
  } = context;

  const workDir = contextWorkDir || utils.workDir;
  const msgsDir = contextMsgsDir || path.join(workDir, '.ai', 'tx', 'msgs');
  const fullAgentId = agentId || `${meshName}/${agentName}`;

  // 1. Read violations
  const violations = await readViolations(workDir, fullAgentId);

  if (violations.length === 0) {
    log.debug(COMPONENT, 'No guardrail violations found, skipping', {
      meshInstance,
      agentId: fullAgentId,
    });
    return;
  }

  log.info(COMPONENT, `Found ${violations.length} guardrail violations`, {
    meshInstance,
    agentId: fullAgentId,
  });

  // 2. Load current manifest
  const manifest = loadManifest(utils.meshesDir, meshName, agentName);

  // 3. Build haiku prompt
  const violationSummary = violations
    .map(v => `- [${v.event}] ${v.content}`)
    .join('\n');

  const userPrompt = `## Current Manifest
\`\`\`
${manifest}
\`\`\`

## Guardrail Violations (${violations.length})
${violationSummary}`;

  // 4. Spawn haiku for analysis
  try {
    let suggestion = '';

    const q = query({
      prompt: userPrompt,
      options: {
        model: 'haiku',
        systemPrompt: HAIKU_SYSTEM_PROMPT,
        cwd: workDir,
        permissionMode: 'dontAsk',
        allowedTools: [],  // No tools needed for manifest suggestion
        maxTurns: 1,
        tools: [],
      },
    });

    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const content = msg.message.content;
        if (typeof content === 'string') {
          suggestion = content;
        } else if (Array.isArray(content)) {
          const textBlocks = content.filter((b: unknown) => (b as { type: string }).type === 'text');
          suggestion = textBlocks.map((b: unknown) => (b as { text: string }).text).join('\n');
        }
      }
    }

    if (!suggestion) suggestion = '(no suggestion generated)';

    // 5. Write suggestion message to core/core
    const body = `## Manifest Suggestions — ${meshName}/${agentName}

${violations.length} guardrail violations detected during this run.

### Suggested Changes
${suggestion}

### Violations Summary
${violationSummary}`;

    if (context.systemWriter) {
      context.systemWriter.write({
        to: 'core/core',
        from: 'hooks/suggest-manifest',
        headline: `Manifest suggestions - ${meshName}/${agentName}`,
        body,
      });
    } else {
      const timestamp = Math.floor(Date.now() / 1000);
      const msgId = `suggest-manifest-${meshInstance}`;
      const filename = `${timestamp}-update-hooks-suggest-manifest--core-core-${msgId}.md`;
      const filepath = path.join(msgsDir, filename);
      const content = `---\nto: core/core\nfrom: hooks/suggest-manifest\ntype: update\nmsg-id: ${msgId}\n---\n\n${body}\n`;
      fs.writeFileSync(filepath, content);
    }

    log.info(COMPONENT, 'Manifest suggestion written', {
      meshInstance,
      agentId: fullAgentId,
      violationCount: violations.length,
    });
  } catch (error) {
    log.error(COMPONENT, 'Haiku analysis failed', {
      meshInstance,
      agentId: fullAgentId,
      error: (error as Error).message,
    });
  }
};

export const suggestManifestHook: HookDefinition = {
  name: 'suggest-manifest',
  phase: 'post',
  priority: 95,
  description: 'Analyze guardrail violations and suggest manifest changes via haiku',
  handler,
};
