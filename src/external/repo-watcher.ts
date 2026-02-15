/**
 * External Repo Watcher
 *
 * Bridges a remote git repo (used by Claude Code web) with the local tx instance.
 *
 * Outbound: polls remote repo for new message files in outbox/, copies to .ai/tx/msgs/
 * Inbound: watches .ai/tx/msgs/ for task-complete responses, copies to inbox/ and pushes
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { watch, type FSWatcher } from 'chokidar';
import { log } from '../shared/logger.ts';

const COMPONENT = 'repo-watcher';

export interface RepoWatcherConfig {
  /** Path to the external git repo (local clone) */
  repoPath: string;
  /** tx working directory (where .ai/tx/msgs/ lives) */
  txRoot: string;
  /** Git branch to watch (default: main) */
  branch?: string;
  /** Git remote name (default: origin) */
  remote?: string;
  /** Poll interval in ms (default: 5000) */
  pollInterval?: number;
  /** Whether to push inbox responses back (default: true) */
  pushResponses?: boolean;
  /** Custom 'from' identity for outbound messages (default: core/core) */
  fromIdentity?: string;
}

interface SyncState {
  /** Files already synced from outbox to tx */
  syncedOutbox: Set<string>;
  /** Files already synced from tx to inbox */
  syncedInbox: Set<string>;
  /** Last known commit hash on the watched branch */
  lastCommit: string | null;
}

export class RepoWatcher {
  private config: Required<RepoWatcherConfig>;
  private state: SyncState;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private inboxWatcher: FSWatcher | null = null;
  private running = false;

  // Resolved paths
  private outboxDir: string;
  private inboxDir: string;
  private msgsDir: string;
  private stateFile: string;

  constructor(config: RepoWatcherConfig) {
    this.config = {
      branch: 'main',
      remote: 'origin',
      pollInterval: 5000,
      pushResponses: true,
      fromIdentity: 'core/core',
      ...config,
    };

    this.outboxDir = path.join(this.config.repoPath, 'outbox');
    this.inboxDir = path.join(this.config.repoPath, 'inbox');
    this.msgsDir = path.join(this.config.txRoot, '.ai', 'tx', 'msgs');
    this.stateFile = path.join(this.config.repoPath, '.watcher-state.json');

    this.state = this.loadState();
  }

  /**
   * Start watching
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    log.info(COMPONENT, 'Starting external repo watcher', {
      repoPath: this.config.repoPath,
      branch: this.config.branch,
      pollInterval: this.config.pollInterval,
    });

    // Ensure directories exist
    if (!fs.existsSync(this.msgsDir)) {
      fs.mkdirSync(this.msgsDir, { recursive: true });
    }
    if (!fs.existsSync(this.outboxDir)) {
      fs.mkdirSync(this.outboxDir, { recursive: true });
    }
    if (!fs.existsSync(this.inboxDir)) {
      fs.mkdirSync(this.inboxDir, { recursive: true });
    }

    // Initial sync
    await this.pullAndSync();

    // Start polling for remote changes
    this.pollTimer = setInterval(() => {
      this.pullAndSync().catch(err => {
        log.error(COMPONENT, 'Poll cycle failed', { error: String(err) });
      });
    }, this.config.pollInterval);

    // Watch tx msgs dir for responses to bridge back
    if (this.config.pushResponses) {
      this.startInboxWatcher();
    }

    console.log(`[repo-watcher] Watching ${this.config.repoPath} (branch: ${this.config.branch})`);
    console.log(`[repo-watcher] Bridging outbox → ${this.msgsDir}`);
    if (this.config.pushResponses) {
      console.log(`[repo-watcher] Bridging responses → inbox/`);
    }
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.inboxWatcher) {
      await this.inboxWatcher.close();
      this.inboxWatcher = null;
    }

    this.saveState();
    log.info(COMPONENT, 'Stopped external repo watcher');
  }

  /**
   * Pull latest from remote and sync outbox → tx msgs
   */
  private async pullAndSync(): Promise<void> {
    const { repoPath, remote, branch } = this.config;

    try {
      // Fetch remote
      this.git('fetch', remote, branch);

      // Check if there are new commits
      const remoteHead = this.git('rev-parse', `${remote}/${branch}`).trim();
      if (remoteHead === this.state.lastCommit) {
        return; // No changes
      }

      log.info(COMPONENT, 'New commits detected', {
        previous: this.state.lastCommit?.slice(0, 8),
        current: remoteHead.slice(0, 8),
      });

      // Pull changes
      this.git('merge', `${remote}/${branch}`, '--ff-only');

      // Sync new outbox files to tx
      this.syncOutboxToTx();

      // Update state
      this.state.lastCommit = remoteHead;
      this.saveState();

    } catch (err) {
      log.error(COMPONENT, 'Git sync failed', { error: String(err) });
    }
  }

