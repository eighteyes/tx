/**
 * tx msg - View and interact with messages
 *
 * Features:
 * - Interactive mode with vim-style navigation
 * - Auto-follow for real-time updates (always on)
 * - Filter by type, agent, mesh, time
 * - JSON output mode
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { watch, type FSWatcher } from 'chokidar';
import { colors } from '../shared/colors.ts';
import { formatTime, parseTimeFilter } from '../shared/time.ts';

/**
 * Word wrap text to fit terminal width
 * Preserves existing line breaks, wraps long lines at word boundaries
 */
function wrapText(text: string, width?: number): string[] {
  const termWidth = width || process.stdout.columns || 80;
  const maxWidth = Math.max(40, termWidth - 4); // Leave some margin

  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= maxWidth) {
      lines.push(paragraph);
      continue;
    }

    // Wrap long lines at word boundaries
    let remaining = paragraph;
    while (remaining.length > maxWidth) {
      // Find last space before maxWidth
      let breakPoint = remaining.lastIndexOf(' ', maxWidth);
      if (breakPoint <= 0) {
        // No space found, hard break
        breakPoint = maxWidth;
      }
      lines.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trimStart();
    }
    if (remaining) {
      lines.push(remaining);
    }
  }

  return lines;
}

// Message type colors
const typeColors: Record<string, string> = {
  'task': colors.cyan,
  'ask': colors.yellow,
  'ask-response': colors.green,
  'ask-human': colors.yellow,
  'task-complete': colors.magenta,
  'update': colors.blue,
  'error': colors.red,
  'system-prompt': colors.dim
};

interface ParsedMessage {
  filepath: string;
  filename: string;
  timestamp: string;
  from: string;
  to: string;
  type: string;
  msgId: string;
  headline: string;
  status: string;
  content: string;
  rearmatter: Record<string, unknown> | null;
}

interface ParsedSession {
  filepath: string;
  filename: string;
  agentId: string;
  timestamp: string;
  content: string;
}

interface ParsedPrompt {
  filepath: string;
  filename: string;
  agentId: string;
  model: string;
  timestamp: string;
  content: string;
}

interface MsgOptions {
  type?: string;
  agent?: string;
  mesh?: string;
  since?: string;
  before?: string;
  limit?: string;
  json?: boolean;
  interactive?: boolean;
  verbose?: boolean;
  errors?: boolean;
  showPrompts?: boolean;
}

/**
 * Parse message file
 */
async function readMessage(filepath: string): Promise<ParsedMessage | null> {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const parts = content.split(/^---$/m);
    if (parts.length < 3) return null;

    const frontmatter = parseFrontmatter(parts[1].trim());

    // Use file creation time for reliable ordering (LLMs hallucinate timestamps)
    const stat = fs.statSync(filepath);
    const timestamp = stat.birthtime.toISOString();

    // Check if last part looks like structured YAML (has key: value lines)
    // LLMs often use --- as markdown horizontal rules in body content
    const lastPart = parts[parts.length - 1].trim();
    const looksLikeYaml = lastPart.split('\n').some(line => /^[a-zA-Z_-]+:\s*.+/.test(line));

    let body: string;
    let rearmatter: Record<string, unknown> | null = null;

    if (parts.length >= 4 && looksLikeYaml) {
      // Last part is rearmatter, everything else is body
      body = parts.slice(2, -1).join('---').trim();
      rearmatter = parseRearmatter(lastPart);
    } else {
      // No rearmatter, everything after frontmatter is body
      body = parts.slice(2).join('---').trim();
    }

    return {
      filepath,
      filename: path.basename(filepath),
      timestamp,
      from: frontmatter.from || '?',
      to: frontmatter.to || '?',
      type: frontmatter.type || 'unknown',
      msgId: frontmatter['msg-id'] || 'unknown',
      headline: frontmatter.headline || '',
      status: frontmatter.status || '',
      content: body,
      rearmatter
    };
  } catch {
    return null;
  }
}

function parseFrontmatter(yaml: string): Record<string, string> {
  const data: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      data[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return data;
}

function parseRearmatter(yaml: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const line of yaml.split('\n')) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const raw = match[2].trim();
    if (/^-?\d+\.?\d*$/.test(raw)) {
      data[key] = parseFloat(raw);
    } else if (raw.startsWith('{') || raw.startsWith('[')) {
      try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
    } else {
      data[key] = raw;
    }
  }
  return data;
}

/**
 * Build the prompt that would be injected into the agent for this message
 * Mirrors sdk-runner.ts buildUserPrompt logic
 */
