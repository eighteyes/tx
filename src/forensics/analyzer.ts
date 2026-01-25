/**
 * Forensics Analyzer
 *
 * Haiku-powered analysis of mesh execution transcripts.
 * Identifies patterns, issues, and improvement opportunities.
 */

import fs from 'node:fs';
import path from 'node:path';
import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import type {
  TranscriptData,
  ForensicsReport,
  ForensicsContext,
  ForensicsPattern,
  ForensicsIssue,
  ForensicsMetrics,
} from './types.ts';

const COMPONENT = 'forensics-analyzer';

/**
 * System prompt for forensics analysis
 */
const FORENSICS_SYSTEM_PROMPT = `You are a forensics analyst for AI agent mesh executions.
Your job is to analyze session transcripts and identify patterns, issues, and recommendations.

Focus on:
1. **Routing Issues**: Messages going to wrong targets, dead ends, violations of routing rules
2. **State Issues**: Stale asks never answered, inconsistent context, session sync problems
3. **Behavioral Issues**: Agents acting outside their role, hallucinated targets, off-script behavior
4. **Success Patterns**: Effective handoffs, good state management, correct tool usage
5. **Performance**: Inefficient tool use, excessive retries, wasted turns

Output ONLY valid JSON matching this schema:
{
  "summary": "string - brief overview of the execution (1-2 sentences)",
  "patterns": [
    {
      "name": "string - pattern name",
      "description": "string - what was observed",
      "frequency": number,
      "impact": "positive" | "neutral" | "negative"
    }
  ],
  "issues": [
    {
      "severity": "info" | "warning" | "error",
      "category": "routing" | "state" | "behavior" | "performance" | "error",
      "description": "string - what went wrong",
      "location": "string - where in transcript (optional)",
      "suggestion": "string - how to fix (optional)"
    }
  ],
  "recommendations": ["string - actionable improvement suggestions"]
}

Be concise but thorough. Focus on actionable insights.`;

/**
 * Analyze a transcript using Haiku
 */
export async function analyzeTranscript(
  transcript: TranscriptData,
  context: ForensicsContext
): Promise<ForensicsReport> {
  const { agentId, meshInstance, workerOutput } = context;

  // Build metrics from transcript
  const metrics = extractMetrics(transcript);

  // Build analysis prompt
  const userPrompt = buildAnalysisPrompt(transcript, context, metrics);

  try {
    // Run Haiku analysis
    const analysisResult = await runHaikuAnalysis(userPrompt, context.workDir);

    // Parse JSON response
    const analysis = parseAnalysisResponse(analysisResult);

    return {
      timestamp: new Date().toISOString(),
      meshInstance,
      agent: agentId,
      sessionId: transcript.sessionId,
      summary: analysis.summary || 'Analysis completed',
      patterns: analysis.patterns || [],
      issues: analysis.issues || [],
      recommendations: analysis.recommendations || [],
      metrics,
    };
  } catch (error) {
    log.error(COMPONENT, 'Analysis failed, using fallback', {
      error: (error as Error).message,
      agentId,
    });

    // Return basic report on failure
    return createFallbackReport(transcript, context, metrics);
  }
}

/**
 * Extract metrics from transcript without LLM
 */
function extractMetrics(transcript: TranscriptData): ForensicsMetrics {
  const toolEntries = transcript.entries.filter(e => e.role === 'tool');
  const errorEntries = transcript.entries.filter(e =>
    e.content.includes('[Result: error]') ||
    e.content.toLowerCase().includes('error') ||
    e.content.toLowerCase().includes('failed')
  );

  // Extract tool sequence from entries
  const executionPath: string[] = [];
  for (const entry of toolEntries) {
    if (entry.tool) {
      const tools = entry.tool.split(',').map(t => t.trim());
      executionPath.push(...tools);
    }
  }

  // Count message writes (Write tool to msgs directory)
  const messagesSent = transcript.entries.filter(e =>
    e.content.includes('msgs/') && e.content.includes('Write')
  ).length;

  return {
    totalTurns: transcript.totalTurns,
    toolCalls: executionPath.length,
    toolErrors: errorEntries.length,
    messagesSent,
    messagesReceived: 1, // At least the initial task
    executionPath: executionPath.slice(0, 50), // Cap at 50 for report
    avgToolsPerTurn: transcript.totalTurns > 0 ? executionPath.length / transcript.totalTurns : 0,
  };
}

/**
 * Build the analysis prompt for Haiku
 */
