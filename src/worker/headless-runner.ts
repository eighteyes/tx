/**
 * HeadlessRunner - Manages a persistent worker for headless REPL mode
 *
 * Responsibilities:
 * - Load mesh config and validate agent
 * - Build system prompt with MESSAGING_PROTOCOL injection
 * - Spawn and keep SdkRunner alive for stateful conversation
 * - Provide interface for sending messages
 * - Execute quality lifecycle hooks if mesh is graded
 */

import fs from 'node:fs';
import path from 'node:path';
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
import type { SemanticModel } from '../shared/types.ts';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import { type GradedConfig, type GateType } from '../quality/index.ts';

interface AgentConfig {
  name: string;
  model: SemanticModel;
  prompt: string;
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Iteration config for graded meshes
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
  graded?: GradedConfig;  // Quality stack config: true, false, or array of gate types
  iteration?: IterationConfig;  // Iteration config for graded meshes
  lifecycle?: {
    pre?: string[];
    post?: string[];
  };
  _basePath?: string;
}

export interface HeadlessRunnerConfig {
  mesh: string;
  agent: string;
  workDir: string;
  msgsDir: string;
  meshesDir: string;
}

/**
 * Resolve lifecycle hooks from config
 * Supports shorthands that expand to lifecycle hooks:
 * - graded: true → quality:preflight + individual quality gates
 * - graded: ['checklist', 'rubric'] → quality:preflight + specific gates
 */
