/**
 * tx session - Session awareness CLI command
 *
 * View, search, and manage agent session history
 */

import { SessionStore, SessionSummarizer, type SessionMetadata, type SummaryType } from '../session/index.ts';
import { log } from '../shared/logger.ts';
import { chalk, colors } from '../shared/colors.ts';
import { formatTimeAgo, formatDuration, parseTimeFilter } from '../shared/time.ts';
import fs from 'node:fs';
import path from 'node:path';

interface SessionFlags {
  limit?: number;
  since?: string;
  summary?: boolean;
  finalAnswer?: boolean;
  full?: boolean;
  splitSummary?: boolean;
  dryRun?: boolean;
  olderThan?: string;
  json?: boolean;
}

/**
 * Parse command line flags from remaining args
 */
function parseFlags(args: string[]): SessionFlags {
  const flags: SessionFlags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--limit' && args[i + 1]) {
      flags.limit = parseInt(args[++i], 10);
    } else if (arg === '--since' && args[i + 1]) {
      flags.since = args[++i];
    } else if (arg === '--summary') {
      flags.summary = true;
    } else if (arg === '--final-answer') {
      flags.finalAnswer = true;
    } else if (arg === '--full') {
      flags.full = true;
    } else if (arg === '--split-summary') {
      flags.splitSummary = true;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--older-than' && args[i + 1]) {
      flags.olderThan = args[++i];
    } else if (arg === '--json') {
      flags.json = true;
    }
  }

  return flags;
}

/**
 * Parse time string like "7d", "30d", "365d" to days
 */