function buildAnalysisPrompt(
  transcript: TranscriptData,
  context: ForensicsContext,
  metrics: ForensicsMetrics
): string {
  const parts: string[] = [];

  parts.push(`# Forensics Analysis Request

## Session Context
- **Agent**: ${context.agentId}
- **Mesh Instance**: ${context.meshInstance}
- **Mesh**: ${context.meshName}
- **Total Turns**: ${transcript.totalTurns}
- **Tools Used**: ${transcript.toolsUsed.join(', ') || 'None'}
- **Tool Calls**: ${metrics.toolCalls}
- **Errors Detected**: ${metrics.toolErrors}

## Execution Path
${metrics.executionPath.slice(0, 30).join(' → ') || 'No tools used'}
${metrics.executionPath.length > 30 ? `... (${metrics.executionPath.length - 30} more)` : ''}

## Transcript

`);

  // Add transcript entries (truncated if too long)
  const MAX_CONTENT_LENGTH = 15000;
  let contentLength = 0;

  for (let i = 0; i < transcript.entries.length; i++) {
    const entry = transcript.entries[i];
    const turnContent = `### Turn ${entry.turnNumber || i + 1} (${entry.role})
${entry.content.slice(0, 2000)}${entry.content.length > 2000 ? '...' : ''}

`;

    if (contentLength + turnContent.length > MAX_CONTENT_LENGTH) {
      parts.push(`\n... (${transcript.entries.length - i} more turns truncated)\n`);
      break;
    }

    parts.push(turnContent);
    contentLength += turnContent.length;
  }

  if (context.workerOutput) {
    parts.push(`## Final Output

${context.workerOutput.slice(0, 2000)}${context.workerOutput.length > 2000 ? '...' : ''}
`);
  }

  parts.push(`
---

Analyze this session and return ONLY valid JSON matching the schema described in your instructions.
Focus on routing issues, state problems, behavioral anomalies, and success patterns.`);

  return parts.join('');
}

/**
 * Run Haiku analysis with SDK
 */
async function runHaikuAnalysis(prompt: string, workDir: string): Promise<string> {
  let result = '';

  const q = query({
    prompt,
    options: {
      cwd: workDir,
      model: 'haiku',
      systemPrompt: FORENSICS_SYSTEM_PROMPT,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 1, // Single turn for analysis
      tools: [], // No tools needed for analysis
    },
  });

  for await (const msg of q) {
    if (msg.type === 'assistant') {
      const content = msg.message.content;
      if (typeof content === 'string') {
        result = content;
      } else if (Array.isArray(content)) {
        const textBlocks = content.filter((b: any) => b.type === 'text');
        result = textBlocks.map((b: any) => b.text).join('\n');
      }
    } else if (msg.type === 'result') {
      const resultMsg = msg as SDKResultMessage;
      log.debug(COMPONENT, 'Haiku analysis complete', {
        costUsd: resultMsg.total_cost_usd,
        durationMs: resultMsg.duration_ms,
      });
    }
  }

  return result;
}

/**
 * Parse JSON response from Haiku
 */
function parseAnalysisResponse(response: string): {
  summary?: string;
  patterns?: ForensicsPattern[];
  issues?: ForensicsIssue[];
  recommendations?: string[];
} {
  // Try to extract JSON from response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log.warn(COMPONENT, 'No JSON found in analysis response');
    return {};
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    log.warn(COMPONENT, 'Failed to parse analysis JSON', {
      error: (error as Error).message,
    });
    return {};
  }
}

/**
 * Create a basic report when LLM analysis fails
 */
function createFallbackReport(
  transcript: TranscriptData,
  context: ForensicsContext,
  metrics: ForensicsMetrics
): ForensicsReport {
  const issues: ForensicsIssue[] = [];

  // Basic heuristic checks
  if (metrics.toolErrors > 0) {
    issues.push({
      severity: 'warning',
      category: 'error',
      description: `${metrics.toolErrors} tool error(s) detected`,
      suggestion: 'Review error output for root causes',
    });
  }

  if (metrics.toolCalls > 50) {
    issues.push({
      severity: 'info',
      category: 'performance',
      description: `High tool call count (${metrics.toolCalls})`,
      suggestion: 'Consider if there are inefficient patterns',
    });
  }

  return {
    timestamp: new Date().toISOString(),
    meshInstance: context.meshInstance,
    agent: context.agentId,
    sessionId: transcript.sessionId,
    summary: `Session completed with ${metrics.totalTurns} turns and ${metrics.toolCalls} tool calls`,
    patterns: [],
    issues,
    recommendations: ['Review transcript manually for detailed insights'],
    metrics,
  };
}

/**
 * Write forensics report to file
 */
