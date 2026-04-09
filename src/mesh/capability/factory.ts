/**
 * MeshFactory - Compiles capability needs into mesh files
 *
 * Takes a CapabilityNeeded object, selects prompt fragments per enum value,
 * applies a static routing topology, assembles prompt files for each agent,
 * generates config.yaml, and validates the result.
 *
 * Responsibilities:
 * - Derive agent names from domain values
 * - Assign tools to agents based on domain affinity
 * - Select and assemble prompt fragments into markdown files
 * - Generate config.yaml with routing, guardrails, and capability block
 * - Validate the generated mesh config
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { FragmentLoader, type PromptFragment } from './fragment-loader.ts';
import { validateGeneratedMesh, type ValidationResult } from './validator.ts';
import type { CapabilityNeeded, Domain, Tool } from './schema.ts';

export interface CompileResult {
  success: boolean;
  agents: string[];
  configPath: string;
  validation: ValidationResult;
  errors: string[];
}

/** Tools naturally associated with each domain. */
const DOMAIN_TOOL_AFFINITY: Record<string, string[]> = {
  'dev':         ['git', 'worktree', 'spec-graph'],
  'research':    ['web-search', 'browser'],
  'bug-finding': ['git', 'mcp-playwright'],
  'bug-fixing':  ['git', 'worktree'],
  'review':      ['git'],
  'qa':          ['git', 'mcp-playwright'],
  'knowledge':   ['spec-graph'],
  'design':      ['browser', 'mcp-playwright'],
  'narrative':   [],
  'reasoning':   [],
  'media':       [],
  'meta':        [],
};

/** Tools that grant Bash permission. */
const BASH_TOOLS = new Set(['git', 'spec-graph', 'worktree']);

/** Tools that grant web permissions. */
const WEB_TOOLS = new Set(['web-search']);

const BASE_PERMISSIONS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
const DEFAULT_MAX_TURNS = 20;
const MESSAGES_PER_AGENT = 15;

export class MeshFactory {
  private loader: FragmentLoader;

  constructor(fragmentsDir: string) {
    this.loader = new FragmentLoader(fragmentsDir);
  }

