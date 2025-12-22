/**
 * WorkerDispatcher - Watches queue for task messages and spawns workers
 *
 * When a task message arrives for a non-core agent, the dispatcher:
 * 1. Loads the mesh config to find the agent's prompt
 * 2. Spawns an SdkRunner with the task (resumes if session exists)
 * 3. Worker runs, writes response messages, exits
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { MessageQueue } from '../queue/index.ts';
import { SdkRunner, type SdkRunnerConfig, type AgentRouting, type ToolRestriction } from './sdk-runner.ts';
import type { SemanticModel, WorkerConfig } from '../shared/types.ts';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import { WorkerStateMachine, createLoggingMiddleware } from '../state-machine/index.ts';
import { WorkspaceManager, PromptInjector, type WorkspaceConfig } from '../workspace/index.ts';
import { LifecycleHooks, type HookContext } from './hooks.ts';
import { MeshValidator } from './mesh-validator.ts';

/**
 * Load environment variables from .mcp.env file
 * Returns empty object if file doesn't exist
 */
function loadMcpEnv(workDir: string): Record<string, string> {
  const mcpEnvPath = path.join(workDir, '.mcp.env');

  if (!fs.existsSync(mcpEnvPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(mcpEnvPath, 'utf-8');
    const env: Record<string, string> = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }

    return env;
  } catch (error) {
    log.warn('dispatcher', 'Failed to load .mcp.env', {
      error: (error as Error).message
    });
    return {};
  }
}

/**
 * Routing destination in mesh config
 * Format: { destination_agent: "reason string" }
 */
type MeshRoutingDestination = Record<string, string>;

/**
 * Agent routing in mesh config
 * Format: { status_type: { destination_agent: "reason" } }
 */
type MeshAgentRouting = Record<string, MeshRoutingDestination>;

/**
 * Mesh routing config
 * Format: { agent_name: { status_type: { destination_agent: "reason" } } }
 */
type MeshRouting = Record<string, MeshAgentRouting>;

interface MeshConfig {
  mesh: string;
  description?: string;
  agents: AgentConfig[];
  entry_point?: string;
  workspace?: WorkspaceConfig;  // Optional workspace output schema
  worktree?: boolean;  // Shorthand: true = isolated worktree + auto-commit + cleanup
  lifecycle?: {
    pre?: string[];   // Pre-hooks executed before worker spawn
    post?: string[];  // Post-hooks executed after worker completion
  };
  routing?: MeshRouting;  // Agent routing tables
  toolRestriction?: ToolRestriction;  // Tool access policy for all agents in mesh
  _basePath?: string;  // Internal: directory containing this config (for relative prompt paths)
}

/**
 * Resolve lifecycle hooks from config
 * worktree: true expands to full worktree lifecycle
 * Explicit lifecycle overrides worktree shorthand
 */
function resolveLifecycle(config: MeshConfig): { pre: string[]; post: string[] } | undefined {
  // Explicit lifecycle takes precedence
  if (config.lifecycle) {
    return {
      pre: config.lifecycle.pre || [],
      post: config.lifecycle.post || [],
    };
  }

  // worktree: true shorthand
  if (config.worktree) {
    return {
      pre: ['worktree:create'],
      post: ['commit:auto', 'worktree:cleanup'],
    };
  }

  return undefined;
}

interface AgentConfig {
  name: string;
  model: SemanticModel;
  prompt: string;  // Path to prompt file
  workspace?: WorkspaceConfig;  // Optional per-agent workspace config
  mcpServers?: Record<string, McpServerConfig>;  // MCP server configurations
}

export interface DispatcherConfig {
  workDir: string;
  msgsDir: string;
  meshesDir: string;
  pollInterval?: number;  // ms, default 1000
}

export class WorkerDispatcher extends EventEmitter {
  private config: DispatcherConfig;
  private queue: MessageQueue;
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private activeWorkers: Map<string, { runner: SdkRunner; machine: WorkerStateMachine; startedAt: number }> = new Map();
  private meshConfigs: Map<string, MeshConfig> = new Map();
  private stateFile: string;
  private workspaceManager: WorkspaceManager;
  private promptInjector: PromptInjector;
  private lifecycleHooks: LifecycleHooks;

