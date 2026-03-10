/**
 * PromptInjector - Injects context into agent prompts
 *
 * Responsibilities:
 * - Inject preamble (agent identity, tool guidance)
 * - Inject messaging protocol for inter-agent communication
 * - Inject workspace context (output files, location)
 * - Inject FSM context (state, transitions, context variables)
 * - Inject subtask instructions for parallel agent coordination
 */

import type { WorkspaceInfo } from './manager.ts';
import { MESSAGING_PROTOCOL } from './messaging-protocol.ts';
import type { FSMStateConfig } from '../shared/types.ts';
import type { DispatchInjectionContext } from '../shared/types.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '../shared/logger.ts';
import type { SessionStore, SessionMetadata, FileChangeSummary } from '../session/index.ts';
import { buildRoutingSection, buildDispatcherRoutingSection } from '../prompt/sections/routing.js';
import type { RoutingConfig } from '../prompt/sections/routing.js';

export interface InjectionContext {
  workspace: WorkspaceInfo;
  taskId: string;
}

export interface ManifestFileEntry {
  id: string;
  path: string;
  description?: string;
  content?: string;  // File contents when available (reads only)
}

export interface PreambleContext {
  agentCount: number;  // Number of agents in the mesh
  meshName: string;    // Mesh this agent belongs to
  agentName: string;   // Agent name within the mesh
}

/**
 * FSM context for injection into agent prompts
 */
export interface FSMInjectionContext {
  meshName: string;
  currentState: string;
  stateConfig: FSMStateConfig;
  context: Record<string, unknown>;
  contextDescriptions?: Record<string, string>;  // Human-readable descriptions for context variables
  gateRetries?: Record<string, number>;
  availableTransitions?: string[];
}

/**
 * Context for subtask injection - DEPRECATED
 * Ensemble agents now use explicit routing instead of SUBTASK markers.
 * This interface is kept for backwards compatibility but should not be used.
 * @deprecated Use explicit routing in config.yaml instead
 */
export interface SubtaskInjectionContext {
  agentCount: number;
}

const PREAMBLE_SINGLE_AGENT = `You are a Claude agent, built on Anthropic's Claude Agent SDK.

# Autonomous Operation
You run automatically without a user watching. If you need user input, send a message to \`core/core\`.

# Use of Explore and Task
- Freely use Task with custom context to parallel process a lightweight, JIT agent.
- Freely use Explore for parallelized workflows, exceptional at lightweight answers and lots of Bash.`;

const PREAMBLE_MULTI_AGENT = `You are a Claude agent, built on Anthropic's Claude Agent SDK.

# Autonomous Operation
You run automatically without a user watching. If you need user input, send a message to \`core/core\`.

# Use of Explore
- Freely use Explore for parallelized workflows, exceptional at lightweight answers and lots of Bash.

# Multi-Agent Mesh
This mesh has multiple agents. Coordinate via message files in .ai/tx/msgs/, not the Task tool.`;

export class PromptInjector {
  /**
   * Inject preamble with tool guidance
   * Multi-agent meshes get guidance to NOT use Task tool
   */
  injectPreamble(basePrompt: string, context: PreambleContext): string {
    const preamble = context.agentCount > 1 ? PREAMBLE_MULTI_AGENT : PREAMBLE_SINGLE_AGENT;
    const identity = `\n\n# Your Address\nYou are \`${context.agentName}\` in the \`${context.meshName}\` mesh (full address: \`${context.meshName}/${context.agentName}\`).\nUse \`from: ${context.agentName}\` in your messages — the router auto-resolves it. Use full \`mesh/agent\` only for cross-mesh targets.`;
    return `${preamble}${identity}\n\n${basePrompt}`;
  }

  /**
   * Inject messaging protocol into a system prompt
   * Called for all mesh agents to ensure consistent message handling
   */
  injectMessagingProtocol(basePrompt: string): string {
    return `${basePrompt}\n${MESSAGING_PROTOCOL}`;
  }

