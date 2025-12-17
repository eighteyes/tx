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
import readline from 'node:readline';
import { MessageQueue, type Message } from '../queue/index.ts';
import { MessageConsumer } from './consumer.ts';
import { TmuxSession } from './tmux.ts';
import { WorkerRunner, type WorkerRunConfig } from '../worker/runner.ts';
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

    const workerConfig: WorkerRunConfig = {
      id: agentId,
      model,
      prompt,
      workDir: this.config.workDir,
      msgsDir: this.config.msgsDir,
    };

    const worker = new WorkerRunner(workerConfig, this.queue);

    worker.on('output', ({ data }) => {
      process.stdout.write(data);
    });

    worker.on('complete', ({ messagesProcessed }) => {
      console.log(`[core] Worker ${agentId} complete (${messagesProcessed} messages)`);
    });

    worker.on('error', ({ error }) => {
      log.error('core', 'Worker error', { agentId, error });
    });

    const result = await worker.run();

    if (!result.success) {
      log.error('core', 'Worker failed', { agentId, error: result.error });
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getQueue(): MessageQueue {
    return this.queue;
  }
}