export async function writeForensicsReport(
  report: ForensicsReport,
  workDir: string,
  meshName?: string
): Promise<{ jsonPath: string; mdPath: string }> {
  const forensicsDir = path.join(workDir, '.ai', 'tx', 'forensics');

  // Ensure directory exists
  if (!fs.existsSync(forensicsDir)) {
    fs.mkdirSync(forensicsDir, { recursive: true });
  }

  const timestamp = Date.now();
  const baseName = `${meshName || report.meshInstance}-${timestamp}`;

  // Write JSON report
  const jsonPath = path.join(forensicsDir, `${baseName}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Write markdown report
  const mdPath = path.join(forensicsDir, `${baseName}.md`);
  fs.writeFileSync(mdPath, formatReportAsMarkdown(report));

  log.info(COMPONENT, 'Forensics report written', {
    jsonPath,
    mdPath,
  });

  return { jsonPath, mdPath };
}

/**
 * Format report as human-readable markdown
 */
function formatReportAsMarkdown(report: ForensicsReport): string {
  const lines: string[] = [];

  lines.push(`# Mesh Forensics Report`);
  lines.push('');
  lines.push(`**Generated**: ${report.timestamp}`);
  lines.push(`**Mesh Instance**: ${report.meshInstance}`);
  lines.push(`**Agent**: ${report.agent}`);
  if (report.sessionId) {
    lines.push(`**Session**: ${report.sessionId}`);
  }
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(report.summary);
  lines.push('');

  lines.push('## Metrics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Turns | ${report.metrics.totalTurns} |`);
  lines.push(`| Tool Calls | ${report.metrics.toolCalls} |`);
  lines.push(`| Tool Errors | ${report.metrics.toolErrors} |`);
  lines.push(`| Messages Sent | ${report.metrics.messagesSent} |`);
  lines.push(`| Avg Tools/Turn | ${report.metrics.avgToolsPerTurn.toFixed(2)} |`);
  lines.push('');

  if (report.metrics.executionPath.length > 0) {
    lines.push('### Execution Path');
    lines.push('');
    lines.push('```');
    lines.push(report.metrics.executionPath.join(' → '));
    lines.push('```');
    lines.push('');
  }

  if (report.issues.length > 0) {
    lines.push('## Issues');
    lines.push('');
    for (const issue of report.issues) {
      const icon = issue.severity === 'error' ? 'X' :
                   issue.severity === 'warning' ? '!' : 'i';
      lines.push(`- **[${icon}] ${issue.category}**: ${issue.description}`);
      if (issue.location) {
        lines.push(`  - *Location*: ${issue.location}`);
      }
      if (issue.suggestion) {
        lines.push(`  - *Suggestion*: ${issue.suggestion}`);
      }
    }
    lines.push('');
  }

  if (report.patterns.length > 0) {
    lines.push('## Patterns Detected');
    lines.push('');
    for (const pattern of report.patterns) {
      const icon = pattern.impact === 'positive' ? '+' :
                   pattern.impact === 'negative' ? '-' : '~';
      lines.push(`- **[${icon}] ${pattern.name}** (${pattern.frequency}x): ${pattern.description}`);
    }
    lines.push('');
  }

  if (report.recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by TX Mesh Forensics*');

  return lines.join('\n');
}

/**
 * Format report for terminal output with colors
 */
export function formatReportForTerminal(report: ForensicsReport): string {
  const lines: string[] = [];

  // Header
  lines.push('\n' + '='.repeat(60));
  lines.push('  MESH FORENSICS REPORT');
  lines.push('='.repeat(60) + '\n');

  lines.push(`Mesh: ${report.meshInstance}`);
  lines.push(`Agent: ${report.agent}`);
  lines.push(`Time: ${report.timestamp}`);
  lines.push('');

  lines.push('Summary:');
  lines.push(`  ${report.summary}`);
  lines.push('');

  lines.push('Metrics:');
  lines.push(`  Total Turns: ${report.metrics.totalTurns}`);
  lines.push(`  Tool Calls: ${report.metrics.toolCalls}`);
  lines.push(`  Tool Errors: ${report.metrics.toolErrors}`);
  lines.push(`  Execution Path: ${report.metrics.executionPath.slice(0, 10).join(' -> ')}${report.metrics.executionPath.length > 10 ? '...' : ''}`);
  lines.push('');

  if (report.issues.length > 0) {
    lines.push('Issues Found:');
    for (const issue of report.issues) {
      const icon = issue.severity === 'error' ? 'X' :
                   issue.severity === 'warning' ? '!' : 'i';
      lines.push(`  [${icon}] ${issue.description}`);
      if (issue.suggestion) {
        lines.push(`      -> ${issue.suggestion}`);
      }
    }
    lines.push('');
  }

  if (report.patterns.length > 0) {
    lines.push('Patterns Detected:');
    for (const pattern of report.patterns) {
      const icon = pattern.impact === 'positive' ? '+' :
                   pattern.impact === 'negative' ? '-' : '~';
      lines.push(`  [${icon}] ${pattern.name}: ${pattern.description}`);
    }
    lines.push('');
  }

  if (report.recommendations.length > 0) {
    lines.push('Recommendations:');
    for (const rec of report.recommendations) {
      lines.push(`  * ${rec}`);
    }
  }

  lines.push('\n' + '='.repeat(60) + '\n');

  return lines.join('\n');
}
