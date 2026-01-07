/**
 * PromptInjector - Injects context into agent prompts
 *
 * Responsibilities:
 * - Inject preamble (agent identity, tool guidance)
 * - Inject messaging protocol for inter-agent communication
 * - Inject workspace context (output files, location)
 */

import type { WorkspaceInfo } from './manager.ts';
import { MESSAGING_PROTOCOL } from './messaging-protocol.ts';

export interface InjectionContext {
  workspace: WorkspaceInfo;
  taskId: string;
}

export interface PreambleContext {
  agentCount: number;  // Number of agents in the mesh
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
}
