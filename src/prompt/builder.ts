/**
 * Prompt Builder
 * Assembles complete prompts from sections
 */

import { PromptContext, PromptSection, BuildOptions } from './types.js';
import { buildPreamble } from './sections/preamble.js';
import { buildAgentPrompt } from './sections/agent-prompt.js';
import { buildTaskContext } from './sections/task-context.js';
import { buildRearmatter } from './sections/rearmatter.js';
import { buildRoutingSection, buildDispatcherRoutingSection } from './sections/routing.js';

export class PromptBuilder {
  private context: PromptContext;
  private options: BuildOptions;

  constructor(context: PromptContext, options: BuildOptions = {}) {
    this.context = context;
    this.options = {
      includePreamble: options.includePreamble ?? true,
      includeAgentPrompt: options.includeAgentPrompt ?? true,
      includeTaskContext: options.includeTaskContext ?? true,
      includeRearmatter: options.includeRearmatter ?? true,
      includeRouting: options.includeRouting ?? (!!context.routing || !!context.dispatcherRouting),
    };
  }

  /**
   * Build the complete prompt
   */
  build(): string {
    const sections = this.buildSections();
    return this.assembleSections(sections);
  }

  /**
   * Build all enabled sections
   */
  private buildSections(): PromptSection[] {
    const sections: PromptSection[] = [];

    if (this.options.includePreamble) {
      sections.push({
        name: 'preamble',
        content: buildPreamble(this.context),
        enabled: true,
      });
    }

    if (this.options.includeAgentPrompt) {
      sections.push({
        name: 'agent-prompt',
        content: buildAgentPrompt(this.context),
        enabled: true,
      });
    }

    if (this.options.includeTaskContext && this.context.taskMessage) {
      sections.push({
        name: 'task-context',
        content: buildTaskContext(this.context),
        enabled: true,
      });
    }

    if (this.options.includeRearmatter) {
      sections.push({
        name: 'rearmatter',
        content: buildRearmatter(this.context),
        enabled: true,
      });
    }

    if (this.options.includeRouting) {
      if (this.context.dispatcherRouting) {
        const dr = this.context.dispatcherRouting;
        sections.push({
          name: 'routing',
          content: buildDispatcherRoutingSection(
            dr.sentinel, dr.validOutcomes, dr.availableAgents, dr.isTerminal, dr.peers
          ),
          enabled: true,
        });
      } else if (this.context.routing) {
        sections.push({
          name: 'routing',
          content: buildRoutingSection(this.context.routing, this.context.mesh),
          enabled: true,
        });
      }
    }

    return sections;
  }

  /**
   * Assemble sections into final prompt
   */
  private assembleSections(sections: PromptSection[]): string {
    const parts = sections
      .filter(s => s.enabled && s.content.length > 0)
      .map(s => s.content);

    return parts.join('\n\n');
  }

  /**
   * Get metadata about the built prompt
   */
  getMetadata() {
    return {
      mesh: this.context.mesh,
      agent: this.context.agent,
      model: this.context.model,
      sections: this.buildSections().map(s => s.name),
    };
  }
}