function buildInjectedPrompt(msg: ParsedMessage, msgsDir: string): string {
  const parts: string[] = [];

  // Read the original message file to extract command frontmatter
  const filepath = msg.filepath;
  let command: string | undefined;

  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const commandMatch = fmMatch[1].match(/^command:\s*(.+)$/m);
      if (commandMatch) {
        command = commandMatch[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // File may not exist
  }

  // If command specified, lead with it raw (exactly as sdk-runner does)
  if (command) {
    parts.push(command);
    parts.push('');
  }

  parts.push('## Task Context');
  parts.push('');
  parts.push(`**From**: ${msg.from}`);
  parts.push(`**Type**: ${msg.type}`);
  if (msg.headline) {
    parts.push(`**Headline**: ${msg.headline}`);
  }
  if (msg.content) {
    parts.push('');
    parts.push(msg.content);
  }

  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(`Write response messages to: ${msgsDir}/`);
  parts.push('When done, write a task-complete message to core/core.');

  return parts.join('\n');
}

/**
 * Get all sessions from .ai/tx/sessions/
 */
async function getAllSessions(sessionsDir: string): Promise<ParsedSession[]> {
  if (!fs.existsSync(sessionsDir)) return [];

  const sessions: ParsedSession[] = [];

  // Sessions are stored in subdirectories by agent ID
  const agentDirs = fs.readdirSync(sessionsDir);

  for (const agentDir of agentDirs) {
    const agentPath = path.join(sessionsDir, agentDir);
    if (!fs.statSync(agentPath).isDirectory()) continue;

    // Convert directory name back to agentId by replacing LAST dash with slash
    // e.g., deep-research-analyst -> deep-research/analyst
    const agentId = agentDir.replace(/-([^-]+)$/, '/$1');
    const files = fs.readdirSync(agentPath);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filepath = path.join(agentPath, file);
      const content = fs.readFileSync(filepath, 'utf-8');

      // Parse timestamp from filename (e.g., 2025-12-10T12-34-56-789Z.md)
      // Convert: 2025-12-10T12-34-56-789Z -> 2025-12-10T12:34:56.789Z
      const filenameWithoutExt = file.replace('.md', '');
      const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z?$/.test(filenameWithoutExt)
        ? filenameWithoutExt.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z?$/, 'T$1:$2:$3.$4Z')
        : new Date().toISOString();

      sessions.push({
        filepath,
        filename: file,
        agentId,
        timestamp,
        content
      });
    }
  }

  return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Get all prompts from .ai/tx/prompts/
 * Prompts are stored in subdirectories: prompts/mesh/agent.md
 */