  constructor(config: DispatcherConfig, queue: MessageQueue) {
    super();
    this.config = config;
    this.queue = queue;
    this.stateFile = path.join(config.workDir, '.ai', 'tx', 'data', 'workers.json');
    this.workspaceManager = new WorkspaceManager(config.workDir);
    this.promptInjector = new PromptInjector();
    this.lifecycleHooks = new LifecycleHooks(config.workDir, queue, config.meshesDir);
  }

  private writeWorkerState(): void {
    const state = {
      workers: Array.from(this.activeWorkers.entries()).map(([id, w]) => ({
        id,
        status: w.machine.getStatus(),
        startedAt: w.startedAt,
        messagesProcessed: w.machine.getMessagesProcessed(),
        duration: w.machine.getDuration()
      })),
      updatedAt: Date.now(),
    };
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Start the dispatcher - begins polling for task messages
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Load all mesh configs
    this.loadMeshConfigs();

    this.running = true;
    this.emit('start');

    // Start polling
    this.poll();
  }

  /**
   * Stop the dispatcher
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Kill all active workers
    for (const [_id, { runner }] of this.activeWorkers) {
      runner.kill();
    }
    this.activeWorkers.clear();
    this.writeWorkerState();

    this.emit('stop');
  }

  /**
   * Poll queue for task messages destined for workers
   */
  private poll(): void {
    if (!this.running) return;

    try {
      // Reload configs at poll time to pick up changes (e.g., workspace paths)
      for (const [meshName, _cachedConfig] of this.meshConfigs) {
        // Re-read config from disk to enable runtime config updates
        const meshConfig = this.reloadMeshConfig(meshName);
        if (!meshConfig) continue;

        // Validate agents field
        if (!meshConfig.agents || !Array.isArray(meshConfig.agents)) {
          log.error('dispatcher', `Invalid mesh config: agents is not an array`, {
            meshName,
            agentsType: typeof meshConfig.agents,
            agentsValue: meshConfig.agents
          });
          continue;
        }

        for (const agent of meshConfig.agents) {
          const agentId = `${meshName}/${agent.name}`;

          // Skip if worker already running
          if (this.activeWorkers.has(agentId)) continue;

          // Check for any pending message (peek, don't consume yet)
          // The SdkRunner will pollOne when it runs
          // Dispatch on any message type - task, ask-response, ask-human, etc.
          const nextMsg = this.queue.peekOne(agentId);
          if (!nextMsg) continue;

          log.info('dispatcher', `Found ${nextMsg.type} for ${agentId}`, {
            agentId,
            type: nextMsg.type,
            headline: nextMsg.payload.headline
          });

          // Spawn worker for this agent
          this.spawnWorker(meshName, agent);
        }
      }
    } catch (error) {
      log.error('dispatcher', 'Poll error', { error: (error as Error).message });
      this.emit('error', { error: (error as Error).message });
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => this.poll(), this.config.pollInterval || 1000);
  }

