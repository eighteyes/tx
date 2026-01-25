/**
 * Forensics Types
 *
 * Type definitions for mesh execution analysis and forensics reporting.
 */

/**
 * Entry in a session transcript
 */
export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'tool' | 'result';
  content: string;
  tool?: string;
  timestamp?: string;
  turnNumber?: number;
}

/**
 * Parsed transcript data from a session file
 */
export interface TranscriptData {
  sessionId: string;
  agentId: string;
  entries: TranscriptEntry[];
  startTime: string;
  endTime?: string;
  totalTurns: number;
  toolsUsed: string[];
  rawContent: string;
}

/**
 * Pattern detected in execution
 */
export interface ForensicsPattern {
  name: string;
  description: string;
  frequency: number;
  impact: 'positive' | 'neutral' | 'negative';
  examples?: string[];
}

/**
 * Issue found during analysis
 */
export interface ForensicsIssue {
  severity: 'info' | 'warning' | 'error';
  category: 'routing' | 'state' | 'behavior' | 'performance' | 'error';
  description: string;
  location?: string;  // Turn number or tool call
  suggestion?: string;
}

/**
 * Execution metrics extracted from transcript
 */
export interface ForensicsMetrics {
  totalTurns: number;
  toolCalls: number;
  toolErrors: number;
  messagesSent: number;
  messagesReceived: number;
  executionPath: string[];  // Sequence of tools used
  avgToolsPerTurn: number;
  durationSeconds?: number;
}

/**
 * Full forensics analysis report
 */
export interface ForensicsReport {
  timestamp: string;
  meshInstance: string;
  agent: string;
  sessionId?: string;
  summary: string;
  patterns: ForensicsPattern[];
  issues: ForensicsIssue[];
  recommendations: string[];
  metrics: ForensicsMetrics;
}

/**
 * Context for forensics analysis
 */
export interface ForensicsContext {
  agentId: string;
  meshInstance: string;
  meshName: string;
  workerOutput?: string;
  sessionId?: string;
  workDir: string;
}

/**
 * Options for CLI forensics command
 */
export interface ForensicsCliOptions {
  session?: string;  // Specific session ID
  agent?: string;    // Specific agent to analyze
  last?: number;     // Analyze last N sessions
  output?: string;   // Output path
  json?: boolean;    // Output as JSON
  stdout?: boolean;  // Print to stdout
}