  /**
   * Compile a CapabilityNeeded into a mesh directory with config.yaml and prompt files.
   */
  compile(needed: CapabilityNeeded, outputDir: string): CompileResult {
    const errors: string[] = [];

    // 1. Derive agents from domain values
    const agentDefs = needed.domain.map(domain => ({
      name: `${domain}-agent`,
      domain,
      tools: this.resolveTools(domain, needed.tools),
    }));

    const agentNames = agentDefs.map(a => a.name);

    // 2-4. Select fragments and assemble prompts per agent
    for (let i = 0; i < agentDefs.length; i++) {
      const agent = agentDefs[i];
      const isLast = i === agentDefs.length - 1;

      const domainFragment = this.loader.get(`domain/${agent.domain}`);
      const toolFragments = agent.tools
        .map(t => this.loader.get(`tools/${t}`))
        .filter((f): f is PromptFragment => f !== null);

      // Interaction fragments go on the last agent
      const interactionFragments = isLast
        ? needed.interaction
            .map(i => this.loader.get(`interaction/${i}`))
            .filter((f): f is PromptFragment => f !== null)
        : [];

      const prompt = this.assemblePrompt(
        agent.name,
        agent.domain,
        domainFragment,
        toolFragments,
        interactionFragments,
      );

      // 8. Write prompt file
      const agentDir = path.join(outputDir, agent.name);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'prompt.md'), prompt, 'utf-8');
    }

    // 6. Build config object
    const meshName = needed.domain.join('-') + '-mesh';
    const config = this.buildConfig(meshName, agentDefs, needed);

    // 8. Write config.yaml
    const configPath = path.join(outputDir, 'config.yaml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf-8');

    // 9. Validate
    const validation = validateGeneratedMesh(config);

    return {
      success: validation.valid && errors.length === 0,
      agents: agentNames,
      configPath,
      validation,
      errors,
    };
  }

  /**
   * Resolve which tools an agent gets: intersection of domain affinity and needed tools.
   */
  private resolveTools(domain: string, neededTools: readonly string[]): string[] {
    const affinity = DOMAIN_TOOL_AFFINITY[domain] ?? [];
    const neededSet = new Set(neededTools);
    return affinity.filter(t => neededSet.has(t));
  }

  /**
   * Derive permissions array from assigned tools.
   */
  private resolvePermissions(tools: string[]): string[] {
    const perms = [...BASE_PERMISSIONS];
    const hasBash = tools.some(t => BASH_TOOLS.has(t));
    const hasWeb = tools.some(t => WEB_TOOLS.has(t));

    if (hasBash) perms.push('Bash');
    if (hasWeb) perms.push('WebSearch', 'WebFetch');

    return perms;
  }

  /**
   * Assemble a prompt markdown file from fragments.
   */
  private assemblePrompt(
    agentName: string,
    domain: string,
    domainFragment: PromptFragment | null,
    toolFragments: PromptFragment[],
    interactionFragments: PromptFragment[],
  ): string {
    const lines: string[] = [];

    // Title
    lines.push(`# ${agentName}`);
    lines.push('');

    // Comment header
    lines.push('<!--');
    lines.push(`name: ${agentName}`);
    lines.push(`description: ${domain} domain agent`);
    lines.push(`responsibilities: Execute ${domain} tasks within mesh pipeline`);
    lines.push('-->');
    lines.push('');

    if (domainFragment) {
      // Identity
      const identity = domainFragment.sections['identity'];
      if (typeof identity === 'string') {
        lines.push('## Identity');
        lines.push('');
        lines.push(identity.trim());
        lines.push('');
      }

      // Scope
      const scope = domainFragment.sections['scope-boundary'];
      if (scope && typeof scope === 'object' && !Array.isArray(scope)) {
        lines.push('## Scope');
        lines.push('');
        const scopeObj = scope as Record<string, string>;
        if (scopeObj['in-scope']) lines.push(`**In scope:** ${scopeObj['in-scope']}`);
        if (scopeObj['out-of-scope']) lines.push(`**Out of scope:** ${scopeObj['out-of-scope']}`);
        lines.push('');
      }

      // Workflow phases
      const phases = domainFragment.sections['workflow-phases'];
      if (Array.isArray(phases)) {
        lines.push('## Workflow');
        lines.push('');
        for (const phase of phases) {
          if (typeof phase === 'object' && phase !== null) {
            const p = phase as Record<string, string>;
            lines.push(`### ${p.name ?? 'phase'}`);
            if (p.description) lines.push(p.description);
            if (p.validation) lines.push(`*Validation:* ${p.validation}`);
            lines.push('');
          }
        }
      }

      // Error handling
      const errorArch = domainFragment.sections['error-architecture'];
      if (Array.isArray(errorArch)) {
        lines.push('## Error Handling');
        lines.push('');
        lines.push('| Condition | Response |');
        lines.push('|-----------|----------|');
        for (const entry of errorArch) {
          if (typeof entry === 'object' && entry !== null) {
            const e = entry as Record<string, string>;
            lines.push(`| ${e.condition ?? ''} | ${e.response ?? ''} |`);
          }
        }
        lines.push('');
      }

      // Anti-patterns
      const antiPatterns = domainFragment.sections['anti-patterns'];
      if (Array.isArray(antiPatterns)) {
        lines.push('## Anti-Patterns');
        lines.push('');
        for (const ap of antiPatterns) {
          if (typeof ap === 'string') lines.push(`- ${ap}`);
        }
        lines.push('');
      }
    }

    // Tool capabilities
    if (toolFragments.length > 0) {
      lines.push('## Capabilities');
      lines.push('');
      for (const frag of toolFragments) {
        const caps = frag.sections['capabilities'];
        if (Array.isArray(caps)) {
          for (const c of caps) {
            if (typeof c === 'string') lines.push(`- ${c}`);
          }
        }

        // Tool constraints
        const constraints = frag.sections['constraints'];
        if (Array.isArray(constraints)) {
          lines.push('');
          lines.push('**Constraints:**');
          for (const c of constraints) {
            if (typeof c === 'string') lines.push(`- ${c}`);
          }
        }

        // Tool error architecture
        const toolErrors = frag.sections['error-architecture'];
        if (Array.isArray(toolErrors)) {
          lines.push('');
          lines.push('| Condition | Response |');
          lines.push('|-----------|----------|');
          for (const entry of toolErrors) {
            if (typeof entry === 'object' && entry !== null) {
              const e = entry as Record<string, string>;
              lines.push(`| ${e.condition ?? ''} | ${e.response ?? ''} |`);
            }
          }
        }
        lines.push('');
      }
    }

    // Interaction fragments
    if (interactionFragments.length > 0) {
      for (const frag of interactionFragments) {
        const wp = frag.sections['workflow-phase'];
        if (wp && typeof wp === 'object' && !Array.isArray(wp)) {
          const phase = wp as Record<string, string>;
          lines.push(`## ${phase.name ?? 'Interaction'}`);
          lines.push('');
          if (phase.description) lines.push(phase.description);
          if (phase.position) lines.push(`*${phase.position}*`);
          lines.push('');
        }

        const outputSpec = frag.sections['output-spec'];
        if (outputSpec && typeof outputSpec === 'object' && !Array.isArray(outputSpec)) {
          const spec = outputSpec as Record<string, string>;
          for (const [key, val] of Object.entries(spec)) {
            if (typeof val === 'string') {
              lines.push(`**${key}:**`);
              lines.push(val.trim());
              lines.push('');
            }
          }
        }

        const constraints = frag.sections['constraints'];
        if (Array.isArray(constraints)) {
          lines.push('**Constraints:**');
          for (const c of constraints) {
            if (typeof c === 'string') lines.push(`- ${c}`);
          }
          lines.push('');
        }

        const antiPatterns = frag.sections['anti-patterns'];
        if (Array.isArray(antiPatterns)) {
          lines.push('**Anti-patterns:**');
          for (const ap of antiPatterns) {
            if (typeof ap === 'string') lines.push(`- ${ap}`);
          }
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Build the config object for YAML serialization.
   */
  private buildConfig(
    meshName: string,
    agentDefs: Array<{ name: string; domain: string; tools: string[] }>,
    needed: CapabilityNeeded,
  ): Record<string, unknown> {
    const agents = agentDefs.map(a => ({
      name: a.name,
      model: 'sonnet',
      prompt: `${a.name}/prompt.md`,
      permissions: {
        allowedTools: this.resolvePermissions(a.tools),
      },
    }));

    const agentNames = agentDefs.map(a => a.name);

    const guardrailAgents: Record<string, { max_turns: number }> = {};
    for (const name of agentNames) {
      guardrailAgents[name] = { max_turns: DEFAULT_MAX_TURNS };
    }

    return {
      mesh: meshName,
      type: 'ephemeral',
      auto_despawn: true,
      dev_mode: true,
      agents,
      routing_mode: 'static',
      routing: agentNames,
      guardrails: {
        max_mesh_messages: agentDefs.length * MESSAGES_PER_AGENT,
        agents: guardrailAgents,
      },
      capability: {
        domain: [...needed.domain],
        input: [...needed.input],
        output: [...needed.output],
        tools: [...needed.tools],
        interaction: [...needed.interaction],
      },
    };
  }
}
