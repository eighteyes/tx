/**
 * Core Agent
 *
 * The persistent agent that runs in tmux. Responsibilities:
 * - Poll queue for messages addressed to core
 * - Handle ask-human (HITL) - display to user, capture response
 * - Run workers when tasks arrive
 * - Route messages between agents
 */

import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { MessageQueue, type Message } from '../queue/index.ts';
import { MessageConsumer } from './consumer.ts';
import { TmuxSession } from './tmux.ts';
import { SdkRunner, type SdkRunnerConfig } from '../worker/sdk-runner.ts';
import type { CoreConfig, SemanticModel } from '../shared/types.ts';
import { log } from '../shared/logger.ts';

interface PendingHITL {
  msg: Message;
  resolve: (response: string) => void;
}

export class CoreAgent extends EventEmitter {
  private config: CoreConfig;
  private queue: MessageQueue;
  private consumer: MessageConsumer;
  private tmux: TmuxSession;
  private running = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private pendingHITL: PendingHITL | null = null;
  private rl: readline.Interface | null = null;

  constructor(config: CoreConfig) {
    super();
    this.config = config;
    this.queue = new MessageQueue(config.dbPath);
    this.consumer = new MessageConsumer(config.msgsDir, this.queue);
    this.tmux = new TmuxSession(config.sessionName);
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Start tmux session if not exists
    const exists = await this.tmux.exists();
    if (!exists) {
      await this.tmux.create();
    }

    // Start message consumer (watches .ai/tx/msgs/)
    await this.consumer.start();

    // Setup readline for HITL input
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Start polling queue
    this.running = true;
    this.pollInterval = setInterval(() => this.poll(), 500);

    console.log(`\n[core] Started`);
    console.log(`[core] Session: ${this.config.sessionName}`);
    console.log(`[core] Watching: ${this.config.msgsDir}`);
    console.log(`[core] Queue: ${this.config.dbPath}\n`);

    this.emit('start');
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    await this.consumer.stop();
    this.queue.close();

    console.log('[core] Stopped');
    this.emit('stop');
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const messages = this.queue.poll('core/core');

      for (const msg of messages) {
        await this.handleMessage(msg);
      }
    } catch (err) {
      log.error('core', 'Poll error', { error: (err as Error).message });
    }
  }

  private async handleMessage(msg: Message): Promise<void> {
    console.log(`\n[core] ← ${msg.type} from ${msg.from_agent}`);

    switch (msg.type) {
      case 'ask-human':
        await this.handleAskHuman(msg);
        break;

      case 'task':
        await this.handleTask(msg);
        break;

      case 'task-complete':
        await this.handleTaskComplete(msg);
        break;

      case 'ask':
        await this.routeMessage(msg);
        break;

      default:
        console.log(`[core] Unhandled type: ${msg.type}`);
    }
  }

  /**
   * HITL: Display question, wait for user input, send response
   */
  private async handleAskHuman(msg: Message): Promise<void> {
    const question = msg.payload.body || msg.payload.headline || 'Question from agent';

    console.log('\n' + '='.repeat(60));
    console.log(`🤔 ${msg.from_agent} asks:`);
    console.log('-'.repeat(60));
    console.log(question);
    console.log('='.repeat(60));

    // Get user input
    const response = await this.promptUser('\n> Your response: ');

    // Send ask-response back to the agent
    this.queue.insert({
      from_agent: 'core/core',
      to_agent: msg.from_agent,
      type: 'ask-response',
      payload: {
        'msg-id': `response-${Date.now()}`,
        headline: 'User response',
        body: response,
        original_question: question,
      },
    });

    console.log(`[core] → ask-response to ${msg.from_agent}\n`);
  }

  /**
   * Handle incoming task - potentially spawn a worker
   */
  private async handleTask(msg: Message): Promise<void> {
    console.log(`[core] Task: ${msg.payload.headline || 'No headline'}`);

    // If task is for a specific agent, check if we should run a worker
    const targetAgent = msg.to_agent;

    if (targetAgent !== 'core/core') {
      // Route to the target agent's queue - they'll pick it up when they run
      console.log(`[core] Task queued for ${targetAgent}`);
      return;
    }

    // Task is for core itself
    console.log(`[core] Processing task locally`);
  }

  /**
   * Handle task completion notification
   */
  private async handleTaskComplete(msg: Message): Promise<void> {
    console.log(`[core] ✓ Task complete from ${msg.from_agent}`);
    if (msg.payload.headline) {
      console.log(`[core]   ${msg.payload.headline}`);
    }
    this.emit('task-complete', msg);
  }

  /**
   * Route message - it's already in queue, just log
   */
  private async routeMessage(msg: Message): Promise<void> {
    console.log(`[core] Routing: ${msg.from_agent} → ${msg.to_agent}`);
  }

  /**
   * Prompt user for input (HITL)
   */
  private promptUser(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve('');
        return;
      }

      this.rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  /**
   * Run a worker for a specific agent
   */
  async runWorker(agentId: string, model: SemanticModel, prompt: string): Promise<void> {
    console.log(`[core] Running worker: ${agentId}`);

    const workerConfig: SdkRunnerConfig = {
      id: agentId,
      model,
      systemPrompt: prompt,
      workDir: this.config.workDir,
      msgsDir: this.config.msgsDir,
    };

    const worker = new SdkRunner(workerConfig, this.queue);

    worker.on('output', ({ data }: { id: string; data: string }) => {
      process.stdout.write(data);
    });

    worker.on('complete', ({ messagesProcessed }: { id: string; messagesProcessed: number; output: string }) => {
      console.log(`[core] Worker ${agentId} complete (${messagesProcessed} messages)`);
    });

    worker.on('error', ({ error }: { id: string; error: string }) => {
      log.error('core', 'Worker error', { agentId, error });
    });

    await worker.run();
  }

  isRunning(): boolean {
    return this.running;
  }

  getQueue(): MessageQueue {
    return this.queue;
  }

  /**
   * Handle /parallel command - execute multiple tasks concurrently on the same agent
   *
   * Usage: /parallel mesh/agent "task 1" "task 2" "task 3"
   *
   * This writes N message files simultaneously, triggering the dispatcher
   * to spawn N workers in parallel for the same agent.
   */
  handleParallelCommand(agentId: string, tasks: string[]): void {
    if (!agentId || tasks.length === 0) {
      console.log(`[core] Usage: /parallel <agent-id> "task 1" "task 2" ...`);
      console.log(`[core] Example: /parallel dev/worker "implement auth" "add tests"`);
      return;
    }

    // Validate agent ID format (mesh/agent)
    if (!agentId.includes('/')) {
      console.log(`[core] Invalid agent ID format. Expected: mesh/agent, got: ${agentId}`);
      return;
    }

    console.log(`\n[core] ⚡ Parallel execution: ${tasks.length} tasks → ${agentId}`);

    const timestamp = Date.now();
    const messagesWritten: string[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const msgId = `parallel-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;

      try {
        this.writeParallelMessage(agentId, task, msgId, i + 1, tasks.length);
        messagesWritten.push(msgId);
        console.log(`[core]   → Task ${i + 1}: ${task.substring(0, 50)}${task.length > 50 ? '...' : ''}`);
      } catch (error) {
        log.error('core', 'Failed to write parallel message', {
          agentId,
          taskIndex: i,
          error: (error as Error).message,
        });
        console.log(`[core] ✗ Failed to write task ${i + 1}: ${(error as Error).message}`);
      }
    }

    console.log(`[core] ✓ ${messagesWritten.length}/${tasks.length} tasks dispatched\n`);

    this.emit('parallel-dispatch', {
      agentId,
      taskCount: tasks.length,
      messagesWritten,
    });
  }

  /**
   * Write a single task message to the msgs directory
   */
  private writeParallelMessage(
    agentId: string,
    taskBody: string,
    msgId: string,
    taskIndex: number,
    totalTasks: number
  ): void {
    const timestamp = Date.now();
    const toSafe = agentId.replace(/\//g, '-');
    const filename = `${timestamp}-task-core-core--${toSafe}-${msgId}.md`;
    const filepath = path.join(this.config.msgsDir, filename);

    const headline = `Parallel task ${taskIndex}/${totalTasks}`;

    const messageContent = `---
to: ${agentId}
from: core/core
type: task
msg-id: ${msgId}
headline: ${headline}
timestamp: ${new Date().toISOString()}
parallel-batch: ${totalTasks}
parallel-index: ${taskIndex}
---

${taskBody}
`;

    fs.writeFileSync(filepath, messageContent);

    log.info('core', 'Wrote parallel task message', {
      agentId,
      msgId,
      taskIndex,
      totalTasks,
      filepath,
    });
  }
}
