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
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '../shared/logger.ts';

export interface InjectionContext {
  workspace: WorkspaceInfo;
  taskId: string;
}

export interface PreambleContext {
  agentCount: number;  // Number of agents in the mesh
}

/**
 * FSM context for injection into agent prompts
 */
export interface FSMInjectionContext {
  meshName: string;
  currentState: string;
  stateConfig: FSMStateConfig;
  context: Record<string, unknown>;
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
You run automatically without a user watching. If you need user input, use \`ask-human\`.

# Use of Explore and Task
- Freely use Task with custom context to parallel process a lightweight, JIT agent.
- Freely use Explore for parallelized workflows, exceptional at lightweight answers and lots of Bash.`;

const PREAMBLE_MULTI_AGENT = `You are a Claude agent, built on Anthropic's Claude Agent SDK.

# Autonomous Operation
You run automatically without a user watching. If you need user input, use \`ask-human\`.

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
    return `${preamble}\n\n${basePrompt}`;
  }

  /**
   * Inject messaging protocol into a system prompt
   * Called for all mesh agents to ensure consistent message handling
   */
  injectMessagingProtocol(basePrompt: string): string {
    return `${basePrompt}\n${MESSAGING_PROTOCOL}`;
  }

  /**
   * Inject workspace context into a system prompt
   */
  injectWorkspace(basePrompt: string, context: InjectionContext): string {
    const { workspace, taskId } = context;

    // Build workspace section
    const workspaceSection = this.buildWorkspaceSection(workspace, taskId);

    // Append workspace section to base prompt
    return `${basePrompt}\n\n${workspaceSection}`;
  }

  /**
   * Build the workspace context section
   */
  private buildWorkspaceSection(workspace: WorkspaceInfo, taskId: string): string {
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
    parts.push(`Write: file_path="${workspace.dir}/filename.md"`);
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
  private buildRearmatterSection(config: any): string {
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
  private buildFSMSection(fsmContext: FSMInjectionContext): string {
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

    // Context variables
    if (Object.keys(fsmContext.context).length > 0) {
      parts.push('\n## Context Variables\n');
      for (const [key, value] of Object.entries(fsmContext.context)) {
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        parts.push(`- **${key}**: ${displayValue}`);
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
      const promptDir = join(process.cwd(), '.ai', 'tx', 'prompts', meshName);
      await mkdir(promptDir, { recursive: true });

      // Build prompt file with metadata header
      const timestamp = new Date().toISOString();
      const parts: string[] = [];

      // Metadata header
      parts.push('---');
      parts.push('metadata:');
      parts.push(`  mesh: ${meshName}`);
      parts.push(`  agent: ${agentId}`);
      parts.push(`  timestamp: ${timestamp}`);
      for (const [key, value] of Object.entries(metadata)) {
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
}