function parseDays(timeStr: string): number {
  const match = timeStr.match(/^(\d+)d$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  // Default to parsing as integer
  return parseInt(timeStr, 10) || 365;
}

/**
 * Parse selector: numeric index or partial session ID
 */
function parseSelector(selector: string): { type: 'index' | 'id'; value: number | string } {
  // Check if it's a pure number
  if (/^\d+$/.test(selector)) {
    return { type: 'index', value: parseInt(selector, 10) };
  }
  // Otherwise treat as partial ID
  return { type: 'id', value: selector };
}

/**
 * Format session status with color
 */
function formatStatus(status?: string): string {
  switch (status) {
    case 'success':
      return chalk.green('✓ success');
    case 'error':
      return chalk.red('✗ error');
    case 'abandoned':
      return chalk.yellow('⚠ abandoned');
    default:
      return chalk.dim('? unknown');
  }
}

/**
 * List sessions for an agent
 */
async function listSessions(store: SessionStore, agentId: string, flags: SessionFlags): Promise<void> {
  const limit = flags.limit || 10;
  let sessions: SessionMetadata[];

  if (flags.since) {
    const since = parseTimeFilter(flags.since);
    // Use basic list and filter since listSince might not exist
    sessions = store.listSessions(agentId, 1000).filter(s => s.startedAt >= since.getTime());
    sessions = sessions.slice(0, limit);
  } else {
    sessions = store.listSessions(agentId, limit);
  }

  if (flags.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (sessions.length === 0) {
    console.log(chalk.dim(`No sessions found for ${agentId}`));
    return;
  }

  console.log(`\n${chalk.bold(chalk.cyan(`Sessions for ${agentId}`))} ${chalk.dim(`(${sessions.length} results)`)}\n`);

  sessions.forEach((session, idx) => {
    const index = idx + 1;
    const time = formatTimeAgo(session.startedAt);
    const duration = session.durationSeconds ? formatDuration(session.durationSeconds * 1000) : '-';
    const status = formatStatus(session.finalStatus);
    const headline = session.headline || chalk.dim('No headline');
    const shortId = session.id.substring(0, 7);

    console.log(
      `${chalk.dim(String(index).padStart(2))}. ` +
      `${chalk.cyan(shortId)} ` +
      `${chalk.dim(time.padEnd(10))} ` +
      `${duration.padEnd(8)} ` +
      `${status.padEnd(20)} ` +
      `${headline}`
    );
  });

  console.log();
}

/**
 * Get a specific session
 */
async function getSession(
  store: SessionStore,
  agentId: string,
  selector: string | undefined,
  flags: SessionFlags
): Promise<void> {
  if (!selector) {
    console.error(chalk.red('Error: Selector required (session index or ID)'));
    console.log(chalk.dim('Example: tx session brain get 3'));
    return;
  }

  const parsed = parseSelector(selector);
  let session: SessionMetadata | null = null;

  if (parsed.type === 'index') {
    // Get by index - list sessions and pick by index
    const indexValue = parsed.value as number;
    const sessions = store.listSessions(agentId, indexValue);
    if (sessions.length >= indexValue) {
      session = sessions[indexValue - 1];
    }
  } else {
    // Get by partial ID - search for matching session
    const sessions = store.listSessions(agentId, 1000);
    session = sessions.find(s => s.id.includes(parsed.value as string)) ?? null;
  }

  if (!session) {
    console.error(chalk.red(`Session not found: ${selector}`));
    return;
  }

  if (flags.json) {
    const output: Record<string, unknown> = { ...session };

    // Add transcript content if requested
    if (flags.full && session.transcriptPath && fs.existsSync(session.transcriptPath)) {
      output.transcript = fs.readFileSync(session.transcriptPath, 'utf-8');
    }

    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Display session details
  console.log(`\n${chalk.bold(chalk.cyan('Session Details'))}\n`);
  console.log(`${chalk.dim('ID:'.padEnd(14))} ${session.id}`);
  console.log(`${chalk.dim('Agent:'.padEnd(14))} ${session.agentId}`);
  console.log(`${chalk.dim('Mesh:'.padEnd(14))} ${session.meshId}`);
  console.log(`${chalk.dim('Started:'.padEnd(14))} ${new Date(session.startedAt).toISOString()}`);
  if (session.endedAt) {
    console.log(`${chalk.dim('Ended:'.padEnd(14))} ${new Date(session.endedAt).toISOString()}`);
  }
  if (session.durationSeconds) {
    console.log(`${chalk.dim('Duration:'.padEnd(14))} ${formatDuration(session.durationSeconds * 1000)}`);
  }
  console.log(`${chalk.dim('Status:'.padEnd(14))} ${formatStatus(session.finalStatus)}`);
  if (session.messageCount) {
    console.log(`${chalk.dim('Messages:'.padEnd(14))} ${session.messageCount}`);
  }
  if (session.toolCalls) {
    console.log(`${chalk.dim('Tool Calls:'.padEnd(14))} ${session.toolCalls}`);
  }
  if (session.headline) {
    console.log(`${chalk.dim('Headline:'.padEnd(14))} ${session.headline}`);
  }
  if (session.tags?.length) {
    console.log(`${chalk.dim('Tags:'.padEnd(14))} ${session.tags.join(', ')}`);
  }

  console.log();

  // Handle output mode flags
  if (flags.full && session.transcriptPath) {
    console.log(`${chalk.bold('Transcript:')}\n`);
    if (fs.existsSync(session.transcriptPath)) {
      const content = fs.readFileSync(session.transcriptPath, 'utf-8');
      console.log(content);
    } else {
      console.log(chalk.dim('Transcript file not found'));
    }
  } else if (flags.summary || flags.finalAnswer || flags.splitSummary) {
    // Determine summary type
    const summaryType: SummaryType = flags.summary ? 'summary' :
                        flags.finalAnswer ? 'final-answer' :
                        'split-summary';

    const summarizer = new SessionSummarizer(store);

    try {
      console.log(chalk.dim('Generating summary...'));
      const summary = await summarizer.summarize(session.id, summaryType);

      const heading = flags.summary ? 'Summary' :
                      flags.finalAnswer ? 'Final Answer' :
                      'Split Summary';

      console.log(`\n${chalk.bold(heading + ':')}\n`);
      console.log(summary);
    } catch (err) {
      console.error(chalk.red('Failed to generate summary:'), err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Search sessions
 */
async function searchSessions(
  store: SessionStore,
  agentId: string,
  query: string | undefined,
  flags: SessionFlags
): Promise<void> {
  if (!query) {
    console.error(chalk.red('Error: Search query required'));
    console.log(chalk.dim('Example: tx session brain search "auth flow"'));
    return;
  }

  const limit = flags.limit || 10;
  const results = store.search(query, agentId, limit);

  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(chalk.dim(`No sessions found matching "${query}"`));
    return;
  }

  console.log(`\n${chalk.bold(chalk.cyan(`Search Results for "${query}"`))} ${chalk.dim(`(${results.length} matches)`)}\n`);

  results.forEach((result, idx) => {
    const index = idx + 1;
    const time = formatTimeAgo(result.startedAt);
    const shortId = result.id.substring(0, 7);
    const headline = result.headline || chalk.dim('No headline');
    const score = result.score ? chalk.dim(`[${result.score.toFixed(1)}]`) : '';

    console.log(
      `${chalk.dim(String(index).padStart(2))}. ` +
      `${chalk.cyan(shortId)} ` +
      `${chalk.dim(time.padEnd(10))} ` +
      `${score} ` +
      `${headline}`
    );

    if (result.snippet) {
      // Clean up the snippet display
      const cleanSnippet = result.snippet
        .replace(/<mark>/g, colors.yellow)
        .replace(/<\/mark>/g, colors.reset);
      console.log(`    ${chalk.dim('└─')} ${cleanSnippet}`);
    }
  });

  console.log();
}

/**
 * Prune old sessions
 */
async function pruneSessions(store: SessionStore, agentId: string, flags: SessionFlags): Promise<void> {
  const olderThanDays = flags.olderThan ? parseDays(flags.olderThan) : 365;
  const isDryRun = flags.dryRun ?? false;

  // Get sessions that would be pruned
  const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
  const allSessions = store.listSessions(agentId, 10000);
  const sessionsToDelete = allSessions.filter(s => s.startedAt < cutoff);

  if (flags.json) {
    console.log(JSON.stringify({
      dryRun: isDryRun,
      olderThanDays,
      cutoffDate: new Date(cutoff).toISOString(),
      sessionsToDelete: sessionsToDelete.length,
      sessions: sessionsToDelete
    }, null, 2));
    return;
  }

  if (sessionsToDelete.length === 0) {
    console.log(chalk.dim(`No sessions older than ${olderThanDays} days found for ${agentId}`));
    return;
  }

  console.log(`\n${chalk.bold(isDryRun ? chalk.yellow('DRY RUN: ') : '')}${chalk.cyan(`Prune Sessions for ${agentId}`)}\n`);
  console.log(`${chalk.dim('Older than:'.padEnd(14))} ${olderThanDays} days (before ${new Date(cutoff).toISOString().split('T')[0]})`);
  console.log(`${chalk.dim('Sessions:'.padEnd(14))} ${sessionsToDelete.length} to ${isDryRun ? 'delete (preview)' : 'be deleted'}`);
  console.log();

  // Show sessions to delete
  sessionsToDelete.slice(0, 20).forEach((session, idx) => {
    const date = new Date(session.startedAt).toISOString().split('T')[0];
    const shortId = session.id.substring(0, 7);
    const headline = session.headline || chalk.dim('No headline');

    console.log(`  ${chalk.dim(String(idx + 1).padStart(2))}. ${chalk.cyan(shortId)} ${chalk.dim(date)} ${headline}`);
  });

  if (sessionsToDelete.length > 20) {
    console.log(chalk.dim(`  ... and ${sessionsToDelete.length - 20} more`));
  }

  console.log();

  if (isDryRun) {
    console.log(chalk.yellow('This was a dry run. No sessions were deleted.'));
    console.log(chalk.dim('Remove --dry-run to actually delete sessions.'));
  } else {
    // Actually prune (the SessionStore doesn't have agent-specific prune, so we do it manually)
    // Delete session by session
    const db = store.getDb();
    const sessionIds = sessionsToDelete.map(s => s.id);
    const placeholders = sessionIds.map(() => '?').join(',');

    // Delete from FTS
    db.prepare(`DELETE FROM sessions_fts WHERE session_id IN (${placeholders})`).run(...sessionIds);

    // Delete summaries
    db.prepare(`DELETE FROM session_summaries WHERE session_id IN (${placeholders})`).run(...sessionIds);

    // Delete sessions
    db.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...sessionIds);

    // Also delete transcript files
    let filesDeleted = 0;
    for (const session of sessionsToDelete) {
      if (session.transcriptPath && fs.existsSync(session.transcriptPath)) {
        try {
          fs.unlinkSync(session.transcriptPath);
          filesDeleted++;
        } catch {
          // Ignore file deletion errors
        }
      }
    }

    console.log(chalk.green(`✓ Deleted ${sessionsToDelete.length} sessions`));
    if (filesDeleted > 0) {
      console.log(chalk.dim(`  Also removed ${filesDeleted} transcript files`));
    }
  }

  console.log();
}

/**
 * Print usage help
 */
function printUsage(): void {
  console.log(`
${chalk.bold('Usage:')} tx session <mesh> <action> [selector] [options]

${chalk.bold('Actions:')}
  ${chalk.cyan('list')}                    List recent sessions
  ${chalk.cyan('get')} <selector>          Get specific session
  ${chalk.cyan('search')} <query>          Search sessions
  ${chalk.cyan('prune')}                   Clean old sessions

${chalk.bold('Selectors:')}
  ${chalk.dim('3')}                       3rd most recent session
  ${chalk.dim('3bad3')}                   Session ID containing "3bad3"

${chalk.bold('Options:')}
  ${chalk.dim('--limit N')}               Limit results (default: 10)
  ${chalk.dim('--since 7d')}              Filter by date
  ${chalk.dim('--summary')}               Condensed summary (~200 tokens)
  ${chalk.dim('--final-answer')}          Just the final output
  ${chalk.dim('--full')}                  Complete transcript
  ${chalk.dim('--split-summary')}         Intro + summarized latter half
  ${chalk.dim('--json')}                  Output as JSON
  ${chalk.dim('--older-than 365d')}       For prune: age threshold
  ${chalk.dim('--dry-run')}               Preview without deleting

${chalk.bold('Examples:')}
  tx session brain list
  tx session brain get 3 --summary
  tx session brain search "auth flow"
  tx session brain prune --older-than 365d --dry-run
`);
}

/**
 * Main session command entry point
 */
export async function session(args: string[]): Promise<void> {
  const [mesh, action, selector, ...rest] = args;
  const flags = parseFlags(rest.concat(selector?.startsWith('--') ? [selector] : []));

  // Adjust selector if it was actually a flag
  const actualSelector = selector?.startsWith('--') ? undefined : selector;

  if (!mesh || !action) {
    printUsage();
    return;
  }

  const cwd = process.env.TX_CWD || process.cwd();
  const dbPath = path.join(cwd, '.ai/tx/data/sessions.db');

  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.log(chalk.yellow('⚠ No session database found at:'), dbPath);
    console.log(chalk.dim('Sessions are recorded when agents complete tasks.'));
    return;
  }

  const store = new SessionStore(dbPath);

  try {
    // Normalize agentId: "brain" -> "brain/brain", "dev/worker" stays as-is
    const agentId = mesh.includes('/') ? mesh : `${mesh}/${mesh}`;

    switch (action) {
      case 'list':
        await listSessions(store, agentId, flags);
        break;
      case 'get':
        await getSession(store, agentId, actualSelector, flags);
        break;
      case 'search':
        await searchSessions(store, agentId, actualSelector, flags);
        break;
      case 'prune':
        await pruneSessions(store, agentId, flags);
        break;
      default:
        console.error(chalk.red(`Unknown action: ${action}`));
        printUsage();
    }
  } catch (err) {
    log.error('cli-session', 'Session command failed', {
      action,
      mesh,
      error: err instanceof Error ? err.message : String(err)
    });
    console.error(chalk.red('Error:'), err instanceof Error ? err.message : String(err));
  } finally {
    store.close();
  }
}