async function getAllPrompts(promptsDir: string): Promise<ParsedPrompt[]> {
  if (!fs.existsSync(promptsDir)) return [];

  const prompts: ParsedPrompt[] = [];

  // Recursively read mesh subdirectories
  function readPromptsRecursive(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        readPromptsRecursive(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const parts = content.split(/^---$/m);

          let frontmatter: Record<string, string> = {};
          let body = content;

          if (parts.length >= 3) {
            frontmatter = parseFrontmatter(parts[1].trim());
            body = parts.slice(2).join('---').trim();
          }

          // Extract agentId from path: prompts/mesh/agent.md -> mesh/agent
          const relativePath = path.relative(promptsDir, fullPath);
          const agentId = frontmatter.agent || relativePath.replace('.md', '');

          // Use file stat for timestamp if not in frontmatter
          const stat = fs.statSync(fullPath);
          const timestamp = frontmatter.timestamp || stat.birthtime.toISOString();

          prompts.push({
            filepath: fullPath,
            filename: entry.name,
            agentId,
            model: frontmatter.model || 'unknown',
            timestamp,
            content: body
          });
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  readPromptsRecursive(promptsDir);

  return prompts.sort((a, b) => a.agentId.localeCompare(b.agentId));
}

/**
 * Check if message matches filters
 */
function matchesFilter(msg: ParsedMessage, options: MsgOptions): boolean {
  if (options.type && msg.type !== options.type) return false;

  if (options.agent) {
    const agent = options.agent.toLowerCase();
    const fromMatch = msg.from.toLowerCase().includes(agent);
    const toMatch = msg.to.toLowerCase().includes(agent);
    if (!fromMatch && !toMatch) return false;
  }

  if (options.mesh) {
    const mesh = options.mesh.toLowerCase();
    const fromMatch = msg.from.toLowerCase().includes(mesh);
    const toMatch = msg.to.toLowerCase().includes(mesh);
    if (!fromMatch && !toMatch) return false;
  }

  if (options.errors && msg.type !== 'error') return false;

  if (options.since) {
    const since = parseTimeFilter(options.since);
    if (new Date(msg.timestamp) < since) return false;
  }

  if (options.before) {
    const before = parseTimeFilter(options.before);
    if (new Date(msg.timestamp) > before) return false;
  }

  return true;
}

/**
 * Get message badge
 */
function getMessageBadge(msg: ParsedMessage): string {
  if (msg.type === 'error' || msg.status === 'failed') {
    return `${colors.red}✗${colors.reset}`;
  }
  return ' ';
}

/**
 * Display a single message (list view)
 */
function displayMessage(msg: ParsedMessage, options: MsgOptions = {}): void {
  const badge = getMessageBadge(msg);
  const time = formatTime(msg.timestamp);
  const typeColor = typeColors[msg.type] || colors.white;
  const type = msg.type.padEnd(14);
  const from = msg.from.padEnd(25);
  const to = msg.to.padEnd(25);

  let line = `${badge} ${colors.dim}${time}${colors.reset} ${typeColor}${type}${colors.reset} ${from} ${colors.dim}→${colors.reset} ${to}`;

  if (msg.headline) {
    line += ` ${colors.bright}${msg.headline}${colors.reset}`;
  }

  console.log(line);

  if (options.verbose && msg.content) {
    const preview = msg.content.substring(0, 100).replace(/\n/g, ' ');
    console.log(`  ${colors.dim}${preview}${preview.length < msg.content.length ? '...' : ''}${colors.reset}`);
  }
}

/**
 * Get all messages from directory
 */
async function getAllMessages(logDir: string): Promise<ParsedMessage[]> {
  if (!fs.existsSync(logDir)) return [];

  const files = fs.readdirSync(logDir);
  const messages: ParsedMessage[] = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const msg = await readMessage(path.join(logDir, file));
    if (msg) messages.push(msg);
  }

  return messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Interactive mode with vim-style navigation
 */
async function msgInteractive(logDir: string, options: MsgOptions = {}): Promise<void> {
  const sessionsDir = path.join(path.dirname(logDir), 'sessions');
  const sysMsgsDir = path.join(path.dirname(logDir), 'sys-msgs');

  let messages = await getAllMessages(logDir);
  messages = messages.filter(msg => matchesFilter(msg, options));
  const limit = parseInt(options.limit || '50');
  messages = messages.slice(-limit);

  let sessions = await getAllSessions(sessionsDir);
  if (options.agent) {
    sessions = sessions.filter(s => s.agentId.toLowerCase().includes(options.agent!.toLowerCase()));
  }

  // Load system messages (quality feedback, etc.)
  let systemMessages = await getAllMessages(sysMsgsDir);
  systemMessages = systemMessages.filter(msg => matchesFilter(msg, options));
  systemMessages = systemMessages.slice(-limit);

  // Load built prompts
  const promptsDir = path.join(path.dirname(logDir), 'prompts');
  let prompts = await getAllPrompts(promptsDir);
  if (options.agent) {
    prompts = prompts.filter(p => p.agentId.toLowerCase().includes(options.agent!.toLowerCase()));
  }

  if (messages.length === 0 && sessions.length === 0 && systemMessages.length === 0 && prompts.length === 0) {
    console.log(`${colors.dim}No messages, sessions, system messages, or prompts found matching filters.${colors.reset}\n`);
    return;
  }

  // View modes: 'messages' | 'sessions' | 'system' | 'prompts'
  let viewMode: 'messages' | 'sessions' | 'system' | 'prompts' = 'messages';
  let selectedIndex = messages.length > 0 ? messages.length - 1 : 0;
  let sessionSelectedIndex = sessions.length > 0 ? 0 : 0;
  let systemSelectedIndex = systemMessages.length > 0 ? systemMessages.length - 1 : 0;
  let promptSelectedIndex = 0;
  let viewingDetail = false;
  let viewingPrompt = false;
  let detailScrollOffset = 0;
  let watcher: FSWatcher | null = null;
  let sysWatcher: FSWatcher | null = null;
  let promptsWatcher: FSWatcher | null = null;

  function clearScreen(): void {
    console.clear();
  }

  function displayMessageList(): void {
    clearScreen();

    // Tab bar
    const msgTab = viewMode === 'messages'
      ? `${colors.bright}${colors.cyan}[📨 Messages (${messages.length})]${colors.reset}`
      : `${colors.dim}📨 Messages (${messages.length})${colors.reset}`;
    const sessTab = viewMode === 'sessions'
      ? `${colors.bright}${colors.green}[📋 Sessions (${sessions.length})]${colors.reset}`
      : `${colors.dim}📋 Sessions (${sessions.length})${colors.reset}`;
    const sysTab = viewMode === 'system'
      ? `${colors.bright}${colors.yellow}[📢 System (${systemMessages.length})]${colors.reset}`
      : `${colors.dim}📢 System (${systemMessages.length})${colors.reset}`;
    const promptTab = viewMode === 'prompts'
      ? `${colors.bright}${colors.magenta}[🤖 Prompts (${prompts.length})]${colors.reset}`
      : `${colors.dim}🤖 Prompts (${prompts.length})${colors.reset}`;
    console.log(`\n${msgTab}  ${sessTab}  ${sysTab}  ${promptTab}  ${colors.dim}Tab/s switch${colors.reset}`);

    const controls = `${colors.dim}↑↓/jk nav  Enter/→/l view  p prompt  q quit${colors.reset}`;
    console.log(`${controls}\n`);

    if (messages.length === 0) {
      console.log(`${colors.dim}No messages found.${colors.reset}`);
      return;
    }

    const visibleStart = Math.max(0, selectedIndex - 15);
    const visibleEnd = Math.min(messages.length, selectedIndex + 10);

    for (let i = visibleStart; i < visibleEnd; i++) {
      const msg = messages[i];
      const isSelected = i === selectedIndex;

      if (isSelected) {
        process.stdout.write(`${colors.bright}${colors.cyan}▶ ${colors.reset}`);
      } else {
        process.stdout.write('  ');
      }

      const badge = getMessageBadge(msg);
      const time = formatTime(msg.timestamp);
      const typeColor = typeColors[msg.type] || colors.white;
      const type = msg.type.padEnd(12);
      const from = msg.from.padEnd(20);
      const to = msg.to.padEnd(20);
      const headline = msg.headline ? ` ${msg.headline.substring(0, 40)}` : '';

      console.log(`${badge} ${colors.dim}${time}${colors.reset} ${typeColor}${type}${colors.reset} ${from} ${colors.dim}→${colors.reset} ${to}${headline}`);
    }

    console.log();
  }

  function displaySessionList(): void {
    clearScreen();

    // Tab bar
    const msgTab = viewMode === 'messages'
      ? `${colors.bright}${colors.cyan}[📨 Messages (${messages.length})]${colors.reset}`
      : `${colors.dim}📨 Messages (${messages.length})${colors.reset}`;
    const sessTab = viewMode === 'sessions'
      ? `${colors.bright}${colors.green}[📋 Sessions (${sessions.length})]${colors.reset}`
      : `${colors.dim}📋 Sessions (${sessions.length})${colors.reset}`;
    const sysTab = viewMode === 'system'
      ? `${colors.bright}${colors.yellow}[📢 System (${systemMessages.length})]${colors.reset}`
      : `${colors.dim}📢 System (${systemMessages.length})${colors.reset}`;
    const promptTab = viewMode === 'prompts'
      ? `${colors.bright}${colors.magenta}[🤖 Prompts (${prompts.length})]${colors.reset}`
      : `${colors.dim}🤖 Prompts (${prompts.length})${colors.reset}`;
    console.log(`\n${msgTab}  ${sessTab}  ${sysTab}  ${promptTab}  ${colors.dim}Tab/s switch${colors.reset}`);

    const controls = `${colors.dim}↑↓/jk nav  Enter/→/l view  q quit${colors.reset}`;
    console.log(`${controls}\n`);

    if (sessions.length === 0) {
      console.log(`${colors.dim}No sessions captured yet.${colors.reset}`);
      console.log(`${colors.dim}Sessions are saved when workers complete their tasks.${colors.reset}`);
      return;
    }

    const visibleStart = Math.max(0, sessionSelectedIndex - 15);
    const visibleEnd = Math.min(sessions.length, sessionSelectedIndex + 10);

    for (let i = visibleStart; i < visibleEnd; i++) {
      const sess = sessions[i];
      const isSelected = i === sessionSelectedIndex;

      if (isSelected) {
        process.stdout.write(`${colors.bright}${colors.green}▶ ${colors.reset}`);
      } else {
        process.stdout.write('  ');
      }

      const time = formatTime(sess.timestamp);
      const agent = sess.agentId.padEnd(25);
      const preview = sess.content.split('\n').slice(5, 6).join('').substring(0, 50);

      console.log(`${colors.dim}${time}${colors.reset} ${colors.green}${agent}${colors.reset} ${colors.dim}${preview}...${colors.reset}`);
    }

    console.log();
  }

  function displaySystemList(): void {
    clearScreen();

    // Tab bar
    const msgTab = viewMode === 'messages'
      ? `${colors.bright}${colors.cyan}[📨 Messages (${messages.length})]${colors.reset}`
      : `${colors.dim}📨 Messages (${messages.length})${colors.reset}`;
    const sessTab = viewMode === 'sessions'
      ? `${colors.bright}${colors.green}[📋 Sessions (${sessions.length})]${colors.reset}`
      : `${colors.dim}📋 Sessions (${sessions.length})${colors.reset}`;
    const sysTab = viewMode === 'system'
      ? `${colors.bright}${colors.yellow}[📢 System (${systemMessages.length})]${colors.reset}`
      : `${colors.dim}📢 System (${systemMessages.length})${colors.reset}`;
    const promptTab = viewMode === 'prompts'
      ? `${colors.bright}${colors.magenta}[🤖 Prompts (${prompts.length})]${colors.reset}`
      : `${colors.dim}🤖 Prompts (${prompts.length})${colors.reset}`;
    console.log(`\n${msgTab}  ${sessTab}  ${sysTab}  ${promptTab}  ${colors.dim}Tab/s switch${colors.reset}`);

    const controls = `${colors.dim}↑↓/jk nav  Enter/→/l view  q quit${colors.reset}`;
    console.log(`${controls}\n`);

    if (systemMessages.length === 0) {
      console.log(`${colors.dim}No system messages yet.${colors.reset}`);
      console.log(`${colors.dim}System messages include quality gate feedback and internal notifications.${colors.reset}`);
      return;
    }

    const visibleStart = Math.max(0, systemSelectedIndex - 15);
    const visibleEnd = Math.min(systemMessages.length, systemSelectedIndex + 10);

    for (let i = visibleStart; i < visibleEnd; i++) {
      const msg = systemMessages[i];
      const isSelected = i === systemSelectedIndex;

      if (isSelected) {
        process.stdout.write(`${colors.bright}${colors.yellow}▶ ${colors.reset}`);
      } else {
        process.stdout.write('  ');
      }

      const badge = getMessageBadge(msg);
      const time = formatTime(msg.timestamp);
      const typeColor = typeColors[msg.type] || colors.white;
      const type = msg.type.padEnd(12);
      const from = msg.from.padEnd(20);
      const to = msg.to.padEnd(20);
      const headline = msg.headline ? ` ${msg.headline.substring(0, 40)}` : '';

      console.log(`${badge} ${colors.dim}${time}${colors.reset} ${typeColor}${type}${colors.reset} ${from} ${colors.dim}→${colors.reset} ${to}${headline}`);
    }

    console.log();
  }

  function displaySystemDetail(): void {
    clearScreen();

    const msg = systemMessages[systemSelectedIndex];
    console.log(`\n${colors.bright}${colors.yellow}📢 System Message${colors.reset} ${colors.dim}(${systemSelectedIndex + 1}/${systemMessages.length})${colors.reset}`);
    console.log(`${colors.dim}↑↓/jk scroll  ←/h/Esc/q back${colors.reset}\n`);

    // Metadata
    console.log(`${colors.dim}Time:${colors.reset}     ${formatTime(msg.timestamp)}`);
    console.log(`${colors.dim}Type:${colors.reset}     ${msg.type}`);
    console.log(`${colors.dim}From:${colors.reset}     ${msg.from}`);
    console.log(`${colors.dim}To:${colors.reset}       ${msg.to}`);
    if (msg.headline) console.log(`${colors.dim}Headline:${colors.reset} ${msg.headline}`);
    if (msg.msgId) console.log(`${colors.dim}Msg ID:${colors.reset}   ${msg.msgId}`);

    // Rearmatter
    if (msg.rearmatter) {
      console.log();
      console.log(`${colors.bright}${colors.yellow}Rearmatter${colors.reset}`);
      if (msg.rearmatter.confidence !== undefined) {
        const conf = msg.rearmatter.confidence as number;
        const confColor = conf >= 0.9 ? colors.green : conf >= 0.7 ? colors.yellow : colors.red;
        console.log(`${colors.dim}Confidence:${colors.reset} ${confColor}${(conf * 100).toFixed(0)}%${colors.reset}`);
      }
      if (msg.rearmatter.grade) {
        const grade = msg.rearmatter.grade as string;
        const gradeColor = ['A', 'B'].includes(grade) ? colors.green : ['C'].includes(grade) ? colors.yellow : colors.red;
        console.log(`${colors.dim}Grade:${colors.reset}      ${gradeColor}${grade}${colors.reset}`);
      }
    }

    console.log();
    console.log(colors.dim + '─'.repeat(80) + colors.reset);
    console.log();

    // Content (scrollable, word-wrapped)
    const content = msg.content || colors.dim + 'No content' + colors.reset;
    const contentLines = wrapText(content);
    const viewportHeight = Math.max(10, (process.stdout.rows || 40) - 20);
    const maxScroll = Math.max(0, contentLines.length - viewportHeight);

    detailScrollOffset = Math.max(0, Math.min(detailScrollOffset, maxScroll));

    const visibleLines = contentLines.slice(detailScrollOffset, detailScrollOffset + viewportHeight);
    visibleLines.forEach(line => console.log(line));

    if (contentLines.length > viewportHeight) {
      const scrollPercent = maxScroll > 0 ? Math.round((detailScrollOffset / maxScroll) * 100) : 0;
      console.log();
      console.log(`${colors.dim}[${scrollPercent}%] Line ${detailScrollOffset + 1}-${Math.min(detailScrollOffset + viewportHeight, contentLines.length)} of ${contentLines.length}${colors.reset}`);
    }
  }

  function displayDetail(): void {
    clearScreen();

    const msg = messages[selectedIndex];
    console.log(`\n${colors.bright}${colors.cyan}📨 Message Detail${colors.reset} ${colors.dim}(${selectedIndex + 1}/${messages.length})${colors.reset}`);
    console.log(`${colors.dim}↑↓/jk scroll  ←/h/Esc/q back  p prompt${colors.reset}\n`);

    // Metadata
    console.log(`${colors.dim}Time:${colors.reset}     ${formatTime(msg.timestamp)}`);
    console.log(`${colors.dim}Type:${colors.reset}     ${msg.type}`);
    console.log(`${colors.dim}From:${colors.reset}     ${msg.from}`);
    console.log(`${colors.dim}To:${colors.reset}       ${msg.to}`);
    if (msg.headline) console.log(`${colors.dim}Headline:${colors.reset} ${msg.headline}`);
    if (msg.msgId) console.log(`${colors.dim}Msg ID:${colors.reset}   ${msg.msgId}`);

    // Rearmatter
    if (msg.rearmatter) {
      console.log();
      console.log(`${colors.bright}${colors.yellow}Rearmatter${colors.reset}`);
      if (msg.rearmatter.confidence !== undefined) {
        const conf = msg.rearmatter.confidence as number;
        const confColor = conf >= 0.9 ? colors.green : conf >= 0.7 ? colors.yellow : colors.red;
        console.log(`${colors.dim}Confidence:${colors.reset} ${confColor}${(conf * 100).toFixed(0)}%${colors.reset}`);
      }
      if (msg.rearmatter.grade) {
        const grade = msg.rearmatter.grade as string;
        const gradeColor = ['A', 'B'].includes(grade) ? colors.green : ['C'].includes(grade) ? colors.yellow : colors.red;
        console.log(`${colors.dim}Grade:${colors.reset}      ${gradeColor}${grade}${colors.reset}`);
      }
    }

    console.log();
    console.log(colors.dim + '─'.repeat(80) + colors.reset);
    console.log();

    // Content (scrollable, word-wrapped)
    const content = msg.content || colors.dim + 'No content' + colors.reset;
    const contentLines = wrapText(content);
    const viewportHeight = Math.max(10, (process.stdout.rows || 40) - 20);
    const maxScroll = Math.max(0, contentLines.length - viewportHeight);

    detailScrollOffset = Math.max(0, Math.min(detailScrollOffset, maxScroll));

    const visibleLines = contentLines.slice(detailScrollOffset, detailScrollOffset + viewportHeight);
    visibleLines.forEach(line => console.log(line));

    if (contentLines.length > viewportHeight) {
      const scrollPercent = maxScroll > 0 ? Math.round((detailScrollOffset / maxScroll) * 100) : 0;
      console.log();
      console.log(`${colors.dim}[${scrollPercent}%] Line ${detailScrollOffset + 1}-${Math.min(detailScrollOffset + viewportHeight, contentLines.length)} of ${contentLines.length}${colors.reset}`);
    }
  }

  function displayPromptView(): void {
    clearScreen();

    const msg = messages[selectedIndex];
    console.log(`\n${colors.bright}${colors.yellow}📝 Injected Prompt${colors.reset} ${colors.dim}(${selectedIndex + 1}/${messages.length})${colors.reset}`);
    console.log(`${colors.dim}↑↓/jk scroll  ←/h/Esc/q back${colors.reset}\n`);

    // Show what prompt would be injected for this message
    console.log(`${colors.dim}To:${colors.reset} ${msg.to}`);
    console.log(`${colors.dim}Type:${colors.reset} ${msg.type}`);
    console.log();
    console.log(colors.dim + '═'.repeat(80) + colors.reset);
    console.log(`${colors.bright}${colors.yellow}PROMPT THAT WOULD BE INJECTED:${colors.reset}`);
    console.log(colors.dim + '═'.repeat(80) + colors.reset);
    console.log();

    // Build the injected prompt (word-wrapped)
    const prompt = buildInjectedPrompt(msg, logDir);
    const promptLines = wrapText(prompt);
    const viewportHeight = Math.max(10, (process.stdout.rows || 40) - 15);
    const maxScroll = Math.max(0, promptLines.length - viewportHeight);

    detailScrollOffset = Math.max(0, Math.min(detailScrollOffset, maxScroll));

    const visibleLines = promptLines.slice(detailScrollOffset, detailScrollOffset + viewportHeight);
    visibleLines.forEach(line => console.log(line));

    if (promptLines.length > viewportHeight) {
      const scrollPercent = maxScroll > 0 ? Math.round((detailScrollOffset / maxScroll) * 100) : 0;
      console.log();
      console.log(`${colors.dim}[${scrollPercent}%] Line ${detailScrollOffset + 1}-${Math.min(detailScrollOffset + viewportHeight, promptLines.length)} of ${promptLines.length}${colors.reset}`);
    }
  }

  function displaySessionDetail(): void {
    clearScreen();

    const sess = sessions[sessionSelectedIndex];
    console.log(`\n${colors.bright}${colors.green}📋 Session Output${colors.reset} ${colors.dim}(${sessionSelectedIndex + 1}/${sessions.length})${colors.reset}`);
    console.log(`${colors.dim}↑↓/jk scroll  ←/h/Esc/q back${colors.reset}\n`);

    // Metadata
    console.log(`${colors.dim}Agent:${colors.reset}    ${colors.green}${sess.agentId}${colors.reset}`);
    console.log(`${colors.dim}Time:${colors.reset}     ${formatTime(sess.timestamp)}`);
    console.log(`${colors.dim}File:${colors.reset}     ${sess.filepath}`);

    console.log();
    console.log(colors.dim + '─'.repeat(80) + colors.reset);
    console.log();

    // Content (scrollable, word-wrapped)
    const contentLines = wrapText(sess.content);
    const viewportHeight = Math.max(10, (process.stdout.rows || 40) - 12);
    const maxScroll = Math.max(0, contentLines.length - viewportHeight);

    detailScrollOffset = Math.max(0, Math.min(detailScrollOffset, maxScroll));

    const visibleLines = contentLines.slice(detailScrollOffset, detailScrollOffset + viewportHeight);
    visibleLines.forEach(line => console.log(line));

    if (contentLines.length > viewportHeight) {
      const scrollPercent = maxScroll > 0 ? Math.round((detailScrollOffset / maxScroll) * 100) : 0;
      console.log();
      console.log(`${colors.dim}[${scrollPercent}%] Line ${detailScrollOffset + 1}-${Math.min(detailScrollOffset + viewportHeight, contentLines.length)} of ${contentLines.length}${colors.reset}`);
    }
  }

  function display(): void {
    if (viewingPrompt) {
      displayPromptView();
    } else if (viewingDetail) {
      if (viewMode === 'sessions') {
        displaySessionDetail();
      } else if (viewMode === 'system') {
        displaySystemDetail();
      } else if (viewMode === 'prompts') {
        displayPromptDetail();
      } else {
        displayDetail();
      }
    } else {
      if (viewMode === 'sessions') {
        displaySessionList();
      } else if (viewMode === 'system') {
        displaySystemList();
      } else if (viewMode === 'prompts') {
        displayPromptList();
      } else {
        displayMessageList();
      }
    }
  }

  function displayPromptList(): void {
    clearScreen();

    // Tab bar
    const msgTab = viewMode === 'messages' ? `${colors.bright}${colors.cyan}[📨 Messages (${messages.length})]${colors.reset}` : `${colors.dim}📨 Messages (${messages.length})${colors.reset}`;
    const sessTab = viewMode === 'sessions' ? `${colors.bright}${colors.green}[📋 Sessions (${sessions.length})]${colors.reset}` : `${colors.dim}📋 Sessions (${sessions.length})${colors.reset}`;
    const sysTab = viewMode === 'system' ? `${colors.bright}${colors.yellow}[📢 System (${systemMessages.length})]${colors.reset}` : `${colors.dim}📢 System (${systemMessages.length})${colors.reset}`;
    const promptTab = viewMode === 'prompts' ? `${colors.bright}${colors.magenta}[🤖 Prompts (${prompts.length})]${colors.reset}` : `${colors.dim}🤖 Prompts (${prompts.length})${colors.reset}`;
    console.log(`\n${msgTab}  ${sessTab}  ${sysTab}  ${promptTab}  ${colors.dim}Tab/s switch${colors.reset}`);

    const controls = `${colors.dim}↑↓/jk nav  Enter/→/l view  q quit${colors.reset}`;
    console.log(`${controls}\n`);

    if (prompts.length === 0) {
      console.log(colors.dim + 'No built prompts found.' + colors.reset);
      console.log(colors.dim + 'Prompts are saved when workers are initialized.' + colors.reset);
      return;
    }

    const visibleStart = Math.max(0, promptSelectedIndex - 15);
    const visibleEnd = Math.min(prompts.length, promptSelectedIndex + 10);

    for (let i = visibleStart; i < visibleEnd; i++) {
      const prompt = prompts[i];
      const isSelected = i === promptSelectedIndex;

      if (isSelected) {
        process.stdout.write(`${colors.bright}${colors.magenta}▶ ${colors.reset}`);
      } else {
        process.stdout.write('  ');
      }

      const time = formatTime(prompt.timestamp);
      const agent = prompt.agentId.padEnd(30);
      const model = prompt.model.padEnd(15);

      console.log(`${colors.dim}${time}${colors.reset} ${colors.magenta}${agent}${colors.reset} ${colors.cyan}${model}${colors.reset}`);
    }
    console.log();
  }

  function displayPromptDetail(): void {
    clearScreen();

    const prompt = prompts[promptSelectedIndex];
    console.log(`\n${colors.bright}${colors.magenta}🤖 Built Prompt${colors.reset} ${colors.dim}(${promptSelectedIndex + 1}/${prompts.length})${colors.reset}`);
    console.log(colors.dim + '↑↓/jk scroll  ←/h/Esc/q back' + colors.reset + '\n');

    // Metadata
    console.log(`${colors.dim}Agent:${colors.reset}    ${colors.magenta}${prompt.agentId}${colors.reset}`);
    console.log(`${colors.dim}Model:${colors.reset}    ${colors.cyan}${prompt.model}${colors.reset}`);
    console.log(`${colors.dim}Time:${colors.reset}     ${formatTime(prompt.timestamp)}`);
    console.log(`${colors.dim}File:${colors.reset}     ${prompt.filepath}`);

    console.log();
    console.log(colors.dim + '─'.repeat(80) + colors.reset);
    console.log();

    // Content
    const contentLines = wrapText(prompt.content);
    const viewportHeight = Math.max(10, (process.stdout.rows || 40) - 13);
    const maxScroll = Math.max(0, contentLines.length - viewportHeight);

    detailScrollOffset = Math.max(0, Math.min(detailScrollOffset, maxScroll));

    const visibleLines = contentLines.slice(detailScrollOffset, detailScrollOffset + viewportHeight);
    visibleLines.forEach(line => console.log(line));

    if (contentLines.length > viewportHeight) {
      const scrollPercent = maxScroll > 0 ? Math.round((detailScrollOffset / maxScroll) * 100) : 0;
      console.log();
      console.log(`${colors.dim}[${scrollPercent}%] Line ${detailScrollOffset + 1}-${Math.min(detailScrollOffset + viewportHeight, contentLines.length)} of ${contentLines.length}${colors.reset}`);
    }
  }

  function setupWatcher(): void {
    if (watcher) return;

    watcher = watch(logDir, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
    });

    watcher.on('add', async (filepath: string) => {
      if (!filepath.endsWith('.md')) return;
      const msg = await readMessage(filepath);
      if (msg && matchesFilter(msg, options)) {
        messages.push(msg);
        messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        selectedIndex = messages.length - 1;
        if (!viewingDetail) display();
      }
    });
  }

  function setupSysWatcher(): void {
    if (sysWatcher) return;
    if (!fs.existsSync(sysMsgsDir)) return;

    sysWatcher = watch(sysMsgsDir, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
    });

    sysWatcher.on('add', async (filepath: string) => {
      if (!filepath.endsWith('.md')) return;
      const msg = await readMessage(filepath);
      if (msg && matchesFilter(msg, options)) {
        systemMessages.push(msg);
        systemMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        systemSelectedIndex = systemMessages.length - 1;
        if (!viewingDetail) display();
      }
    });
  }

  function setupPromptsWatcher(): void {
    if (promptsWatcher) return;
    if (!fs.existsSync(promptsDir)) return;

    promptsWatcher = watch(promptsDir, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {stabilityThreshold: 100, pollInterval: 50}
    });

    promptsWatcher.on('add', async (filepath: string) => {
      if (!filepath.endsWith('.md')) return;
      // Re-read all prompts to ensure correct order
      prompts = await getAllPrompts(promptsDir);
      if (options.agent) {
        prompts = prompts.filter(p => p.agentId.toLowerCase().includes(options.agent!.toLowerCase()));
      }
      if (!viewingDetail) display();
    });
  }

  // Always follow - set up watchers immediately
  setupWatcher();
  setupSysWatcher();
  setupPromptsWatcher();

  // Setup keyboard
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  display();

  process.stdin.on('keypress', (_str, key) => {
    if (key.ctrl && key.name === 'c') {
      cleanup();
      process.exit(0);
    }

    if (viewingPrompt) {
      // Prompt view navigation
      const msg = messages[selectedIndex];
      const prompt = buildInjectedPrompt(msg, logDir);
      const promptLines = wrapText(prompt);
      const viewportHeight = Math.max(10, (process.stdout.rows || 40) - 15);
      const halfPage = Math.floor(viewportHeight / 2);
      const maxScroll = Math.max(0, promptLines.length - viewportHeight);

      switch (key.name) {
        case 'up':
        case 'k':
          detailScrollOffset = Math.max(0, detailScrollOffset - halfPage);
          display();
          break;
        case 'down':
        case 'j':
          detailScrollOffset = Math.min(maxScroll, detailScrollOffset + halfPage);
          display();
          break;
        case 'left':
        case 'h':
        case 'escape':
        case 'q':
          viewingPrompt = false;
          detailScrollOffset = 0;
          display();
          break;
      }
    } else if (viewingDetail) {
      // Detail view navigation (messages, sessions, or system)
      let contentLines: string[];
      if (viewMode === 'sessions' && sessions[sessionSelectedIndex]) {
        contentLines = wrapText(sessions[sessionSelectedIndex].content);
      } else if (viewMode === 'system' && systemMessages[systemSelectedIndex]) {
        contentLines = wrapText(systemMessages[systemSelectedIndex].content || '');
      } else if (messages[selectedIndex]) {
        contentLines = wrapText(messages[selectedIndex].content || '');
      } else {
        contentLines = [];
      }

      const viewportHeight = Math.max(10, (process.stdout.rows || 40) - 20);
      const halfPage = Math.floor(viewportHeight / 2);
      const maxScroll = Math.max(0, contentLines.length - viewportHeight);

      switch (key.name) {
        case 'up':
        case 'k':
          detailScrollOffset = Math.max(0, detailScrollOffset - halfPage);
          display();
          break;
        case 'down':
        case 'j':
          detailScrollOffset = Math.min(maxScroll, detailScrollOffset + halfPage);
          display();
          break;
        case 'left':
        case 'h':
        case 'escape':
        case 'q':
          viewingDetail = false;
          detailScrollOffset = 0;
          display();
          break;
        case 'p':
          if (viewMode === 'messages') {
            viewingDetail = false;
            viewingPrompt = true;
            detailScrollOffset = 0;
            display();
          }
          break;
      }
    } else {
      // List view navigation
      switch (key.name) {
        case 'up':
        case 'k':
          if (viewMode === 'messages') {
            if (selectedIndex > 0) { selectedIndex--; display(); }
          } else if (viewMode === 'sessions') {
            if (sessionSelectedIndex > 0) { sessionSelectedIndex--; display(); }
          } else if (viewMode === 'system') {
            if (systemSelectedIndex > 0) { systemSelectedIndex--; display(); }
          } else if (viewMode === 'prompts') {
            if (promptSelectedIndex > 0) {promptSelectedIndex--; display();}
          }
          break;
        case 'down':
        case 'j':
          if (viewMode === 'messages') {
            if (selectedIndex < messages.length - 1) { selectedIndex++; display(); }
          } else if (viewMode === 'sessions') {
            if (sessionSelectedIndex < sessions.length - 1) { sessionSelectedIndex++; display(); }
          } else if (viewMode === 'system') {
            if (systemSelectedIndex < systemMessages.length - 1) { systemSelectedIndex++; display(); }
          } else if (viewMode === 'prompts') {
            if (promptSelectedIndex < prompts.length - 1) {promptSelectedIndex++; display();}
          }
          break;
        case 'return':
        case 'right':
        case 'l':
          if ((viewMode === 'messages' && messages.length > 0) ||
              (viewMode === 'sessions' && sessions.length > 0) ||
            (viewMode === 'system' && systemMessages.length > 0) ||
            (viewMode === 'prompts' && prompts.length > 0)) {
            viewingDetail = true;
            detailScrollOffset = 0;
            display();
          }
          break;
        case 'p':
          if (viewMode === 'messages' && messages.length > 0) {
            viewingPrompt = true;
            detailScrollOffset = 0;
            display();
          }
          break;
        case 'tab':
        case 's':
          // Cycle through: messages -> sessions -> system -> prompts -> messages
          if (viewMode === 'messages') {
            viewMode = 'sessions';
          } else if (viewMode === 'sessions') {
            viewMode = 'system';
          } else if (viewMode === 'system') {
            viewMode = 'prompts';
          } else {
            viewMode = 'messages';
          }
          detailScrollOffset = 0;
          display();
          break;
        case 'q':
          cleanup();
          process.exit(0);
          break;
      }
    }
  });

  function cleanup(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    if (watcher) watcher.close();
    if (sysWatcher) sysWatcher.close();
    if (promptsWatcher) promptsWatcher.close();
    console.log(`\n${colors.dim}Exited message viewer${colors.reset}\n`);
  }

  process.on('SIGINT', cleanup);
}