  /**
   * Spawn a worker for an agent using SDK with FSM
   */
  private async spawnWorker(meshName: string, agent: AgentConfig): Promise<void> {
    const agentId = `${meshName}/${agent.name}`;

    try {
      // Peek at the next message to get task ID for workspace
      const nextMsg = this.queue.peekOne(agentId);
      const taskId = nextMsg ? nextMsg.id : `${agentId}-${Date.now()}`;

      // Get mesh config (poll() already reloaded it from disk)
      const meshConfig = this.meshConfigs.get(meshName);

      // Create hook context
      const meshInstance = `${meshName}-${Date.now()}`;
      const hookContext: HookContext = {
        meshInstance,
        meshName,
        agentName: agent.name,
        workDir: this.config.workDir,
      };

      // Resolve lifecycle hooks (worktree: true or explicit lifecycle)
      const lifecycle = meshConfig ? resolveLifecycle(meshConfig) : undefined;

      // Execute pre-hooks if configured
      if (lifecycle?.pre && lifecycle.pre.length > 0) {
        log.info('dispatcher', `Executing pre-hooks for ${agentId}`, {
          hooks: lifecycle.pre,
        });

        try {
          await this.lifecycleHooks.executePreHooks(lifecycle.pre, hookContext);
        } catch (error) {
          const errorMsg = (error as Error).message;
          log.error('dispatcher', `Pre-hook execution failed, aborting worker spawn`, {
            agentId,
            error: errorMsg,
          });

          // Cleanup partial state (e.g., worktree created by earlier hook)
          if (hookContext.worktreePath) {
            try {
              log.info('dispatcher', `Cleaning up worktree after pre-hook failure`, {
                meshInstance,
                path: hookContext.worktreePath,
              });
              this.lifecycleHooks.getWorktreeManager().removeWorktree(meshInstance, true);
            } catch (cleanupError) {
              log.error('dispatcher', `Failed to cleanup worktree after pre-hook failure`, {
                meshInstance,
                error: (cleanupError as Error).message,
              });
            }
          }

          this.emit('error', { agentId, error: `Pre-hook failed: ${errorMsg}` });
          return;
        }
      }

      // Load the prompt - resolution order:
      // 1. Relative to mesh's basePath (new structure: meshes/dev/prompt.md)
      // 2. Relative to workDir (legacy: meshes/agents/dev/prompt.md)
      // 3. Global TX_ROOT fallback
      let promptPath: string | null = null;

      // Try mesh basePath first (new flat structure)
      if (meshConfig?._basePath) {
        const meshRelativePath = path.join(meshConfig._basePath, agent.prompt);
        if (fs.existsSync(meshRelativePath)) {
          promptPath = meshRelativePath;
        }
      }

      // Fall back to workDir-relative (legacy structure)
      if (!promptPath) {
        const workDirPath = path.join(this.config.workDir, agent.prompt);
        if (fs.existsSync(workDirPath)) {
          promptPath = workDirPath;
        }
      }

      // Fall back to global TX_ROOT
      if (!promptPath && process.env.TX_ROOT) {
        const globalPath = path.join(process.env.TX_ROOT, agent.prompt);
        if (fs.existsSync(globalPath)) {
          promptPath = globalPath;
        }
      }

      if (!promptPath) {
        this.emit('error', { agentId, error: `Prompt not found: ${agent.prompt}` });
        return;
      }
      let systemPrompt = fs.readFileSync(promptPath, 'utf-8');

      // Check for workspace config (agent-level overrides mesh-level)
      const workspaceConfig = agent.workspace || meshConfig?.workspace;

      // Create workspace and inject context if configured
      if (workspaceConfig) {
        const workspace = this.workspaceManager.createWorkspace(taskId, workspaceConfig);
        systemPrompt = this.promptInjector.injectWorkspace(systemPrompt, {
          workspace,
          taskId,
        });
        log.info('dispatcher', `Created workspace for task`, { agentId, taskId, dir: workspace.dir });
      }

      // Create worker config
      const workerConfig: WorkerConfig = {
        id: agentId,
        model: agent.model,
        prompt: systemPrompt
      };

      // Create state machine
      const machine = new WorkerStateMachine(agentId, workerConfig, meshName, agent.name);

      // Register logging middleware
      machine.use(createLoggingMiddleware('worker'));

      // Wire FSM events to dispatcher
      machine.on('transition', (event) => {
        this.emit('worker:transition', {
          ...event,
          entityType: 'worker'
        });
      });

      // Initialize worker state
      await machine.initialize();

      log.info('dispatcher', `Initializing worker`, { agentId });

      // Use worktree path if set by pre-hooks, otherwise use default workDir
      const workDir = hookContext.worktreePath || this.config.workDir;

      // If running in worktree, inject context and sanitize paths
      if (hookContext.worktreePath) {
        // Inject worktree context into prompt
        const worktreeContext = `
## Worktree Context

You are working in an isolated git worktree.

- **Worktree Path**: ${hookContext.worktreePath}
- **Branch**: ${hookContext.worktreeBranch || 'unknown'}

**IMPORTANT**:
- Use relative paths or paths within this worktree directory
- Do NOT use paths containing "${this.config.workDir}" - that is the main repository
- All file operations should be relative to your current working directory
- Your CWD is already set to the worktree path

**Feature Assignment**: When you start working on a tracked feature, rename the worktree:
\`\`\`bash
git worktree move ${hookContext.worktreePath} .ai/tx/worktrees/{feature-name}
git branch -m ${hookContext.worktreeBranch || 'current-branch'} tx-worktree-{feature-name}
\`\`\`
This enables \`/know:done\` to find and cleanup the worktree automatically.

`;
        systemPrompt = worktreeContext + systemPrompt;

        // Strip references to main workDir from prompt to avoid confusion
        systemPrompt = systemPrompt.replaceAll(this.config.workDir, '.');

        log.info('dispatcher', `Injected worktree context`, {
          agentId,
          worktreePath: hookContext.worktreePath,
        });
      }

      // Extract routing config for this agent
      const routing = this.extractAgentRouting(meshName, agent.name, meshConfig);

      // Inject routing instructions into system prompt
      if (routing && Object.keys(routing).length > 0) {
        systemPrompt = this.injectRoutingInstructions(systemPrompt, routing, meshName);
        log.info('dispatcher', `Injected routing instructions into system prompt`, {
          agentId,
          routes: Object.keys(routing),
        });
      }

      // Load MCP environment variables if agent has MCP servers
      let mcpServers = agent.mcpServers;
      if (mcpServers && Object.keys(mcpServers).length > 0) {
        const mcpEnv = loadMcpEnv(this.config.workDir);

        if (Object.keys(mcpEnv).length > 0) {
          log.info('dispatcher', 'Loaded MCP environment variables', {
            agentId,
            vars: Object.keys(mcpEnv),
          });

          // Inject env vars into each MCP server config
          mcpServers = Object.fromEntries(
            Object.entries(mcpServers).map(([serverName, serverConfig]) => {
              return [
                serverName,
                {
                  ...serverConfig,
                  env: {
                    ...mcpEnv,              // MCP env vars as base
                    ...serverConfig.env,    // Server-specific env overrides
                  },
                },
              ];
            })
          );
        }
      }

      const runnerConfig: SdkRunnerConfig = {
        id: agentId,
        model: agent.model,
        systemPrompt,
        workDir,
        msgsDir: this.config.msgsDir,
        routing,
        mcpServers,
        toolRestriction: meshConfig?.toolRestriction,  // Pass tool restriction policy
      };

      const worker = new SdkRunner(runnerConfig, this.queue);
      this.emit('worker:spawn', { agentId, model: agent.model });

      // Wire up SDK events to FSM
      worker.on('start', async (data) => {
        await machine.start(data.pid || process.pid);
        this.emit('worker:start', data);
      });

      worker.on('output', (data) => {
        this.emit('worker:output', data);
      });

      worker.on('init', (data) => {
        this.emit('worker:init', data);
      });

      // Transition on message processing
      worker.on('message:idle', async (data) => {
        try {
          // Only transition to idle if currently running
          if (machine.state.status === 'running') {
            await machine.markIdle(data.message);
            this.emit('worker:idle', data);
          }
        } catch (error) {
          log.error('dispatcher', `Failed to mark worker idle`, {
            agentId,
            error: (error as Error).message,
            currentState: machine.state.status
          });
        }
      });

      // Complete transition
      worker.on('complete', async (data) => {
        await machine.complete(data);
        this.activeWorkers.delete(agentId);
        this.writeWorkerState();

        if (data.output) {
          this.saveSessionOutput(agentId, data.output);
        }

        // Execute post-hooks if configured
        if (lifecycle?.post && lifecycle.post.length > 0) {
          log.info('dispatcher', `Executing post-hooks for ${agentId}`, {
            hooks: lifecycle.post,
          });

          try {
            await this.lifecycleHooks.executePostHooks(lifecycle.post, hookContext);
          } catch (error) {
            // Post-hook errors are logged but don't affect completion
            log.error('dispatcher', `Post-hook execution failed`, {
              agentId,
              error: (error as Error).message,
            });
          }
        }

        this.emit('worker:complete', {
          ...data,
          transitionName: 'complete'
        });
      });

      // Error transition with retry logic
      worker.on('error', async (data) => {
        await machine.error(data.error);

        // Check if we can retry
        const canRetry = await machine.canTransition('retry', {
          status: 'initializing',
          config: workerConfig,
          startedAt: Date.now()
        } as any);

        if (canRetry) {
          log.info('dispatcher', `Retrying worker`, {
            agentId,
            attempt: machine.context.retryCount + 1,
            maxRetries: machine.context.maxRetries
          });

          await machine.retry();
          // Recursively spawn again, but check if dispatcher is still running
          setTimeout(() => {
            if (this.running) {
              this.spawnWorker(meshName, agent);
            } else {
              log.debug('dispatcher', `Skipping retry, dispatcher stopped`, { agentId });
            }
          }, 1000);
        } else {
          log.error('dispatcher', `Worker exhausted retries`, { agentId });
          this.activeWorkers.delete(agentId);
          this.writeWorkerState();
        }

        this.emit('worker:error', { ...data, transitionName: 'error' });
      });

      this.activeWorkers.set(agentId, { runner: worker, machine, startedAt: Date.now() });
      this.writeWorkerState();

      // Run the worker (async, don't await)
      worker.run().catch(async (error) => {
        await machine.error((error as Error).message)
          .catch(e => log.error('dispatcher', 'Error during error transition', { error: (e as Error).message }));

        // Cleanup worktree if created
        if (lifecycle?.post && lifecycle.post.length > 0) {
          try {
            log.info('dispatcher', `Executing post-hooks after worker spawn error for ${agentId}`, {
              hooks: lifecycle.post,
            });
            await this.lifecycleHooks.executePostHooks(lifecycle.post, hookContext);
          } catch (err) {
            log.error('dispatcher', `Post-hook cleanup failed after worker error`, {
              agentId,
              error: (err as Error).message,
            });
          }
        }
      });

    } catch (error) {
      log.error('dispatcher', 'Failed to spawn worker', {
        agentId,
        error: (error as Error).message
      });
      this.emit('error', { agentId, error: (error as Error).message });
    }
  }