function resolveLifecycle(config: MeshConfig): { pre: string[]; post: string[] } | undefined {
  // Explicit lifecycle takes precedence
  if (config.lifecycle) {
    return {
      pre: config.lifecycle.pre || [],
      post: config.lifecycle.post || [],
    };
  }

  // graded: true/array shorthand → individual quality gate hooks
  if (config.graded) {
    const pre: string[] = ['quality:preflight'];
    const post: string[] = [];

    // Determine which gates to use
    const gates: GateType[] = Array.isArray(config.graded) ? config.graded : [
      'checklist',
      'rubric',
      'adversarial',
      'accuracy',
      'summarizer',
      'deterministic',
    ];

    // Add each gate as an individual hook
    for (const gate of gates) {
      let hookName = `quality:${gate}`;

      // Only add iteration config to gates that can fail (not summarizer)
      if (gate !== 'summarizer') {
        const configParts: string[] = [];
        if (config.iteration?.onFail) {
          configParts.push(`onFail=${config.iteration.onFail}`);
        }
        if (config.iteration?.maxIterations) {
          configParts.push(`maxIterations=${config.iteration.maxIterations}`);
        }

        if (configParts.length > 0) {
          hookName += ':' + configParts.join(',');
        }
      }

      post.push(hookName);
    }

    return { pre, post };
  }

  return undefined;
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

  constructor(config: HeadlessRunnerConfig, queue: MessageQueue) {
    super();
    this.config = config;
    this.queue = queue;
    this.promptInjector = new PromptInjector();
    this.lifecycleHooks = new LifecycleHooks(config.workDir, queue, config.meshesDir);
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
   * @param taskBody - Optional task body for preflight analysis (used when graded: true)
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

    // Create hook context
    this.hookContext = {
      meshInstance,
      meshName: this.config.mesh,
      agentName: this.config.agent,
      workDir: this.config.workDir,
      agentId,
      taskId,
      taskBody: taskBody || '',
      msgsDir: this.config.msgsDir,
      qualityIteration: this.currentIteration,
      qualityMaxIterations: this.maxIterations,
      qualityOnFail: this.onFail,
    };

    // Resolve lifecycle hooks
    log.info('headless-runner', 'Resolving lifecycle hooks', {
      agentId,
      meshName: this.meshConfig.mesh,
      hasGraded: this.meshConfig.graded !== undefined,
      gradedValue: this.meshConfig.graded,
      hasLifecycle: this.meshConfig.lifecycle !== undefined,
    });

    const lifecycle = resolveLifecycle(this.meshConfig);

    log.info('headless-runner', 'Lifecycle resolved', {
      agentId,
      hasLifecycle: !!lifecycle,
      pre: lifecycle?.pre || [],
      post: lifecycle?.post || [],
    });

    // Execute pre-hooks (includes quality:preflight for graded meshes)
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

    // Build system prompt
    let systemPrompt = this.loadPrompt();
    systemPrompt = this.promptInjector.injectMessagingProtocol(systemPrompt);

    // Add headless mode context
    systemPrompt += `\n\n## Headless Run Mode\n`;
    systemPrompt += `You are in headless REPL mode. The user is interacting directly via terminal.\n`;
    systemPrompt += `- Write output files to: ${this.config.workDir}\n`;
    systemPrompt += `- Write response messages to: ${this.config.msgsDir}/\n`;
    systemPrompt += `\n### Headless Routing\n`;
    systemPrompt += `In headless mode, there is NO core agent. Route messages to the user instead:\n`;
    systemPrompt += `- **task-complete**: Write to \`user/repl\` (NOT core/core)\n`;
    systemPrompt += `- **ask-human**: Write to \`user/repl\` for user input\n`;
    systemPrompt += `- **ask**: Write to other agents in this mesh if needed\n`;

    const runnerConfig: SdkRunnerConfig = {
      id: agentId,
      model: this.agentConfig.model,
      systemPrompt,
      workDir: this.config.workDir,
      msgsDir: this.config.msgsDir,
      mcpServers: this.agentConfig.mcpServers,
      toolRestriction: this.meshConfig.toolRestriction,
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
        type: 'task',
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
      log.error('headless-runner', 'Worker error', { error: (error as Error).message });
      this.emit('error', { id: agentId, error: (error as Error).message });
      this.running = false;
    });
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    if (this.runner) {
      this.runner.kill();
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
      this.runner.kill();
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

    // Build system prompt
    let systemPrompt = this.loadPrompt();
    systemPrompt = this.promptInjector.injectMessagingProtocol(systemPrompt);

    // Add headless mode context
    systemPrompt += `\n\n## Headless Run Mode\n`;
    systemPrompt += `You are in headless REPL mode. The user is interacting directly via terminal.\n`;
    systemPrompt += `- Write output files to: ${this.config.workDir}\n`;
    systemPrompt += `- Write response messages to: ${this.config.msgsDir}/\n`;
    systemPrompt += `\n### Headless Routing\n`;
    systemPrompt += `In headless mode, there is NO core agent. Route messages to the user instead:\n`;
    systemPrompt += `- **task-complete**: Write to \`user/repl\` (NOT core/core)\n`;
    systemPrompt += `- **ask-human**: Write to \`user/repl\` for user input\n`;
    systemPrompt += `- **ask**: Write to other agents in this mesh if needed\n`;

    // Add quality iteration context if this is a retry
    if (this.currentIteration > 1) {
      systemPrompt += `\n## Quality Iteration ${this.currentIteration}\n`;
      systemPrompt += `This is quality iteration ${this.currentIteration} of ${this.maxIterations}.\n`;
      systemPrompt += `Please review the quality feedback below and address all issues.\n`;
    }

    const runnerConfig: SdkRunnerConfig = {
      id: agentId,
      model: this.agentConfig.model,
      systemPrompt,
      workDir: this.config.workDir,
      msgsDir: this.config.msgsDir,
      mcpServers: this.agentConfig.mcpServers,
      toolRestriction: this.meshConfig.toolRestriction,
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
        type: 'task',
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
      log.error('headless-runner', 'Worker error', { error: (error as Error).message });
      this.emit('error', { id: agentId, error: (error as Error).message });
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

    // Execute post-hooks (includes quality gates for graded meshes)
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
    const timestamp = Math.floor(Date.now() / 1000);
    const msgId = `quality-feedback-${this.hookContext.taskId}-${this.currentIteration}`;
    const filename = `${timestamp}-task-core--${agentId.replace('/', '-')}-${msgId}.md`;
    const filepath = path.join(this.hookContext.msgsDir, filename);

    const content = `---
to: ${agentId}
from: core/core
type: task
msg-id: ${msgId}
headline: Quality feedback - iteration ${this.currentIteration}
timestamp: ${new Date().toISOString()}
headless: true
---

## Quality Stack Feedback

The previous attempt did not pass quality evaluation. Please address the following feedback and try again:

${feedback}

---

**Iteration**: ${this.currentIteration} of ${this.maxIterations}
**Action**: Review the feedback above and improve your solution.
`;

    fs.writeFileSync(filepath, content);
    log.info('headless-runner', 'Wrote quality feedback message', {
      agentId,
      taskId: this.hookContext.taskId,
      iteration: this.currentIteration,
      filepath,
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