  /**
   * Scan outbox/ for new .md files and copy to tx msgs dir
   */
  private syncOutboxToTx(): void {
    if (!fs.existsSync(this.outboxDir)) return;

    const files = fs.readdirSync(this.outboxDir)
      .filter((f: string) => f.endsWith('.md'))
      .sort(); // Process in order

    let synced = 0;

    for (const file of files) {
      if (this.state.syncedOutbox.has(file)) continue;

      const srcPath = path.join(this.outboxDir, file);
      const destPath = path.join(this.msgsDir, file);

      try {
        // Read and optionally transform the message
        let content = fs.readFileSync(srcPath, 'utf-8');
        content = this.transformOutboundMessage(content);

        // Write to tx msgs directory (triggers Consumer)
        fs.writeFileSync(destPath, content);

        this.state.syncedOutbox.add(file);
        synced++;

        log.info(COMPONENT, 'Synced outbox message to tx', { file });
        console.log(`[repo-watcher] → ${file}`);

      } catch (err) {
        log.error(COMPONENT, 'Failed to sync outbox file', {
          file,
          error: String(err),
        });
      }
    }

    if (synced > 0) {
      this.saveState();
      log.info(COMPONENT, `Synced ${synced} messages from outbox`, { synced });
    }
  }

  /**
   * Transform outbound message if needed (e.g., ensure proper from identity)
   */
  private transformOutboundMessage(content: string): string {
    // Messages from the external repo are ready to go as-is
    // The /msg skill writes them in the correct format
    return content;
  }

  /**
   * Watch tx msgs dir for task-complete messages to bridge back to inbox
   */
  private startInboxWatcher(): void {
    this.inboxWatcher = watch(this.msgsDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200 },
    });

    this.inboxWatcher.on('add', (filepath: string) => {
      const filename = path.basename(filepath);
      if (!filename.endsWith('.md')) return;

      // Only bridge task-complete and ask-human messages back
      if (!filename.includes('task-complete') && !filename.includes('ask-human')) return;

      // Don't re-bridge files we synced from outbox
      if (this.state.syncedOutbox.has(filename)) return;

      // Check if already synced
      if (this.state.syncedInbox.has(filename)) return;

      this.bridgeToInbox(filepath, filename);
    });
  }

  /**
   * Copy a tx response message to the external repo inbox
   */
  private bridgeToInbox(filepath: string, filename: string): void {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const destPath = path.join(this.inboxDir, filename);

      fs.writeFileSync(destPath, content);
      this.state.syncedInbox.add(filename);

      log.info(COMPONENT, 'Bridged response to inbox', { filename });
      console.log(`[repo-watcher] ← ${filename}`);

      // Commit and push
      if (this.config.pushResponses) {
        this.commitAndPush(`inbox: ${filename}`);
      }

    } catch (err) {
      log.error(COMPONENT, 'Failed to bridge to inbox', {
        filename,
        error: String(err),
      });
    }
  }

  /**
   * Commit inbox changes and push to remote
   */
  private commitAndPush(message: string): void {
    try {
      this.git('add', 'inbox/');
      this.git('commit', '-m', message);

      // Push with retry
      let retries = 0;
      while (retries < 4) {
        try {
          this.git('push', this.config.remote, this.config.branch);
          return;
        } catch (err) {
          retries++;
          if (retries >= 4) throw err;
          const delay = Math.pow(2, retries) * 1000;
          log.warn(COMPONENT, `Push failed, retrying in ${delay}ms`, { retries });
          execSync(`sleep ${delay / 1000}`);
        }
      }

    } catch (err) {
      log.error(COMPONENT, 'Commit/push failed', { error: String(err) });
    }
  }

  /**
   * Execute a git command in the repo directory
   */
  private git(...args: string[]): string {
    const cmd = `git ${args.map(a => `"${a}"`).join(' ')}`;
    try {
      return execSync(cmd, {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || '';
      throw new Error(`git ${args[0]} failed: ${stderr}`);
    }
  }

  /**
   * Load persisted sync state
   */
  private loadState(): SyncState {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
        return {
          syncedOutbox: new Set(raw.syncedOutbox || []),
          syncedInbox: new Set(raw.syncedInbox || []),
          lastCommit: raw.lastCommit || null,
        };
      }
    } catch {
      log.warn(COMPONENT, 'Failed to load watcher state, starting fresh');
    }

    return {
      syncedOutbox: new Set(),
      syncedInbox: new Set(),
      lastCommit: null,
    };
  }

  /**
   * Persist sync state to disk
   */
  private saveState(): void {
    try {
      const data = {
        syncedOutbox: [...this.state.syncedOutbox],
        syncedInbox: [...this.state.syncedInbox],
        lastCommit: this.state.lastCommit,
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
    } catch (err) {
      log.error(COMPONENT, 'Failed to save watcher state', { error: String(err) });
    }
  }
}
