/**
 * HeadlessRunner - Manages a persistent worker for headless REPL mode
 *
 * Responsibilities:
 * - Load mesh config and validate agent
 * - Build system prompt with MESSAGING_PROTOCOL injection
 * - Spawn and keep SdkRunner alive for stateful conversation
 * - Provide interface for sending messages
 * - Execute quality lifecycle hooks
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SystemMessageWriter } from '../core/system-message-writer.ts';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { SdkRunner, type SdkRunnerConfig, type ToolRestriction } from './sdk-runner.ts';
import { MeshValidator } from './mesh-validator.ts';
import { MessageQueue } from '../queue/index.ts';
import { PromptInjector } from '../workspace/injector.ts';
import {
  LifecycleHooks,
  QualityIterationError,
  QualityHaltError,
  QualityExhaustedError,
  type HookContext,
} from './hooks.ts';
import type { SemanticModel, FSMStateConfig } from '../shared/types.ts';
import type { McpServerConfig } from './sdk-types.ts';
import { log } from '../shared/logger.ts';
import { resolveLifecycle } from './lifecycle-utils.ts';
// Routing now handled through PromptInjector.buildMessagingAndRoutingSection
import { FSMPersistence } from '../queue/index.ts';
import type { ManifestEntry } from './mesh-validator.ts';
import type { FSMInjectionContext } from '../workspace/injector.ts';

interface AgentConfig {
  name: string;
  model: SemanticModel;
  prompt: string;
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Iteration config for quality gates
 */
interface IterationConfig {
  maxIterations?: number;  // Max re-runs on quality failure (default: 3)
  onFail?: 'loop' | 'halt';  // What to do on quality failure (default: loop)
}

interface MeshConfig {
  mesh: string;
  description?: string;
  agents: AgentConfig[];
  entry_point?: string;
  toolRestriction?: ToolRestriction;
  worktree?: boolean;  // Shorthand: true = isolated worktree + auto-commit
  iteration?: IterationConfig;  // Iteration config for quality gates
  routing?: Record<string, Record<string, Record<string, string>>>;  // agent → status → destination → reason
  manifest?: ManifestEntry[];  // File I/O manifest
  fsm?: any;  // FSM config (for context injection)
  workspace?: { path?: string; locations?: Record<string, string> };
  lifecycle?: {
    pre?: string[];
    post?: string[];
  };
  load_claude_md?: boolean;  // Load project CLAUDE.md into agent system prompt (default: true)
  _basePath?: string;
}

export interface HeadlessRunnerConfig {
  mesh: string;
  agent: string;
  workDir: string;
  msgsDir: string;
  meshesDir: string;
  frontmatter?: Record<string, string>;  // Additional frontmatter (e.g., feature, msg-id)
  txRoot?: string;  // TX installation root for script resolution via $TX_ROOT
}

export class HeadlessRunner extends EventEmitter {
  private config: HeadlessRunnerConfig;
  private queue: MessageQueue;
  private runner: SdkRunner | null = null;
  private meshConfig: MeshConfig | null = null;
  private agentConfig: AgentConfig | null = null;
  private promptInjector: PromptInjector;
  private lifecycleHooks: LifecycleHooks;
  private running = false;
  private hookContext: HookContext | null = null;

  // Iteration tracking for quality retry loop
  private currentIteration: number = 0;
  private maxIterations: number = 5;
  private onFail: 'loop' | 'halt' = 'loop';
  private currentTaskBody: string = '';
  private systemWriter?: SystemMessageWriter;

  constructor(config: HeadlessRunnerConfig, queue: MessageQueue) {
    super();
    this.config = config;
    this.queue = queue;
    this.promptInjector = new PromptInjector();
    this.lifecycleHooks = new LifecycleHooks(config.workDir, queue, config.meshesDir);
  }

  /**
   * Build environment variables to inject into agent shell.
   * TX_ROOT enables scripts to reference mesh resources via $TX_ROOT/meshes/...
   */
  private buildAgentEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    // TX_ROOT: use explicit txRoot or derive from meshesDir
    const txRoot = this.config.txRoot || path.dirname(this.config.meshesDir);
    env.TX_ROOT = txRoot;