  /**
   * Replace template tokens in prompt text with resolved values.
   *
   * Template tokens are `{key}` placeholders embedded in agent prompt text.
   * This method performs string replacement BEFORE any section injection,
   * so agents can reference dynamic paths inline (e.g., `ls {workspace}/draft.md`).
   *
   * Built-in tokens (always available when workspace context is provided):
   *   - `{workspace}` → resolved absolute workspace directory path
   *
   * Additional tokens can be supplied via the `extraTokens` map for
   * mesh-specific variables (e.g., `{game-id}`, `{campaign-id}`, `{N}`).
   *
   * Safe for all meshes — tokens that don't appear in the prompt are no-ops.
   * Unresolved tokens (no matching key) are left as-is.
   *
   * @param prompt - Raw prompt text potentially containing `{token}` placeholders
   * @param tokens - Map of token names to replacement values
   * @returns Prompt with all matching tokens replaced
   */
  replaceTemplateTokens(prompt: string, tokens: Record<string, string>): string {
    let result = prompt;
    for (const [key, value] of Object.entries(tokens)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Inject workspace context into a system prompt.
   *
   * First replaces any `{workspace}` template tokens in the prompt text
   * with the resolved workspace directory, then appends the workspace
   * context section (output files, write guidance).
   */
  injectWorkspace(basePrompt: string, context: InjectionContext): string {
    const { workspace, taskId } = context;

    // Replace {workspace} template tokens in prompt text before appending section
    const prompt = this.replaceTemplateTokens(basePrompt, {
      workspace: workspace.dir,
    });

    // Build and append workspace section
    const workspaceSection = this.buildWorkspaceSection(workspace, taskId);
    return `${prompt}\n\n${workspaceSection}`;
  }

  /**
   * Build the workspace context section
   */
  buildWorkspaceSection(workspace: WorkspaceInfo, taskId: string): string {
    const parts: string[] = [];

    parts.push('# Task Workspace\n');
    parts.push(`You have a dedicated workspace for this task at: \`${workspace.dir}\`\n`);

    if (workspace.outputFiles.size > 0) {
      parts.push('## Expected Output Files\n');
      parts.push('Please create the following files in your workspace:\n');

      for (const [filename, description] of workspace.outputFiles) {
        parts.push(`- \`${filename}\` - ${description}`);
      }

      parts.push('\n**Note**: You can create additional files as needed beyond these expected outputs.\n');
    } else {
      parts.push('You can create any files you need in this workspace.\n');
    }

    parts.push('## Writing to Workspace\n');
    parts.push('Use the Write tool with full paths to create files in your workspace:');
    parts.push('```');
    parts.push(`Write: file_path="${join(workspace.dir, 'filename.md')}"`);
    parts.push('```\n');

    return parts.join('\n');
  }

  /**
   * Extract output files summary from workspace
   */
  buildOutputSummary(workspace: WorkspaceInfo, actualFiles: string[]): string {
    const parts: string[] = [];

    parts.push('## Workspace Output Summary\n');
    parts.push(`**Task ID**: ${workspace.taskId}`);
    parts.push(`**Location**: ${workspace.dir}\n`);

    if (workspace.outputFiles.size > 0) {
      parts.push('### Expected Files\n');
      for (const [filename, description] of workspace.outputFiles) {
        const created = actualFiles.includes(filename) ? '✓' : '✗';
        parts.push(`${created} \`${filename}\` - ${description}`);
      }
      parts.push('');
    }

    const additionalFiles = actualFiles.filter(
      (f) => !workspace.outputFiles.has(f) && !f.startsWith('.')
    );

    if (additionalFiles.length > 0) {
      parts.push('### Additional Files Created\n');
      for (const filename of additionalFiles) {
        parts.push(`- \`${filename}\``);
      }
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Inject file manifest contract into a system prompt
   * Tells the agent exactly which files it reads and writes, with resolved paths
   */
  injectFileManifest(
    basePrompt: string,
    reads: ManifestFileEntry[],
    writes: ManifestFileEntry[],
  ): string {
    if (reads.length === 0 && writes.length === 0) return basePrompt;

    const parts: string[] = [];
    parts.push('# File Contract\n');

    if (writes.length > 0) {
      parts.push('**You write:**');
      parts.push('```');
      for (const f of writes) {
        parts.push(`${f.path}  # ${f.description || f.id}`);
      }
      parts.push('```');
    }
    if (reads.length > 0) {
      // Separate reads with/without content
      const withContent = reads.filter(f => f.content);
      const withoutContent = reads.filter(f => !f.content);

      if (withoutContent.length > 0) {
        parts.push('**You read:**');
        parts.push('```');
        for (const f of withoutContent) {
          parts.push(`${f.path}  # ${f.description || f.id}`);
        }
        parts.push('```');
      }

      if (withContent.length > 0) {
        parts.push('\n**Included files:**\n');
        for (const f of withContent) {
          const ext = f.id.split('.').pop() || '';
          parts.push(`### ${f.id}`);
          parts.push(`\`${f.path}\``);
          parts.push(`\`\`\`${ext}`);
          parts.push(f.content!);
          parts.push('```\n');
        }
      }
    }

    parts.push('Write ONLY the files listed above. Use exact filenames at the paths shown.');

    return `${basePrompt}\n\n${parts.join('\n')}`;
  }

  /**
   * Inject rearmatter instructions into a system prompt
   * Provides guidance on required output format and fields
   */
  injectRearmatter(basePrompt: string, rearmatterConfig: any): string {
    if (!rearmatterConfig || !rearmatterConfig.enabled) {
      return basePrompt;
    }

    const section = this.buildRearmatterSection(rearmatterConfig);
    return `${basePrompt}\n\n${section}`;
  }

  /**
   * Build the rearmatter section
   */
  buildRearmatterSection(config: any): string {
    const parts: string[] = [];

    parts.push('# Response Format (Rearmatter)\n');
    parts.push('Your response must include structured metadata at the end in YAML format.\n');

    if (config.fields && config.fields.length > 0) {
      parts.push('## Required Fields\n');
      parts.push('Include these fields in a YAML block at the end of your response:\n');
      parts.push('```yaml');
      for (const field of config.fields) {
        parts.push(`${field}: <your value>`);
      }
      parts.push('```\n');
    }

    if (config.thresholds) {
      parts.push('## Quality Thresholds\n');
      for (const [field, value] of Object.entries(config.thresholds)) {
        parts.push(`- **${field}**: Must be ${value} or higher`);
      }
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Inject parallel instance context into a system prompt
   * Provides instance awareness for parallel mesh executions
   */
  injectParallelInstanceContext(basePrompt: string, baseMesh: string, meshId: string): string {
    const section = `# Parallel Instance Context

You are running as a parallel instance of the \`${baseMesh}\` mesh.

**Instance ID**: \`${meshId}\`
**Base Mesh**: \`${baseMesh}\`

This instance is isolated from other instances of \`${baseMesh}\`. Your work is specific to this instance.`;

    return `${basePrompt}\n\n${section}`;
  }

  /**
   * Inject FSM context into a system prompt
   * Provides state awareness to ALL agents in FSM-enabled meshes
   */
  injectFSMContext(basePrompt: string, fsmContext: FSMInjectionContext): string {
    const section = this.buildFSMSection(fsmContext);
    return `${basePrompt}\n\n${section}`;
  }

  /**
   * Inject subtask instructions into a system prompt - DEPRECATED
   *
   * This method is deprecated and returns the original prompt unmodified.
   * Ensemble agents now use explicit routing instead of SUBTASK markers.
   * The subtask approach was incompatible with TX's message-based architecture.
   *
   * @deprecated Use explicit routing for ensemble agents instead
   */
  injectSubtaskInstructions(prompt: string, _config: SubtaskInjectionContext): string {
    // DEPRECATED: Subtask approach removed.
    // Ensemble agents should use explicit routing in config.yaml:
    //
    // routing:
    //   reviewer-logic:
    //     complete:
    //       synthesizer: "Logic review complete"
    //
    // See: ensemble.type: parallel in fsm.states configuration
    return prompt;
  }

  /**
   * Inject content after the preamble section of a prompt
   * Finds the first double newline after the preamble header and inserts content there
   */
  private injectAfterPreamble(prompt: string, injection: string): string {
    // Look for common preamble markers
    const preambleMarkers = [
      '# Autonomous Operation',
      '# Multi-Agent Mesh',
      '# Use of Explore',
    ];

    // Find the end of preamble section
    let insertIndex = -1;
    for (const marker of preambleMarkers) {
      const markerIndex = prompt.indexOf(marker);
      if (markerIndex !== -1) {
        // Find the next double newline after this marker
        const doubleNewline = prompt.indexOf('\n\n', markerIndex);
        if (doubleNewline !== -1 && (insertIndex === -1 || doubleNewline > insertIndex)) {
          insertIndex = doubleNewline + 2; // +2 to skip the double newline
        }
      }
    }

    // If no preamble found, prepend the injection
    if (insertIndex === -1) {
      return `${injection}\n\n${prompt}`;
    }

    // Insert after preamble
    return prompt.slice(0, insertIndex) + injection + '\n' + prompt.slice(insertIndex);
  }

  /**
   * Build the FSM context section
   */
  buildFSMSection(fsmContext: FSMInjectionContext): string {
    const parts: string[] = [];

    parts.push('# Workflow State Machine\n');
    parts.push(`This mesh uses a finite state machine (FSM) to orchestrate workflow.\n`);

    // Current state info
    parts.push('## Current State\n');
    parts.push(`**State**: \`${fsmContext.currentState}\``);
    parts.push(`**Coordinator**: \`${fsmContext.stateConfig.coordinator}\``);

    if (fsmContext.stateConfig.participants && fsmContext.stateConfig.participants.length > 0) {
      parts.push(`**Participants**: ${fsmContext.stateConfig.participants.map(p => `\`${p}\``).join(', ')}`);
    }

    // Context variables with optional descriptions
    if (Object.keys(fsmContext.context).length > 0) {
      parts.push('\n## FSM Context Variables\n');
      for (const [key, value] of Object.entries(fsmContext.context)) {
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        parts.push(`- **${key}**: ${displayValue}`);
        // Add description if available
        const description = fsmContext.contextDescriptions?.[key];
        if (description) {
          parts.push(`  _${description}_`);
        }
        parts.push('');  // Empty line for readability
      }
    }

    // Gate retries (if any)
    const activeRetries = Object.entries(fsmContext.gateRetries || {})
      .filter(([_, count]) => count > 0);

    if (activeRetries.length > 0) {
      parts.push('\n## Gate Status\n');
      parts.push('The following gates have been retried:\n');
      for (const [state, retries] of activeRetries) {
        parts.push(`- **${state}**: ${retries} retry attempt(s)`);
      }
    }

    // Guidance
    parts.push('\n## FSM Guidance\n');
    parts.push('- Transitions are determined by exit-based routing (run → when → default)');
    parts.push('- Gates must pass before a transition completes (auto-retry up to 3x)');
    parts.push('- Script failures are fatal and will halt the mesh');
    parts.push('- Context variables are shared across all agents in the mesh');

    return parts.join('\n');
  }

  /**
   * Save built prompt to .ai/tx/prompts/{mesh}/{agent}.md
   * Includes system prompt, user prompt, and metadata
   */
  async savePrompt(
    meshName: string,
    agentId: string,
    systemPrompt: string,
    userPrompt: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      // Create directory structure
      const workDir = process.env.TX_CWD || process.cwd();
      const promptDir = join(workDir, '.ai', 'tx', 'prompts', meshName);
      await mkdir(promptDir, { recursive: true });

      // Build prompt file with metadata header
      const timestamp = new Date().toISOString();
      const parts: string[] = [];

      // Metadata header (mesh, agent, timestamp are canonical — skip dupes from caller)
      const reservedKeys = new Set(['agentName', 'timestamp']);
      parts.push('---');
      parts.push('metadata:');
      parts.push(`  mesh: ${meshName}`);
      parts.push(`  agent: ${agentId}`);
      parts.push(`  timestamp: ${timestamp}`);
      for (const [key, value] of Object.entries(metadata)) {
        if (reservedKeys.has(key)) continue;
        const displayValue = typeof value === 'object'
          ? JSON.stringify(value).slice(0, 100)
          : String(value).slice(0, 100);
        parts.push(`  ${key}: ${displayValue}`);
      }
      parts.push('---\n');

      // System Prompt
      parts.push('# System Prompt\n');
      parts.push(systemPrompt);
      parts.push('\n');

      // User Prompt (if provided)
      if (userPrompt && userPrompt.trim()) {
        parts.push('# User Prompt\n');
        parts.push(userPrompt);
        parts.push('\n');
      }

      // Write to file
      const filePath = join(promptDir, `${agentId}.md`);
      await writeFile(filePath, parts.join('\n'), 'utf-8');

      log.debug('injector', 'Saved prompt', {
        mesh: meshName,
        agent: agentId,
        filePath,
        size: parts.join('\n').length,
      });
    } catch (error) {
      // Log error but don't fail - prompt saving is optional
      log.warn('injector', 'Failed to save prompt', {
        mesh: meshName,
        agent: agentId,
        error: String(error),
      });
    }
  }

  // ============================================
  // Escalation Policy Injection
  // ============================================

  private static readonly ESCALATION_POLICY = `
## Uncertainty Escalation

When you are confused, uncertain, or encounter unexpected state:
1. Do NOT guess, improvise, or re-derive data that should already exist.
2. Send a message to core/core describing what you expected vs what you found.
3. STOP processing until you receive a response.

Escalation triggers: expected state missing, conflicting instructions,
ambiguous routing, or any situation where proceeding risks overwriting
existing work.
`;

  /**
   * Inject escalation policy into a system prompt
   * Provides uncertainty handling guidance to all mesh agents
   */
  injectEscalationPolicy(basePrompt: string): string {
    return `${basePrompt}\n\n${PromptInjector.ESCALATION_POLICY}`;
  }

  // ============================================
  // Section Builders (return content, don't wrap)
  // ============================================

  /**
   * Build preamble section content (identity, tool guidance, address)
   * Returns the section string without wrapping a base prompt
   */
  buildPreambleSection(context: PreambleContext): string {
    const preamble = context.agentCount > 1 ? PREAMBLE_MULTI_AGENT : PREAMBLE_SINGLE_AGENT;
    const identity = `\n\n# Your Address\nYou are \`${context.agentName}\` in the \`${context.meshName}\` mesh (full address: \`${context.meshName}/${context.agentName}\`).\nUse \`from: ${context.agentName}\` in your messages — the router auto-resolves it. Use full \`mesh/agent\` only for cross-mesh targets.`;
    return `${preamble}${identity}`;
  }

  /**
   * Build consolidated file section: manifest contract + preloaded file contents
   * Deduplicates content that appears in both manifest reads and preloaded files
   */
  buildFileSection(
    reads: ManifestFileEntry[],
    writes: ManifestFileEntry[],
    preloadedFiles: Array<{ path: string; content: string }>,
  ): string {
    const parts: string[] = [];

    // File contract (paths only — content is in preloaded section below)
    if (reads.length > 0 || writes.length > 0) {
      parts.push('# File Contract\n');
      if (writes.length > 0) {
        parts.push('**You write:**');
        parts.push('```');
        for (const f of writes) {
          parts.push(`${f.path}  # ${f.description || f.id}`);
        }
        parts.push('```');
      }
      if (reads.length > 0) {
        parts.push('**You read:**');
        parts.push('```');
        for (const f of reads) {
          parts.push(`${f.path}  # ${f.description || f.id}`);
        }
        parts.push('```');
      }
      parts.push('Write ONLY the files listed above. Use exact filenames at the paths shown.');
    }

    // Preloaded file contents (single source of truth for all injected content)
    if (preloadedFiles.length > 0) {
      parts.push('\n# Preloaded Files\n');
      for (const { path: filePath, content } of preloadedFiles) {
        const ext = filePath.split('.').pop() || '';
        parts.push(`## ${filePath}`);
        parts.push(`\`\`\`${ext}`);
        parts.push(content);
        parts.push('```\n');
      }
    }

    return parts.join('\n');
  }

  /**
   * Build situational awareness section content
   */
  buildSituationalSection(context: SituationalContext): string {
    const parts: string[] = [];
    const hasOutgoing = context.outgoingAsks.length > 0;
    const hasIncoming = context.incomingAsks.length > 0;
    const hasTasks = context.pendingTasks.length > 0;

    if (!hasOutgoing && !hasIncoming && !hasTasks) return '';

    parts.push('# Situational Awareness\n');
    parts.push('**IMPORTANT**: Review your current obligations before proceeding.\n');

    if (hasTasks) {
      const currentTask = context.pendingTasks[0];
      parts.push('## Current Task\n');
      parts.push(`- **From**: \`${currentTask.from_agent}\``);
      if (currentTask.payload?.headline) {
        parts.push(`- **Headline**: ${currentTask.payload.headline}`);
      }
      const taskAge = this.formatAge(currentTask.created_at || Date.now());
      parts.push(`- **Queued**: ${taskAge}`);
      if (context.pendingTasks.length > 1) {
        parts.push(`\n*+${context.pendingTasks.length - 1} more task(s) queued*`);
      }
      parts.push('');
    }

    if (hasOutgoing) {
      parts.push('## Outgoing Asks (Waiting for Responses)\n');
      parts.push('You have sent asks and are waiting for responses:\n');
      for (const ask of context.outgoingAsks) {
        const age = this.formatAge(ask.created_at || Date.now());
        parts.push(`- \`${ask.msg_id}\` → **${ask.to_agent}** (${age})`);
      }
      parts.push('\n*Do NOT send completion message until these are resolved.*\n');
    }

    if (hasIncoming) {
      parts.push('## Incoming Asks (Awaiting YOUR Response)\n');
      parts.push('Other agents are waiting for your response:\n');
      for (const ask of context.incomingAsks) {
        const age = this.formatAge(ask.created_at || Date.now());
        parts.push(`- \`${ask.msg_id}\` from **${ask.from_agent}** (${age})`);
      }
      parts.push('\n**You MUST respond to these before sending task-complete.**\n');
    }

    return parts.join('\n');
  }

  /**
   * Build parallel instance section content
   */
  buildParallelInstanceSection(baseMesh: string, meshId: string): string {
    return `# Parallel Instance Context

You are running as a parallel instance of the \`${baseMesh}\` mesh.

**Instance ID**: \`${meshId}\`
**Base Mesh**: \`${baseMesh}\`

This instance is isolated from other instances of \`${baseMesh}\`. Your work is specific to this instance.`;
  }

  /**
   * Build combined messaging protocol + routing section
   * Single cohesive section at the END of the prompt
   */
  buildMessagingAndRoutingSection(config: {
    meshName: string;
    routing?: RoutingConfig;
    dispatcherRouting?: DispatchInjectionContext;
  }): string {
    const parts: string[] = [];

    // Messaging protocol (filename format, frontmatter, status)
    parts.push(MESSAGING_PROTOCOL.trim());

    // Routing destinations (appended to messaging for cohesion)
    if (config.dispatcherRouting) {
      const dr = config.dispatcherRouting;
      parts.push('');
      parts.push(buildDispatcherRoutingSection(
        dr.sentinel, dr.validOutcomes, dr.availableAgents, dr.isTerminal, dr.peers
      ));
    } else if (config.routing && Object.keys(config.routing).length > 0) {
      parts.push('');
      parts.push(buildRoutingSection(config.routing, config.meshName));
    }

    return parts.join('\n');
  }

  // ============================================
  // Session Awareness Injection
  // ============================================

  /**
   * Inject session list into a system prompt
   * Shows recent sessions for this agent so they can reference past context
   */
  injectSessionList(
    basePrompt: string,
    agentId: string,
    config: SessionAwarenessConfig,
    sessionStore: SessionStore
  ): string {
    if (!config.enabled) return basePrompt;

    const sessions = sessionStore.listSessions(agentId, config.max_sessions || 10);

    if (sessions.length === 0) return basePrompt;

    const table = this.formatSessionTable(sessions);

    return `${basePrompt}

# Recent Sessions

${table}

Reference past sessions by number: "What did we discuss in session 3?"
`;
  }

  /**
   * Format sessions as a markdown table
   */
  private formatSessionTable(sessions: SessionMetadata[]): string {
    const lines = ['| # | When | Duration | What | Files | Tags |', '|---|------|----------|------|-------|------|'];

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const when = this.formatRelativeTime(s.startedAt);
      const duration = this.formatDuration(s.durationSeconds || 0);
      const headline = s.headline || 'Untitled session';
      const fileCount = this.getFileCount(s.filesChanged);
      const tags = s.tags?.join(',') || '';

      lines.push(`| ${i + 1} | ${when} | ${duration} | ${headline} | ${fileCount} | ${tags} |`);
    }

    return lines.join('\n');
  }

  /**
   * Get file count summary for session table
   */
  private getFileCount(files?: FileChangeSummary): string {
    if (!files) return '-';
    const total = (files.created?.length || 0) +
                  (files.modified?.length || 0) +
                  (files.deleted?.length || 0);
    return total > 0 ? `${total} files` : '-';
  }

  /**
   * Format timestamp as relative time (e.g., "2h ago", "3d ago")
   */
  private formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return 'just now';
  }

  /**
   * Format duration in seconds as human-readable (e.g., "5m", "1h 30m")
   */
  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  }

  // ============================================
  // Situational Context Injection
  // ============================================

  /**
   * Inject situational context into a system prompt
   * Shows pending asks (incoming/outgoing) and queued tasks
   * so agents have full awareness when starting/resuming
   */
  injectSituationalContext(basePrompt: string, context: SituationalContext): string {
    const parts: string[] = [];
    const hasOutgoing = context.outgoingAsks.length > 0;
    const hasIncoming = context.incomingAsks.length > 0;
    const hasTasks = context.pendingTasks.length > 0;

    // Skip if nothing to inject
    if (!hasOutgoing && !hasIncoming && !hasTasks) {
      return basePrompt;
    }

    parts.push('# Situational Awareness\n');
    parts.push('**IMPORTANT**: Review your current obligations before proceeding.\n');

    // Current task (first pending task)
    if (hasTasks) {
      const currentTask = context.pendingTasks[0];
      parts.push('## Current Task\n');
      parts.push(`- **From**: \`${currentTask.from_agent}\``);
      if (currentTask.payload?.headline) {
        parts.push(`- **Headline**: ${currentTask.payload.headline}`);
      }
      const taskAge = this.formatAge(currentTask.created_at || Date.now());
      parts.push(`- **Queued**: ${taskAge}`);

      if (context.pendingTasks.length > 1) {
        parts.push(`\n*+${context.pendingTasks.length - 1} more task(s) queued*`);
      }
      parts.push('');
    }

    // Outgoing asks (waiting for responses)
    if (hasOutgoing) {
      parts.push('## Outgoing Asks (Waiting for Responses)\n');
      parts.push('You have sent asks and are waiting for responses:\n');
      for (const ask of context.outgoingAsks) {
        const age = this.formatAge(ask.created_at || Date.now());
        parts.push(`- \`${ask.msg_id}\` → **${ask.to_agent}** (${age})`);
      }
      parts.push('\n*Do NOT send completion message until these are resolved.*\n');
    }

    // Incoming asks (others waiting for YOUR response)
    if (hasIncoming) {
      parts.push('## Incoming Asks (Awaiting YOUR Response)\n');
      parts.push('Other agents are waiting for your response:\n');
      for (const ask of context.incomingAsks) {
        const age = this.formatAge(ask.created_at || Date.now());
        parts.push(`- \`${ask.msg_id}\` from **${ask.from_agent}** (${age})`);
      }
      parts.push('\n**You MUST respond to these before sending task-complete.**\n');
    }

    const section = parts.join('\n');
    return `${basePrompt}\n\n${section}`;
  }

  /**
   * Format age as human-readable (e.g., "30s ago", "5m ago")
   */
  private formatAge(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  }
}

/**
 * Situational context for agent awareness
 */
export interface SituationalContext {
  /** Asks this agent sent and is waiting for responses */
  outgoingAsks: Array<{
    msg_id: string;
    to_agent: string;
    created_at?: number;
  }>;
  /** Asks sent TO this agent that need response */
  incomingAsks: Array<{
    msg_id: string;
    from_agent: string;
    created_at?: number;
  }>;
  /** Messages queued for this agent to process */
  pendingTasks: Array<{
    from_agent: string;
    type: string;
    created_at?: number;
    payload?: { headline?: string };
  }>;
}

/**
 * Session awareness configuration from mesh config
 */
export interface SessionAwarenessConfig {
  enabled: boolean;
  max_sessions?: number;
}
