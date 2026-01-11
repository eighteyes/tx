/**
 * PromptInjector - Injects context into agent prompts
 *
 * Responsibilities:
 * - Inject preamble (agent identity, tool guidance)
 * - Inject messaging protocol for inter-agent communication
 * - Inject workspace context (output files, location)
 * - Inject FSM context (state, transitions, context variables)
 */

import type { WorkspaceInfo } from './manager.ts';
import { MESSAGING_PROTOCOL } from './messaging-protocol.ts';
import type { FSMStateConfig, FSMTransitionConfig } from '../shared/types.ts';

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
  availableTransitions: FSMTransitionConfig[];
  context: Record<string, unknown>;
  gateRetries?: Record<string, number>;
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
   * Inject FSM context into a system prompt
   * Provides state awareness to ALL agents in FSM-enabled meshes
   */
  injectFSMContext(basePrompt: string, fsmContext: FSMInjectionContext): string {
    const section = this.buildFSMSection(fsmContext);
    return `${basePrompt}\n\n${section}`;
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

    // Available transitions
    if (fsmContext.availableTransitions.length > 0) {
      parts.push('\n## Available Transitions\n');
      parts.push('The following state transitions are possible from the current state:\n');

      for (const transition of fsmContext.availableTransitions) {
        parts.push(`- **${transition.from}** → **${transition.to}**`);
        parts.push(`  - Trigger: \`${transition.trigger}\``);
        if (transition.triggerAgent) {
          parts.push(`  - Triggered by: \`${transition.triggerAgent}\``);
        }
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
    parts.push('- Transitions are triggered by message types (`ask`, `task-complete`)');
    parts.push('- Gates must pass before a transition completes (auto-retry up to 3x)');
    parts.push('- Script failures are fatal and will halt the mesh');
    parts.push('- Context variables are shared across all agents in the mesh');

    return parts.join('\n');
  }
}