    return env;
  }

  /**
   * Load and validate mesh/agent configuration
   */
  async initialize(): Promise<void> {
    // Load mesh config
    this.meshConfig = this.loadMeshConfig(this.config.mesh);
    if (!this.meshConfig) {
      const available = this.listAvailableMeshes();
      throw new Error(`Mesh '${this.config.mesh}' not found. Available: ${available.join(', ')}`);
    }

    // Find agent in mesh
    this.agentConfig = this.meshConfig.agents.find(a => a.name === this.config.agent) || null;
    if (!this.agentConfig) {
      const available = this.meshConfig.agents.map(a => a.name);
      throw new Error(`Agent '${this.config.agent}' not found in mesh '${this.config.mesh}'. Available: ${available.join(', ')}`);
    }

    // Initialize iteration config from mesh config
    if (this.meshConfig.iteration) {
      this.maxIterations = this.meshConfig.iteration.maxIterations || 3;
      this.onFail = this.meshConfig.iteration.onFail || 'loop';
    }

    log.info('headless-runner', 'Initialized', {
      mesh: this.config.mesh,
      agent: this.config.agent,
      model: this.agentConfig.model,
      maxIterations: this.maxIterations,
      onFail: this.onFail,
    });
  }

  /**
   * Start the worker (persistent mode)
   * @param taskBody - Optional task body for preflight analysis
   */
  async start(taskBody?: string): Promise<void> {
    if (this.running) return;
    if (!this.meshConfig || !this.agentConfig) {
      throw new Error('Runner not initialized. Call initialize() first.');
    }

    // Initialize iteration tracking for this run
    this.currentIteration = 1;
    this.currentTaskBody = taskBody || '';

    const agentId = `${this.config.mesh}/${this.config.agent}`;
    const taskId = `headless-${Date.now()}`;
    const meshInstance = `${this.config.mesh}-${Date.now()}`;

    // Create hook context (include featureName from frontmatter for worktree support)
    this.hookContext = {
      meshInstance,
      meshName: this.config.mesh,
      agentName: this.config.agent,
      workDir: this.config.workDir,
      agentId,
      taskId,
      taskBody: taskBody || '',
      featureName: this.config.frontmatter?.feature,  // For worktree:create hook
      msgsDir: this.config.msgsDir,
      qualityIteration: this.currentIteration,
      qualityMaxIterations: this.maxIterations,
      qualityOnFail: this.onFail,
    };

    // Resolve lifecycle hooks
    log.info('headless-runner', 'Resolving lifecycle hooks', {
      agentId,
      meshName: this.meshConfig.mesh,
      hasWorktree: this.meshConfig.worktree !== undefined,
      worktreeValue: this.meshConfig.worktree,
      featureName: this.hookContext.featureName,
      hasLifecycle: this.meshConfig.lifecycle !== undefined,
    });

    const lifecycle = resolveLifecycle(this.meshConfig);

    log.info('headless-runner', 'Lifecycle resolved', {
      agentId,
      hasLifecycle: !!lifecycle,
      pre: lifecycle?.pre || [],
      post: lifecycle?.post || [],
    });

    // Execute pre-hooks
    if (lifecycle?.pre && lifecycle.pre.length > 0) {
      log.info('headless-runner', 'Executing pre-hooks', {
        agentId,
        hooks: lifecycle.pre,
      });

      try {
        await this.lifecycleHooks.executePreHooks(lifecycle.pre, this.hookContext);
      } catch (error) {
        log.error('headless-runner', 'Pre-hook execution failed', {
          agentId,
          error: (error as Error).message,
        });
        throw error;
      }
    }

    // Build system prompt — section-based, mirrors dispatcher order:
    // identity+situation → files+workspace → instructions → output constraints
    const agentPromptText = this.loadPrompt();
    const promptSections: string[] = [];

    // 0. Project CLAUDE.md (loaded first so agent instructions can override)
    if (this.meshConfig.load_claude_md !== false) {
      const claudeMdContent = this.loadProjectClaudeMd();
      if (claudeMdContent) promptSections.push(claudeMdContent);
    }

    // -- Identity + situation --
    // 1. Preamble
    promptSections.push(this.promptInjector.buildPreambleSection({
      agentCount: this.meshConfig.agents.length,
      meshName: this.config.mesh,
      agentName: this.config.agent,
      txRoot: this.config.txRoot || process.env.TX_ROOT,
      allowedTools: (this.agentConfig as any)?.permissions?.allowedTools,
    }));

    // 2. FSM context
    const fsmSection = this.buildFSMSectionIfAvailable();
    if (fsmSection) promptSections.push(fsmSection);

    // -- Files + workspace --
    // 3. Workspace context
    const workspaceSection = this.buildWorkspaceSectionIfAvailable();
    if (workspaceSection) promptSections.push(workspaceSection);

    // 4. File contract + preloaded files
    if (this.meshConfig.manifest) {
      const reads: import('../workspace/index.ts').ManifestFileEntry[] = [];
      const writes: import('../workspace/index.ts').ManifestFileEntry[] = [];
      const preloadedFiles: Array<{ path: string; content: string }> = [];
      const wsLocations = this.meshConfig.workspace?.locations || {};
      const wsBase = this.meshConfig.workspace?.path || '';
      const varMap = this.resolveManifestVariables(wsLocations);

      for (const entry of this.meshConfig.manifest) {
        let locationTemplate = wsLocations[entry.location || 'workspace'] || wsBase;
        for (const [key, value] of Object.entries(varMap)) {
          locationTemplate = locationTemplate.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }
        const resolvedPath = path.join(this.config.workDir, locationTemplate, entry.id);
        const fileEntry: import('../workspace/index.ts').ManifestFileEntry = {
          id: entry.id, path: resolvedPath, description: entry.description,
        };
        if (entry.reads?.includes(this.config.agent)) {
          if (!resolvedPath.includes('{') && fs.existsSync(resolvedPath)) {
            try {
              const content = fs.readFileSync(resolvedPath, 'utf-8');
              const relativePath = path.relative(this.config.workDir, resolvedPath);
              preloadedFiles.push({ path: relativePath, content });
            } catch {}
          }
          reads.push(fileEntry);
        }
        if (entry.writes?.includes(this.config.agent)) writes.push(fileEntry);
      }
      const fileSection = this.promptInjector.buildFileSection(reads, writes, preloadedFiles);
      if (fileSection) promptSections.push(fileSection);
    }

    // -- Instructions --
    // 5. Agent prompt
    promptSections.push(agentPromptText);

    // -- Output constraints --
    // 6. Headless mode context
    let headlessSection = `## Headless Run Mode\n`;
    headlessSection += `You are in headless REPL mode. The user is interacting directly via terminal.\n`;
    headlessSection += `- Write output files to: ${this.config.workDir}\n`;
    headlessSection += `- Write response messages to: ${this.config.msgsDir}/\n`;
    promptSections.push(headlessSection);

    // 7. Messaging & routing (END)
    const agentRouting = this.meshConfig.routing?.[this.config.agent];
    promptSections.push(this.promptInjector.buildMessagingAndRoutingSection({
      meshName: this.config.mesh,
      routing: (agentRouting && Object.keys(agentRouting).length > 0) ? agentRouting : undefined,
    }));

    const systemPrompt = promptSections.filter(Boolean).join('\n\n');

    const runnerConfig: SdkRunnerConfig = {
      id: agentId,
      model: this.agentConfig.model,
      systemPrompt,
      workDir: this.config.workDir,
      msgsDir: this.config.msgsDir,
      mcpServers: this.agentConfig.mcpServers,
      toolRestriction: this.meshConfig.toolRestriction,
      env: this.buildAgentEnv(),  // Environment variables for agent shell
    };

    this.runner = new SdkRunner(runnerConfig, this.queue);
    this.running = true;

    // Wire up events
    this.runner.on('start', (data) => this.emit('start', data));
    this.runner.on('output', (data) => this.emit('output', data));
    this.runner.on('init', (data) => this.emit('init', data));

    // Use the centralized completion handler for quality retry loop
    this.runner.on('complete', async (data) => {
      await this.handleWorkerComplete(data, lifecycle);
    });

    this.runner.on('error', (data) => {
      this.emit('error', data);
      this.running = false;
    });

    // Handle usage policy errors - propagate the event so callers can react
    this.runner.on('usage-policy-error', (data) => {
      log.warn('headless-runner', 'Usage Policy error - HITL requested', {
        agentId,
        askHumanFilepath: data.askHumanFilepath,
      });
      this.emit('usage-policy-error', data);
      // Don't set running = false - let the HITL flow handle it
    });

    log.info('headless-runner', 'Starting worker', {
      agentId,
      model: this.agentConfig.model,
      iteration: this.currentIteration,
      maxIterations: this.maxIterations,
      onFail: this.onFail,
    });
    this.emit('spawn', { agentId, model: this.agentConfig.model });

    // Enqueue the task for the worker to process
    // Without this, the worker polls an empty queue and completes with no output
    if (taskBody) {
      this.queue.insert({
        from_agent: 'core/core',
        to_agent: agentId,
        payload: {
          headline: 'Headless task',
          body: taskBody,
          headless: true,  // Prevents dispatcher from picking up this message
        },
      });
      log.info('headless-runner', 'Enqueued task for worker', { agentId, bodyLength: taskBody.length });
    }

    // Run worker (async, don't await - it processes messages from queue)
    this.runner.run().catch((error) => {
      const err = error as Error & { stderr?: string; code?: number | string; exitCode?: number };
      const errorContext: Record<string, unknown> = {
        error: err.message,
        stack: err.stack?.split('\n').slice(0, 3).join(' | '),
      };
      if (err.stderr) errorContext.stderr = err.stderr.slice(0, 300);
      if (err.code !== undefined) errorContext.code = err.code;
      if (err.exitCode !== undefined) errorContext.exitCode = err.exitCode;

      log.error('headless-runner', 'Worker error', errorContext);
      this.emit('error', { id: agentId, error: err.message, stderr: err.stderr, code: err.code || err.exitCode });
      this.running = false;
    });
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    if (this.runner) {
      this.runner.kill(`headless-stop: ${this.getAgentId()} manual stop`);
      this.runner = null;
    }
    this.running = false;
    log.info('headless-runner', 'Stopped');
  }

  /**
   * Restart the worker with feedback for quality iteration
   * @param taskBodyWithFeedback - Original task body with quality feedback appended
   */
  private async restart(taskBodyWithFeedback: string): Promise<void> {
    const agentId = this.getAgentId();

    log.info('headless-runner', 'Restarting worker with feedback', {
      agentId,
      iteration: this.currentIteration,
      maxIterations: this.maxIterations,
    });

    // Stop current runner
    if (this.runner) {
      this.runner.kill(`headless-restart: ${agentId} quality iteration ${this.currentIteration}/${this.maxIterations}`);
      this.runner = null;
    }

    // Update task body for this iteration
    this.currentTaskBody = taskBodyWithFeedback;

    // Re-start with the new task body (which includes feedback)
    // Note: We don't run pre-hooks again since preflight is already done
    await this.startWorkerOnly(taskBodyWithFeedback);
  }

  /**
   * Internal method to start just the worker (skips pre-hooks)
   * Used for quality retry iterations where preflight is already complete
   */
  private async startWorkerOnly(taskBody: string): Promise<void> {
    if (!this.meshConfig || !this.agentConfig) {
      throw new Error('Runner not initialized. Call initialize() first.');
    }

    const agentId = this.getAgentId();
    const lifecycle = resolveLifecycle(this.meshConfig);

    // Update hook context with current iteration
    if (this.hookContext) {
      this.hookContext.qualityIteration = this.currentIteration;
      this.hookContext.taskBody = taskBody;
    }

    // Build system prompt — same section order as primary path:
    // identity+situation → files+workspace → instructions → output constraints
    const agentPromptText = this.loadPrompt();
    const retrySections: string[] = [];

    // -- Identity + situation --
    // 1. Preamble
    retrySections.push(this.promptInjector.buildPreambleSection({
      agentCount: this.meshConfig.agents.length,
      meshName: this.config.mesh,
      agentName: this.config.agent,
      txRoot: this.config.txRoot || process.env.TX_ROOT,
      allowedTools: (this.agentConfig as any)?.permissions?.allowedTools,
    }));

    // 2. FSM context
    const fsmSection = this.buildFSMSectionIfAvailable();
    if (fsmSection) retrySections.push(fsmSection);

    // -- Files + workspace --
    // 3. Workspace context
    const workspaceSection = this.buildWorkspaceSectionIfAvailable();
    if (workspaceSection) retrySections.push(workspaceSection);

    // 4. File contract + preloads
    if (this.meshConfig.manifest) {
      const reads: import('../workspace/index.ts').ManifestFileEntry[] = [];
      const writes: import('../workspace/index.ts').ManifestFileEntry[] = [];
      const preloadedFiles: Array<{ path: string; content: string }> = [];
      const wsLocations = this.meshConfig.workspace?.locations || {};
      const wsBase = this.meshConfig.workspace?.path || '';
      const varMap = this.resolveManifestVariables(wsLocations);

      for (const entry of this.meshConfig.manifest) {
        let locationTemplate = wsLocations[entry.location || 'workspace'] || wsBase;
        for (const [key, value] of Object.entries(varMap)) {
          locationTemplate = locationTemplate.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }
        const resolvedPath = path.join(this.config.workDir, locationTemplate, entry.id);
        const fileEntry: import('../workspace/index.ts').ManifestFileEntry = {
          id: entry.id, path: resolvedPath, description: entry.description,
        };
        if (entry.reads?.includes(this.config.agent)) {
          if (!resolvedPath.includes('{') && fs.existsSync(resolvedPath)) {
            try {
              const content = fs.readFileSync(resolvedPath, 'utf-8');
              const relativePath = path.relative(this.config.workDir, resolvedPath);
              preloadedFiles.push({ path: relativePath, content });
            } catch {}
          }
          reads.push(fileEntry);
        }
        if (entry.writes?.includes(this.config.agent)) writes.push(fileEntry);
      }
      const fileSection = this.promptInjector.buildFileSection(reads, writes, preloadedFiles);
      if (fileSection) retrySections.push(fileSection);
    }

    // -- Instructions --
    // 5. Agent prompt
    retrySections.push(agentPromptText);

    // -- Output constraints --
    // 6. Headless mode context
    let headlessSection = `## Headless Run Mode\n`;
    headlessSection += `You are in headless REPL mode. The user is interacting directly via terminal.\n`;
    headlessSection += `- Write output files to: ${this.config.workDir}\n`;
    headlessSection += `- Write response messages to: ${this.config.msgsDir}/\n`;

    if (this.currentIteration > 1) {
      headlessSection += `\n## Quality Iteration ${this.currentIteration}\n`;
      headlessSection += `This is quality iteration ${this.currentIteration} of ${this.maxIterations}.\n`;
      headlessSection += `Please review the quality feedback below and address all issues.\n`;
    }
    retrySections.push(headlessSection);

    // 7. Messaging & routing (END)
    const agentRouting = this.meshConfig.routing?.[this.config.agent];
    retrySections.push(this.promptInjector.buildMessagingAndRoutingSection({
      meshName: this.config.mesh,
      routing: (agentRouting && Object.keys(agentRouting).length > 0) ? agentRouting : undefined,
    }));

    const systemPrompt = retrySections.filter(Boolean).join('\n\n');

    const runnerConfig: SdkRunnerConfig = {
      id: agentId,
      model: this.agentConfig.model,
      systemPrompt,
      workDir: this.config.workDir,
      msgsDir: this.config.msgsDir,
      mcpServers: this.agentConfig.mcpServers,
      toolRestriction: this.meshConfig.toolRestriction,
      env: this.buildAgentEnv(),  // Environment variables for agent shell
    };

    this.runner = new SdkRunner(runnerConfig, this.queue);
    this.running = true;

    // Wire up events
    this.runner.on('start', (data) => this.emit('start', data));
    this.runner.on('output', (data) => this.emit('output', data));
    this.runner.on('init', (data) => this.emit('init', data));

    this.runner.on('complete', async (data) => {
      await this.handleWorkerComplete(data, lifecycle);
    });

    this.runner.on('error', (data) => {
      this.emit('error', data);
      this.running = false;
    });

    // Handle usage policy errors - propagate the event so callers can react
    this.runner.on('usage-policy-error', (data) => {
      log.warn('headless-runner', 'Usage Policy error during iteration - HITL requested', {
        agentId,
        iteration: this.currentIteration,
        askHumanFilepath: data.askHumanFilepath,
      });
      this.emit('usage-policy-error', data);
      // Don't set running = false - let the HITL flow handle it
    });

    log.info('headless-runner', 'Starting worker (iteration)', {
      agentId,
      model: this.agentConfig.model,
      iteration: this.currentIteration,
    });
    this.emit('spawn', { agentId, model: this.agentConfig.model, iteration: this.currentIteration });

    // Enqueue the task (with feedback) for the worker to process
    if (taskBody) {
      this.queue.insert({
        from_agent: 'core/core',
        to_agent: agentId,
        payload: {
          headline: `Quality iteration ${this.currentIteration}`,
          body: taskBody,
          headless: true,  // Prevents dispatcher from picking up this message
        },
      });
      log.info('headless-runner', 'Enqueued iteration task for worker', {
        agentId,
        iteration: this.currentIteration,
        bodyLength: taskBody.length,
      });
    }

    // Run worker (async, don't await - it processes messages from queue)
    this.runner.run().catch((error) => {
      const err = error as Error & { stderr?: string; code?: number | string; exitCode?: number };
      const errorContext: Record<string, unknown> = {
        error: err.message,
        stack: err.stack?.split('\n').slice(0, 3).join(' | '),
      };
      if (err.stderr) errorContext.stderr = err.stderr.slice(0, 300);
      if (err.code !== undefined) errorContext.code = err.code;
      if (err.exitCode !== undefined) errorContext.exitCode = err.exitCode;

      log.error('headless-runner', 'Worker error', errorContext);
      this.emit('error', { id: agentId, error: err.message, stderr: err.stderr, code: err.code || err.exitCode });
      this.running = false;
    });
  }

  /**
   * Handle worker completion - execute post-hooks and quality retry loop
   */
  private async handleWorkerComplete(
    data: { output?: string; id?: string },
    lifecycle: { pre: string[]; post: string[] } | undefined
  ): Promise<void> {
    const agentId = this.getAgentId();

    // Set worker output in hook context for quality:evaluate
    if (this.hookContext) {
      this.hookContext.workerOutput = data.output;
      this.hookContext.qualityIteration = this.currentIteration;
    }

    // Execute post-hooks
    if (lifecycle?.post && lifecycle.post.length > 0 && this.hookContext) {
      log.info('headless-runner', 'Executing post-hooks', {
        agentId,
        hooks: lifecycle.post,
        iteration: this.currentIteration,
      });

      try {
        await this.lifecycleHooks.executePostHooks(lifecycle.post, this.hookContext);

        // Quality passed if we have preflight
        if (this.hookContext.qualityPreflight) {
          this.emit('quality:pass', {
            agentId,
            taskId: this.hookContext.taskId,
            iterations: this.currentIteration,
          });
        }
      } catch (error) {
        // Handle quality iteration errors - THIS IS THE RETRY LOOP
        if (error instanceof QualityIterationError) {
          this.currentIteration++;

          log.info('headless-runner', 'Quality iteration required', {
            agentId,
            iteration: this.currentIteration,
            maxIterations: this.maxIterations,
            feedback: error.feedback,
          });

          // Check onFail setting
          if (this.onFail === 'halt') {
            log.error('headless-runner', 'Quality check failed - halting (onFail=halt)', {
              agentId,
              iteration: this.currentIteration,
            });
            log.activity('quality:halt', agentId, `HALT: Quality check failed (onFail=halt)\n   ${error.feedback?.slice(0, 100) || 'No feedback'}`);
            this.emit('quality:halt', {
              agentId,
              taskId: this.hookContext.taskId,
              feedback: error.feedback,
            });
            this.emit('error', { id: agentId, error: `Quality HALT: ${error.feedback}` });
            this.running = false;
            return;
          }

          // Check if we've exceeded max iterations
          if (this.currentIteration > this.maxIterations) {
            log.error('headless-runner', 'Max iterations reached', {
              agentId,
              iteration: this.currentIteration,
              maxIterations: this.maxIterations,
            });
            log.activity('quality:exhausted', agentId, `EXHAUSTED: Max iterations (${this.maxIterations}) reached without passing`);
            this.emit('quality:exhausted', {
              agentId,
              taskId: this.hookContext.taskId,
              iterations: this.currentIteration - 1,
            });
            // Continue with normal completion despite quality exhausted
            this.emit('complete', data);
            this.running = false;
            return;
          }

          // RETRY: Write feedback message and restart worker
          log.warn('quality', 'Quality stack RETRY', {
            agentId,
            taskId: this.hookContext.taskId,
            iteration: this.currentIteration,
            feedback: error.feedback,
          });
          log.activity('quality:retry', agentId, `RETRY: Iteration ${this.currentIteration}/${this.maxIterations}\n   ${error.feedback?.slice(0, 150) || 'No feedback'}...`);

          this.emit('quality:retry', {
            agentId,
            taskId: this.hookContext.taskId,
            iteration: this.currentIteration,
            feedback: error.feedback,
          });

          // Write feedback message to msgs dir
          await this.writeFeedbackMessage(error.feedback);
          log.activity('quality:feedback', agentId, `Feedback message written for iteration ${this.currentIteration}`);

          // Wait a moment then restart
          await new Promise(resolve => setTimeout(resolve, 500));

          // Restart with feedback appended to task
          const feedbackTask = `${this.currentTaskBody}\n\n## Quality Feedback (Iteration ${this.currentIteration})\n\n${error.feedback}`;
          await this.restart(feedbackTask);
          return;

        } else if (error instanceof QualityHaltError) {
          log.warn('headless-runner', 'Quality stack HALT', {
            agentId,
            taskId: this.hookContext.taskId,
            feedback: error.feedback,
          });
          this.emit('quality:halt', {
            agentId,
            taskId: this.hookContext.taskId,
            feedback: error.feedback,
          });
          this.emit('error', { id: agentId, error: `Quality HALT: ${error.feedback}` });
          this.running = false;
          return;

        } else if (error instanceof QualityExhaustedError) {
          log.warn('headless-runner', 'Quality stack exhausted', {
            agentId,
            taskId: this.hookContext.taskId,
            iterations: this.currentIteration,
          });
          this.emit('quality:exhausted', {
            agentId,
            taskId: this.hookContext.taskId,
            iterations: this.currentIteration,
          });
          // Continue with normal completion

        } else {
          log.error('headless-runner', 'Post-hook execution failed', {
            agentId,
            error: (error as Error).message,
          });
        }
      }
    }

    // Normal completion
    this.emit('complete', data);
    this.running = false;
  }

  /**
   * Write quality feedback message to msgs directory
   */
  private async writeFeedbackMessage(feedback: string): Promise<void> {
    if (!this.hookContext?.msgsDir) {
      log.warn('headless-runner', 'No msgsDir in context, cannot write feedback message');
      return;
    }

    const agentId = this.getAgentId();
    const body = `## Quality Stack Feedback

The previous attempt did not pass quality evaluation. Please address the following feedback and try again:

${feedback}

---

**Iteration**: ${this.currentIteration} of ${this.maxIterations}
**Action**: Review the feedback above and improve your solution.`;

    if (this.systemWriter) {
      this.systemWriter.write({
        to: agentId,
        from: 'core/core',
        headline: `Quality feedback - iteration ${this.currentIteration}`,
        body,
        extraFrontmatter: { headless: 'true' },
      });
      return;
    }

    // Fallback: direct file write
    const timestamp = Math.floor(Date.now() / 1000);
    const msgId = `quality-feedback-${this.hookContext.taskId}-${this.currentIteration}`;
    const filename = `${timestamp}-task-core--${agentId.replace('/', '-')}-${msgId}.md`;
    const filepath = path.join(this.hookContext.msgsDir, filename);

    const content = `---\nto: ${agentId}\nfrom: core/core\ntype: task\nmsg-id: ${msgId}\nheadline: Quality feedback - iteration ${this.currentIteration}\ntimestamp: ${new Date().toISOString()}\nheadless: true\n---\n\n${body}\n`;

    fs.writeFileSync(filepath, content);
    log.info('headless-runner', 'Wrote quality feedback message (fallback)', {
      agentId,
      iteration: this.currentIteration,
    });
  }

  /**
   * Check if worker is running
   */
  isAlive(): boolean {
    return this.running && this.runner !== null && this.runner.isRunning();
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return `${this.config.mesh}/${this.config.agent}`;
  }

  /**
   * Get mesh config
   */
  getMeshConfig(): MeshConfig | null {
    return this.meshConfig;
  }

  /**
   * Get available agents in mesh
   */
  getAgents(): string[] {
    return this.meshConfig?.agents.map(a => a.name) || [];
  }

  /**
   * Load project CLAUDE.md from workDir (project-level only, not ~/.claude/).
   */
  private loadProjectClaudeMd(): string | null {
    const candidates = [
      path.join(this.config.workDir, 'CLAUDE.md'),
      path.join(this.config.workDir, '.claude', 'CLAUDE.md'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const content = fs.readFileSync(candidate, 'utf-8').trim();
          if (content) return `## Project Instructions (CLAUDE.md)\n\n${content}`;
        } catch {}
      }
    }
    return null;
  }

  /**
   * Load prompt file for agent
   */
  private loadPrompt(): string {
    if (!this.meshConfig || !this.agentConfig) {
      throw new Error('Runner not initialized');
    }

    let promptPath: string | null = null;

    // Try mesh basePath first
    if (this.meshConfig._basePath) {
      const meshRelativePath = path.join(this.meshConfig._basePath, this.agentConfig.prompt);
      if (fs.existsSync(meshRelativePath)) {
        promptPath = meshRelativePath;
      }
    }

    // Fall back to workDir-relative
    if (!promptPath) {
      const workDirPath = path.join(this.config.workDir, this.agentConfig.prompt);
      if (fs.existsSync(workDirPath)) {
        promptPath = workDirPath;
      }
    }

    // Fall back to global TX_ROOT
    if (!promptPath && process.env.TX_ROOT) {
      const globalPath = path.join(process.env.TX_ROOT, this.agentConfig.prompt);
      if (fs.existsSync(globalPath)) {
        promptPath = globalPath;
      }
    }

    if (!promptPath) {
      throw new Error(`Prompt not found: ${this.agentConfig.prompt}`);
    }

    return fs.readFileSync(promptPath, 'utf-8');
  }

  /**
   * Resolve manifest template variables from session.yaml
   */
  private resolveManifestVariables(wsLocations: Record<string, string>): Record<string, string> {
    const varMap: Record<string, string> = {};
    const sessionLocation = wsLocations['session'];
    if (!sessionLocation) return varMap;

    const sessionPath = path.join(this.config.workDir, sessionLocation, 'session.yaml');
    if (!fs.existsSync(sessionPath)) return varMap;

    try {
      const session = YAML.parse(fs.readFileSync(sessionPath, 'utf-8'));
      if (!session || typeof session !== 'object') return varMap;
      if (session.game_id) { varMap['game'] = session.game_id; varMap['game-id'] = session.game_id; }
      if (session.campaign_id) { varMap['campaign-id'] = session.campaign_id; }
      if (session.turn !== undefined) { varMap['N'] = String(session.turn); }
    } catch {}

    return varMap;
  }

  // Dead code removed: injectFSMContextIfAvailable, injectWorkspaceContext
  // Replaced by buildFSMSectionIfAvailable, buildWorkspaceSectionIfAvailable

  /**
   * Build FSM section string if mesh has FSM config and persisted state
   */
  private buildFSMSectionIfAvailable(): string {
    if (!this.meshConfig?.fsm) return '';

    try {
      const persistence = new FSMPersistence(this.queue.getDb());
      persistence.initialize();
      const stateData = persistence.getState(this.config.mesh);
      if (!stateData) return '';

      const states = this.meshConfig.fsm.states;
      let stateConfig: FSMStateConfig | undefined;
      if (Array.isArray(states)) {
        stateConfig = states.find((s: any) => s.name === stateData.currentState);
      } else if (states && typeof states === 'object') {
        const raw = (states as Record<string, any>)[stateData.currentState];
        if (raw) stateConfig = { name: stateData.currentState, ...raw } as FSMStateConfig;
      }

      if (!stateConfig) return '';

      const fsmContext: FSMInjectionContext = {
        meshName: this.config.mesh,
        currentState: stateData.currentState,
        stateConfig,
        context: stateData.context || {},
        contextDescriptions: this.meshConfig.fsm.context_descriptions,
        gateRetries: stateData.gateRetries,
      };

      log.info('headless-runner', 'Built FSM section', {
        mesh: this.config.mesh,
        state: stateData.currentState,
      });
      return this.promptInjector.buildFSMSection(fsmContext);
    } catch (err) {
      log.warn('headless-runner', 'Failed to build FSM section', {
        error: (err as Error).message,
      });
      return '';
    }
  }

  /**
   * Build workspace section string if mesh has workspace config
   */
  private buildWorkspaceSectionIfAvailable(): string {
    const wsConfig = this.meshConfig?.workspace;
    if (!wsConfig?.path) return '';

    const wsDir = path.resolve(this.config.workDir, wsConfig.path);
    if (!fs.existsSync(wsDir)) {
      fs.mkdirSync(wsDir, { recursive: true });
    }

    return [
      '# Task Workspace\n',
      `You have a dedicated workspace for this task at: \`${wsDir}\`\n`,
      'You can create any files you need in this workspace.\n',
      '## Writing to Workspace\n',
      `Use the Write tool with full paths to create files in your workspace:`,
      '```',
      `Write: file_path="${wsDir}/filename.md"`,
      '```\n',
    ].join('\n');
  }

  /**
   * Load mesh config by name
   */
  private loadMeshConfig(meshName: string): MeshConfig | null {
    const meshRoots: string[] = [];

    // Project meshes
    if (fs.existsSync(this.config.meshesDir)) {
      meshRoots.push(this.config.meshesDir);
    }

    // Global TX_ROOT meshes
    if (process.env.TX_ROOT) {
      const globalMeshDir = path.join(process.env.TX_ROOT, 'meshes');
      if (fs.existsSync(globalMeshDir) && globalMeshDir !== this.config.meshesDir) {
        meshRoots.push(globalMeshDir);
      }
    }

    for (const meshRoot of meshRoots) {
      const config = this.findMeshConfig(meshRoot, meshName, 0);
      if (config) return config;
    }

    return null;
  }

  /**
   * Recursively find mesh config
   */
  private findMeshConfig(dir: string, meshName: string, depth: number): MeshConfig | null {
    if (depth > 2 || !fs.existsSync(dir)) return null;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Check for config files in this directory
    const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
    const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

    const configFile = yamlConfig || jsonConfig;
    if (configFile) {
      const configPath = path.join(dir, configFile.name);
      const config = this.parseConfigFile(configPath, dir);
      if (config && config.mesh === meshName) {
        return config;
      }
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'configs') {
        const found = this.findMeshConfig(path.join(dir, entry.name), meshName, depth + 1);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Parse config file (YAML or JSON)
   */
  private parseConfigFile(configPath: string, basePath: string): MeshConfig | null {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const isYaml = configPath.endsWith('.yaml') || configPath.endsWith('.yml');
      const rawConfig = isYaml ? YAML.parse(content) : JSON.parse(content);

      const validation = MeshValidator.validate(rawConfig, path.basename(configPath));
      if (!validation.valid) {
        log.warn('headless-runner', `Invalid mesh config: ${configPath}`, { errors: validation.errors });
        return null;
      }

      const config = validation.config as MeshConfig;
      config._basePath = basePath;
      return config;
    } catch (error) {
      log.warn('headless-runner', `Failed to parse config: ${configPath}`, { error: (error as Error).message });
      return null;
    }
  }

  /**
   * List available meshes
   */
  listAvailableMeshes(): string[] {
    const meshes: string[] = [];
    const meshRoots: string[] = [];

    if (fs.existsSync(this.config.meshesDir)) {
      meshRoots.push(this.config.meshesDir);
    }
    if (process.env.TX_ROOT) {
      const globalMeshDir = path.join(process.env.TX_ROOT, 'meshes');
      if (fs.existsSync(globalMeshDir)) {
        meshRoots.push(globalMeshDir);
      }
    }

    for (const meshRoot of meshRoots) {
      this.collectMeshNames(meshRoot, meshes, 0);
    }

    return [...new Set(meshes)];
  }

  /**
   * Collect mesh names from directory
   */
  private collectMeshNames(dir: string, meshes: string[], depth: number): void {
    if (depth > 2 || !fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
    const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

    if (yamlConfig || jsonConfig) {
      const configPath = path.join(dir, (yamlConfig || jsonConfig)!.name);
      const config = this.parseConfigFile(configPath, dir);
      if (config) {
        meshes.push(config.mesh);
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'configs') {
        this.collectMeshNames(path.join(dir, entry.name), meshes, depth + 1);
      }
    }
  }
}
