/**
 * tx watch - External repo watcher CLI command
 *
 * Bridges a remote git repo (Claude Code web) with the local tx instance.
 * Polls for new messages in the repo's outbox/, copies them to .ai/tx/msgs/,
 * and optionally pushes task-complete responses back to inbox/.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RepoWatcher } from '../external/repo-watcher.ts';
import { log } from '../shared/logger.ts';

interface WatchOptions {
  /** Path to external repo (local clone) */
  repo: string;
  /** Branch to watch (default: main) */
  branch?: string;
  /** Remote name (default: origin) */
  remote?: string;
  /** Poll interval in ms (default: 5000) */
  interval?: string;
  /** Disable pushing responses back */
  noPush?: boolean;
  /** Initialize a new external repo with skill template */
  init?: boolean;
}

export async function watchRepo(opts: WatchOptions): Promise<void> {
  if (!opts.repo) {
    console.error('Usage: tx watch <repo-path> [options]');
    console.error('Run tx watch -h for help');
    process.exit(1);
  }

  const repoPath = path.resolve(opts.repo);

  // Handle --init: set up the external repo with template files
  if (opts.init) {
    await initExternalRepo(repoPath);
    return;
  }

  // Validate repo exists and is a git repo
  if (!fs.existsSync(repoPath)) {
    console.error(`Repo path does not exist: ${repoPath}`);
    console.error('Use --init to create and initialize a new external repo.');
    process.exit(1);
  }

  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    console.error(`Not a git repository: ${repoPath}`);
    process.exit(1);
  }

  const txRoot = process.env.TX_CWD || process.cwd();

  const watcher = new RepoWatcher({
    repoPath,
    txRoot,
    branch: opts.branch,
    remote: opts.remote,
    pollInterval: opts.interval ? parseInt(opts.interval, 10) : undefined,
    pushResponses: !opts.noPush,
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[repo-watcher] Shutting down...');
    await watcher.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await watcher.start();

  // Keep alive
  await new Promise(() => {});
}

/**
 * Initialize a directory as an external repo with the /msg skill template
 */
async function initExternalRepo(repoPath: string): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const templateDir = path.join(__dirname, '..', '..', 'templates', 'external-repo');

  if (!fs.existsSync(templateDir)) {
    console.error('Template directory not found. Ensure templates/external-repo/ exists.');
    process.exit(1);
  }

  // Create repo dir if needed
  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath, { recursive: true });
  }

  // Copy template files recursively
  copyDir(templateDir, repoPath);

  console.log(`[repo-watcher] Initialized external repo at: ${repoPath}`);
  console.log('');
  console.log('Template files created:');
  console.log('  .claude/skills/msg/SKILL.md  - /msg skill for Claude Code web');
  console.log('  CLAUDE.md                    - Instructions for Claude Code web');
  console.log('  outbox/                      - Messages written here by /msg');
  console.log('  inbox/                       - Responses from tx land here');
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${repoPath}`);
  console.log('  git init && git add -A && git commit -m "init external repo"');
  console.log('  git remote add origin <your-github-url>');
  console.log('  git push -u origin main');
  console.log('');
  console.log('Then start watching:');
  console.log(`  tx watch ${repoPath}`);

  log.info('repo-watcher', 'Initialized external repo', { repoPath });
}

/**
 * Recursively copy a directory
 */
function copyDir(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