  /**
   * Load all mesh configs from meshes/ directory structure
   * Supports: meshes/{mesh}/config.yaml and meshes/{category}/{mesh}/config.yaml
   * Falls back to TX_ROOT/meshes/ if project doesn't have meshes
   */
  private loadMeshConfigs(): void {
    try {
      const meshRoots: Array<{ dir: string; isGlobal: boolean }> = [];

      // Project meshes
      if (fs.existsSync(this.config.meshesDir)) {
        meshRoots.push({ dir: this.config.meshesDir, isGlobal: false });
      }

      // Global TX_ROOT meshes (fallback)
      const globalMeshDir = process.env.TX_ROOT
        ? path.join(process.env.TX_ROOT, 'meshes')
        : null;
      if (globalMeshDir && fs.existsSync(globalMeshDir) && globalMeshDir !== this.config.meshesDir) {
        meshRoots.push({ dir: globalMeshDir, isGlobal: true });
      }

      // Legacy: check for meshes/configs/ directory (old structure)
      const legacyConfigDir = path.join(this.config.meshesDir, 'configs');
      if (fs.existsSync(legacyConfigDir)) {
        this.loadMeshConfigsFromLegacyDir(legacyConfigDir, false);
      }

      if (meshRoots.length === 0) {
        log.warn('dispatcher', 'No mesh directories found', {
          projectDir: this.config.meshesDir,
          globalDir: globalMeshDir
        });
        return;
      }

      // Scan meshes/*/ and meshes/*/*/ for config files
      for (const { dir: meshRoot, isGlobal } of meshRoots) {
        this.scanMeshDir(meshRoot, isGlobal, 0);
      }
    } catch (error) {
      log.error('dispatcher', 'Failed to load mesh configs', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      this.emit('error', { error: `Failed to load mesh configs: ${(error as Error).message}` });
    }
  }

  /**
   * Recursively scan mesh directory for config files (max depth 2)
   * Supports: config.yaml, config.yml (preferred) and config.json (legacy)
   */
  private scanMeshDir(dir: string, isGlobal: boolean, depth: number): void {
    if (depth > 2) return;  // meshes/category/mesh/ is max depth
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      // Check for config files in this directory (priority: YAML > JSON)
      const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
      const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

      if (yamlConfig) {
        this.loadMeshConfigFromFile(path.join(dir, yamlConfig.name), dir, isGlobal);
      } else if (jsonConfig) {
        this.loadMeshConfigFromFile(path.join(dir, 'config.json'), dir, isGlobal);
      }

      // Recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'configs') {
          this.scanMeshDir(path.join(dir, entry.name), isGlobal, depth + 1);
        }
      }
    } catch (error) {
      log.error('dispatcher', `Failed to scan mesh directory: ${dir}`, {
        error: (error as Error).message
      });
    }
  }

  /**
   * Load a single mesh config from a file
   * Uses MeshValidator for comprehensive validation
   * Supports both YAML (.yaml, .yml) and JSON (.json) formats
   */
  private loadMeshConfigFromFile(configPath: string, basePath: string, isGlobal: boolean): void {
    const filename = path.basename(configPath);
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const isYaml = filename.endsWith('.yaml') || filename.endsWith('.yml');
      const rawConfig = isYaml ? YAML.parse(content) : JSON.parse(content);

      // Validate using MeshValidator
      const validation = MeshValidator.validate(rawConfig, filename);

      if (!validation.valid) {
        log.error('dispatcher', `Invalid mesh config: ${filename}`, {
          configPath,
          errors: validation.errors
        });
        this.emit('mesh:invalid', {
          file: filename,
          errors: validation.errors,
          warnings: validation.warnings
        });
        return;
      }

      // Log warnings but still load the config
      if (validation.warnings.length > 0) {
        log.warn('dispatcher', `Mesh config warnings: ${filename}`, {
          warnings: validation.warnings
        });
      }

      const config = validation.config as MeshConfig;

      // Don't override project configs with global ones
      if (this.meshConfigs.has(config.mesh) && isGlobal) {
        return;
      }

      // Store base path for relative prompt resolution
      config._basePath = basePath;

      this.meshConfigs.set(config.mesh, config);
      log.info('dispatcher', `Loaded mesh: ${config.mesh}`, {
        source: isGlobal ? 'global' : 'project',
        basePath,
        agents: config.agents.map(a => a.name),
        warnings: validation.warnings.length
      });
      this.emit('mesh:loaded', { mesh: config.mesh, agents: config.agents.length });
    } catch (error) {
      log.error('dispatcher', `Failed to parse mesh config: ${filename}`, {
        configPath,
        error: (error as Error).message
      });
      this.emit('mesh:invalid', {
        file: filename,
        errors: [(error as Error).message],
        warnings: []
      });
    }
  }

  /**
   * Legacy: Load configs from meshes/configs/ directory (old structure)
   */
  private loadMeshConfigsFromLegacyDir(configDir: string, isGlobal: boolean): void {
    const files = fs.readdirSync(configDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const configPath = path.join(configDir, file);
      // Legacy configs use workDir-relative prompt paths, so basePath is workDir
      this.loadMeshConfigFromFile(configPath, this.config.workDir, isGlobal);
    }
  }

  /**
   * Reload a specific mesh config from disk
   *
   * This enables dynamic config updates (e.g., workspace path changes)
   * to take effect without restarting TX. The mesh config is re-read
   * from disk and cached. Called by poll() before iterating agents.
   *
   * @param meshName - The mesh name to reload
   * @returns The freshly loaded mesh config, or undefined if not found
   */
  private reloadMeshConfig(meshName: string): MeshConfig | undefined {
    // Get the existing config to find its source location
    const existingConfig = this.meshConfigs.get(meshName);
    if (!existingConfig?._basePath) {
      // If we don't have an existing config with basePath, return cached version
      // This shouldn't happen in normal operation, but provides safety
      return existingConfig;
    }

    // Re-read the config file from disk
    const basePath = existingConfig._basePath;
    const yamlPath = path.join(basePath, 'config.yaml');
    const ymlPath = path.join(basePath, 'config.yml');
    const jsonPath = path.join(basePath, 'config.json');

    let configPath: string | null = null;
    if (fs.existsSync(yamlPath)) {
      configPath = yamlPath;
    } else if (fs.existsSync(ymlPath)) {
      configPath = ymlPath;
    } else if (fs.existsSync(jsonPath)) {
      configPath = jsonPath;
    }

    if (!configPath) {
      log.warn('dispatcher', `Config file not found for mesh reload`, {
        meshName,
        basePath,
      });
      return existingConfig;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const isYaml = configPath.endsWith('.yaml') || configPath.endsWith('.yml');
      const rawConfig = isYaml ? YAML.parse(content) : JSON.parse(content);

      // Validate using MeshValidator
      const validation = MeshValidator.validate(rawConfig, path.basename(configPath));

      if (!validation.valid) {
        log.error('dispatcher', `Invalid mesh config on reload`, {
          meshName,
          configPath,
          errors: validation.errors,
        });
        // Return cached version on validation failure
        return existingConfig;
      }

      if (validation.warnings.length > 0) {
        log.warn('dispatcher', `Mesh config warnings on reload: ${meshName}`, {
          warnings: validation.warnings,
        });
      }

      const config = validation.config as MeshConfig;
      config._basePath = basePath;

      // Update the cache with fresh config
      this.meshConfigs.set(meshName, config);

      log.debug('dispatcher', `Reloaded mesh config at spawn time`, {
        meshName,
        workspace: config.workspace,
      });

      return config;
    } catch (error) {
      log.error('dispatcher', `Failed to reload mesh config`, {
        meshName,
        configPath,
        error: (error as Error).message,
      });
      // Return cached version on error
      return existingConfig;
    }
  }

  /**
   * Save session output to .ai/tx/sessions/{agentId}/{timestamp}.md
   */
  private saveSessionOutput(agentId: string, output: string): void {
    try {
      const sessionsDir = path.join(this.config.workDir, '.ai', 'tx', 'sessions', agentId.replace('/', '-'));
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}.md`;
      const filepath = path.join(sessionsDir, filename);

      const content = `# Session Output: ${agentId}

**Captured**: ${new Date().toISOString()}

---

${output}
`;

      fs.writeFileSync(filepath, content);
      log.info('dispatcher', `Saved session output: ${filepath}`, { agentId, bytes: output.length });
    } catch (err) {
      log.error('dispatcher', `Failed to save session output`, { agentId, error: (err as Error).message });
    }
  }

  /**
   * Inject routing instructions into system prompt
   * Appends routing table to end of system prompt
   */
  private injectRoutingInstructions(
    systemPrompt: string,
    routing: AgentRouting,
    meshName: string
  ): string {
    const lines: string[] = [];
    lines.push('\n\n## Message Routing\n');
    lines.push('When you complete your work, route your response message based on the outcome:\n');

    for (const [status, dest] of Object.entries(routing)) {
      const targetAgent = dest.to === 'core' ? 'core/core' : dest.to;
      lines.push(`\n**Status: \`${status}\`**`);
      lines.push(`- Send message to: \`${targetAgent}\``);
      lines.push(`- Reason: ${dest.reason}`);
    }

    lines.push('\n\nSet the `to` field in your message frontmatter based on which status applies.');

    return systemPrompt + lines.join('\n');
  }

  /**
   * Extract routing config for a specific agent from mesh config
   * Transforms mesh format: { status: { destination: "reason" } }
   * To runner format: { status: { to: destination, reason: "reason" } }
   */
  private extractAgentRouting(
    meshName: string,
    agentName: string,
    meshConfig?: MeshConfig
  ): AgentRouting | undefined {
    if (!meshConfig?.routing) return undefined;

    const agentRouting = meshConfig.routing[agentName];
    if (!agentRouting) return undefined;

    // Transform mesh config format to SdkRunner format
    const result: AgentRouting = {};

    for (const [status, destinations] of Object.entries(agentRouting)) {
      // Each status maps to { destination_agent: "reason" }
      // Take the first (usually only) destination
      const entries = Object.entries(destinations);
      if (entries.length === 0) continue;

      const [destination, reason] = entries[0];

      // Build full agent path if not already qualified
      // "core" -> "core/core", "sourcer" -> "research/sourcer"
      const to = destination.includes('/')
        ? destination
        : destination === 'core'
          ? 'core/core'
          : `${meshName}/${destination}`;

      result[status] = { to, reason };
    }

    // Only return if we have any routes
    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * Get active worker count
   */
  getActiveWorkerCount(): number {
    return this.activeWorkers.size;
  }

  /**
   * Get list of active worker IDs
   */
  getActiveWorkerIds(): string[] {
    return Array.from(this.activeWorkers.keys());
  }

  /**
   * Check if dispatcher is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get worker state machine by agent ID
   */
  getWorkerMachine(agentId: string): WorkerStateMachine | undefined {
    return this.activeWorkers.get(agentId)?.machine;
  }

  /**
   * Get all active worker state machines
   */
  getAllWorkerMachines(): Map<string, WorkerStateMachine> {
    const machines = new Map<string, WorkerStateMachine>();
    for (const [id, worker] of this.activeWorkers) {
      machines.set(id, worker.machine);
    }
    return machines;
  }

  /**
   * Get the workspace manager
   */
  getWorkspaceManager(): WorkspaceManager {
    return this.workspaceManager;
  }
}
