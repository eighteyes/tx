/**
 * Transcript Loader
 *
 * Parses session transcript files from .ai/tx/sessions/ directory.
 * Supports the markdown format with tool markers and turn separators.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';
import type { TranscriptData, TranscriptEntry } from './types.ts';

const COMPONENT = 'forensics-transcript';

/**
 * Load a session transcript by session ID and agent
 */
export async function loadSessionTranscript(
  workDir: string,
  sessionId: string | undefined,
  agentId: string
): Promise<TranscriptData | null> {
  const sessionsDir = path.join(workDir, '.ai', 'tx', 'sessions');
  const agentDir = path.join(sessionsDir, agentId.replace('/', '-'));

  if (!fs.existsSync(agentDir)) {
    log.debug(COMPONENT, 'Agent sessions directory not found', { agentDir, agentId });
    return null;
  }

  let sessionFile: string | null = null;

  if (sessionId) {
    // Try to find session file matching the ID
    const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.md'));

    // Check for exact match or partial match
    for (const file of files) {
      const basename = path.basename(file, '.md');
      if (basename === sessionId || basename.includes(sessionId) || file.includes(sessionId)) {
        sessionFile = path.join(agentDir, file);
        break;
      }
    }

    if (!sessionFile) {
      log.debug(COMPONENT, 'Session file not found', { sessionId, agentDir });
      return null;
    }
  } else {
    // Fallback: find most recent session file for agent
    const files = fs.readdirSync(agentDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();

    if (files.length === 0) {
      log.debug(COMPONENT, 'No session files found for agent', { agentDir });
      return null;
    }

    sessionFile = path.join(agentDir, files[0]);
  }

  try {
    const content = fs.readFileSync(sessionFile, 'utf-8');
    return parseSessionFile(sessionFile, agentId, content);
  } catch (error) {
    log.error(COMPONENT, 'Failed to read session file', {
      sessionFile,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Find all session files for a mesh
 */
export function findMeshSessions(
  workDir: string,
  meshName: string,
  limit: number = 10
): Array<{ agentId: string; sessionFile: string; startTime: string }> {
  const sessionsDir = path.join(workDir, '.ai', 'tx', 'sessions');

  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const results: Array<{ agentId: string; sessionFile: string; startTime: string }> = [];

  try {
    const agentDirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith(meshName));

    for (const dir of agentDirs) {
      const agentDir = path.join(sessionsDir, dir.name);
      const agentId = dir.name.replace('-', '/');

      const files = fs.readdirSync(agentDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, limit);

      for (const file of files) {
        const startTime = extractTimestampFromFilename(file);
        results.push({
          agentId,
          sessionFile: path.join(agentDir, file),
          startTime,
        });
      }
    }

    // Sort by start time, most recent first
    results.sort((a, b) => b.startTime.localeCompare(a.startTime));
    return results.slice(0, limit);
  } catch (error) {
    log.error(COMPONENT, 'Failed to find mesh sessions', {
      meshName,
      error: (error as Error).message,
    });
    return [];
  }
}

/**
 * Parse session file content into structured transcript data
 */
function parseSessionFile(filepath: string, agentId: string, content: string): TranscriptData {
  const entries: TranscriptEntry[] = [];
  const toolsUsed: string[] = [];
  let turnNumber = 0;

  // Split by turn separator (---)
  const sections = content.split(/\n---\n/);

  for (const section of sections) {
    if (!section.trim()) continue;
    turnNumber++;

    // Check for tool markers: [Tools: Read, Edit]
    const toolMatch = section.match(/\[Tools?:\s*([^\]]+)\]/);
    if (toolMatch) {
      const tools = toolMatch[1].split(',').map(t => t.trim());
      for (const tool of tools) {
        if (!toolsUsed.includes(tool)) {
          toolsUsed.push(tool);
        }
      }
      entries.push({
        role: 'tool',
        content: section,
        tool: toolMatch[1],
        turnNumber,
      });
      continue;
    }

    // Check for result markers: [Result: success] or [Result: error]
    const resultMatch = section.match(/\[Result:\s*(\w+)\]/);
    if (resultMatch) {
      entries.push({
        role: 'result',
        content: section,
        turnNumber,
      });
      continue;
    }

    // Check if it looks like a user message (task context, etc)
    if (section.includes('## Task Context') || section.includes('**From**:') || section.includes('# Incoming Message')) {
      entries.push({
        role: 'user',
        content: section,
        turnNumber,
      });
      continue;
    }

    // Default to assistant
    entries.push({
      role: 'assistant',
      content: section,
      turnNumber,
    });
  }

  // Extract session ID from filename
  const sessionId = path.basename(filepath, '.md');
  const startTime = extractTimestampFromFilename(path.basename(filepath));

  return {
    sessionId,
    agentId,
    entries,
    startTime,
    totalTurns: turnNumber,
    toolsUsed,
    rawContent: content,
  };
}

/**
 * Extract timestamp from session filename
 * Format: YYYY-MM-DDTHH-MM-SS-sssZ.md -> ISO string
 */
function extractTimestampFromFilename(filename: string): string {
  // Convert format: 2024-01-15T10-30-45-123Z.md -> 2024-01-15T10:30:45.123Z
  const base = filename.replace('.md', '');
  const timestamp = base.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z');

  // Validate it's a valid date
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    return base; // Return as-is if not parseable
  }

  return timestamp;
}

/**
 * Get raw transcript content for a session (for display/analysis)
 */
export async function getTranscriptContent(
  workDir: string,
  agentId: string,
  sessionId?: string
): Promise<string | null> {
  const transcript = await loadSessionTranscript(workDir, sessionId, agentId);
  return transcript?.rawContent ?? null;
}