/**
 * Simple list mode
 */
async function msgList(logDir: string, options: MsgOptions): Promise<void> {
  let messages = await getAllMessages(logDir);
  messages = messages.filter(msg => matchesFilter(msg, options));
  const limit = parseInt(options.limit || '50');
  messages = messages.slice(-limit);

  if (messages.length === 0) {
    console.log(`${colors.dim}No messages found matching filters.${colors.reset}\n`);
    return;
  }

  console.log(`\n${colors.bright}${colors.cyan}📨 Messages${colors.reset} ${colors.dim}(${messages.length})${colors.reset}\n`);
  messages.forEach(msg => displayMessage(msg, options));
  console.log();
}

/**
 * JSON output mode
 */
async function msgJson(logDir: string, options: MsgOptions): Promise<void> {
  let messages = await getAllMessages(logDir);
  messages = messages.filter(msg => matchesFilter(msg, options));
  const limit = parseInt(options.limit || '50');
  messages = messages.slice(-limit);
  console.log(JSON.stringify(messages, null, 2));
}

/**
 * Main msg command
 */
export async function msg(options: MsgOptions = {}): Promise<void> {
  const workDir = process.env.TX_CWD || process.cwd();
  const logDir = path.join(workDir, '.ai/tx/msgs');

  if (!fs.existsSync(logDir)) {
    console.log(`${colors.yellow}⚠${colors.reset} Message directory not found: ${logDir}`);
    console.log(`${colors.dim}No messages yet.${colors.reset}\n`);
    return;
  }

  // JSON output mode
  if (options.json) {
    return msgJson(logDir, options);
  }

  // Interactive mode with auto-follow (default)
  if (options.interactive !== false) {
    return msgInteractive(logDir, options);
  }

  // Simple list mode
  return msgList(logDir, options);
}
