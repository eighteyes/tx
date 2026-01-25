/**
 * tx forensics - Analyze mesh execution sessions
 *
 * On-demand forensics analysis for debugging mesh behavior.
 * Analyzes session transcripts and identifies patterns, issues, and recommendations.
 */

import path from 'node:path';
import fs from 'node:fs';
import {
  analyzeTranscript,
  writeForensicsReport,
  formatReportForTerminal,
  loadSessionTranscript,
  findMeshSessions,
} from '../forensics/index.ts';
import type { ForensicsContext, ForensicsReport } from '../forensics/types.ts';
import { log } from '../shared/logger.ts';

export interface ForensicsOptions {
  session?: string;  // Specific session ID
  agent?: string;    // Specific agent to analyze
  last?: string;     // Analyze last N sessions
  output?: string;   // Output path
  json?: boolean;    // Output as JSON
}

export async function forensics(meshName?: string, options: ForensicsOptions = {}): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const workDir = cwd;
  const sessionsDir = path.join(workDir, '.ai', 'tx', 'sessions');

  // Initialize logger
  log.init(workDir, 'debug');

  if (!fs.existsSync(sessionsDir)) {
    console.error('No sessions directory found. Run some mesh executions first.');
    process.exit(1);
  }

  const limit = parseInt(options.last || '1', 10);

  // Find sessions to analyze
  let sessions: Array<{ agentId: string; sessionFile: string; startTime: string }> = [];

  if (meshName) {
    // Find sessions for specific mesh
    sessions = findMeshSessions(workDir, meshName, limit);
    if (sessions.length === 0) {
      console.error(`No sessions found for mesh '${meshName}'`);
      process.exit(1);
    }
  } else if (options.agent) {
    // Find sessions for specific agent
    const agentDir = path.join(sessionsDir, options.agent.replace('/', '-'));
    if (!fs.existsSync(agentDir)) {
      console.error(`No sessions found for agent '${options.agent}'`);
      process.exit(1);
    }

    const files = fs.readdirSync(agentDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, limit);

    sessions = files.map(f => ({
      agentId: options.agent!,
      sessionFile: path.join(agentDir, f),
      startTime: extractTimestamp(f),
    }));
  } else {
    // Find most recent sessions across all meshes
    const agentDirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    const allSessions: Array<{ agentId: string; sessionFile: string; startTime: string }> = [];

    for (const dir of agentDirs) {
      const agentDir = path.join(sessionsDir, dir.name);
      const agentId = dir.name.replace('-', '/');

      const files = fs.readdirSync(agentDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

      for (const f of files) {
        allSessions.push({
          agentId,
          sessionFile: path.join(agentDir, f),
          startTime: extractTimestamp(f),
        });
      }
    }

    // Sort by time and take limit
    allSessions.sort((a, b) => b.startTime.localeCompare(a.startTime));
    sessions = allSessions.slice(0, limit);

    if (sessions.length === 0) {
      console.error('No sessions found');
      process.exit(1);
    }
  }

  console.log(`\nAnalyzing ${sessions.length} session(s)...\n`);

  const reports: ForensicsReport[] = [];

  for (const session of sessions) {
    console.log(`Processing: ${session.agentId} (${session.startTime})`);

    try {
      // Extract session ID from filename
      const sessionId = path.basename(session.sessionFile, '.md');

      // Load transcript
      const transcript = await loadSessionTranscript(workDir, sessionId, session.agentId);

      if (!transcript) {
        console.error(`  Failed to load transcript`);
        continue;
      }

      // Build context
      const meshParts = session.agentId.split('/');
      const forensicsContext: ForensicsContext = {
        agentId: session.agentId,
        meshInstance: `${meshParts[0]}-${Date.now()}`,
        meshName: meshParts[0],
        sessionId,
        workDir,
      };

      // Run analysis
      const report = await analyzeTranscript(transcript, forensicsContext);
      reports.push(report);

      // Write report to file
      const { jsonPath, mdPath } = await writeForensicsReport(report, workDir, meshParts[0]);

      if (options.json) {
        // JSON output to stdout
        console.log(JSON.stringify(report, null, 2));
      } else {
        // Formatted terminal output
        console.log(formatReportForTerminal(report));

        // Show file paths
        console.log(`Reports written to:`);
        console.log(`  JSON: ${jsonPath}`);
        console.log(`  Markdown: ${mdPath}`);
      }
    } catch (error) {
      console.error(`  Error: ${(error as Error).message}`);
    }
  }

  // Summary if multiple sessions
  if (reports.length > 1) {
    console.log('\n' + '='.repeat(60));
    console.log(`  ANALYSIS SUMMARY (${reports.length} sessions)`);
    console.log('='.repeat(60) + '\n');

    const totalIssues = reports.reduce((sum, r) => sum + r.issues.length, 0);
    const totalPatterns = reports.reduce((sum, r) => sum + r.patterns.length, 0);
    const errorCount = reports.reduce((sum, r) =>
      sum + r.issues.filter(i => i.severity === 'error').length, 0
    );
    const warningCount = reports.reduce((sum, r) =>
      sum + r.issues.filter(i => i.severity === 'warning').length, 0
    );

    console.log(`Total Issues: ${totalIssues}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Warnings: ${warningCount}`);
    console.log(`Total Patterns: ${totalPatterns}`);

    // Aggregate common recommendations
    const allRecs = reports.flatMap(r => r.recommendations);
    const recCounts = new Map<string, number>();
    for (const rec of allRecs) {
      recCounts.set(rec, (recCounts.get(rec) || 0) + 1);
    }

    if (recCounts.size > 0) {
      console.log('\nCommon Recommendations:');
      const sorted = [...recCounts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [rec, count] of sorted.slice(0, 5)) {
        console.log(`  (${count}x) ${rec}`);
      }
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }
}

/**
 * Extract timestamp from session filename
 */
function extractTimestamp(filename: string): string {
  const base = filename.replace('.md', '');
  const timestamp = base.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z');
  return timestamp;
}
