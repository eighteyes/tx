/**
 * Hook System Types
 *
 * Core interfaces for the modular hook system.
 * Supports dependency injection, priority-based execution, and async initialization.
 */

import type { MessageQueue } from '../queue/index.ts';
import type { WorktreeManager } from '../core/worktree.ts';
import type { GateType, PreflightOutput, RearmatterData } from '../quality/types.ts';

// Re-export for convenience
export type { GateType, PreflightOutput, RearmatterData };

/**
 * Hook execution context - shared state across hook execution
 */
export interface HookContext {
  meshInstance: string;
  meshName: string;
  agentName: string;
  workDir: string;
  worktreePath?: string;   // Set by worktree:create hook
  worktreeBranch?: string; // Set by worktree:create hook
  featureName?: string;    // Feature name for worktree

  // Quality context (set by quality:preflight, used by quality:evaluate)
  qualityPreflight?: PreflightOutput;
  qualityIteration?: number;
  qualityMaxIterations?: number;
  qualityOnFail?: 'loop' | 'halt';
  qualityGates?: GateType[];

  // Task context
  agentId?: string;
  taskId?: string;
  taskBody?: string;

  // Worker output (set before post-hooks)
  workerOutput?: string;

  // Session ID for resume (captured from worker completion)
  sessionId?: string;

  // Message directory for feedback messages
  msgsDir?: string;

  // Ensemble context (if worker is part of ensemble)
  ensembleId?: string;
  ensembleIndex?: number;
  ensembleTotal?: number;

  // Agent config reference (for resume scenarios)
  agentConfig?: unknown;

  // Deterministic gate configuration
  deterministicCommands?: string[];

  [key: string]: unknown;  // Allow additional context fields
}

/**
 * Dependency-injected utilities available to hooks
 */
export interface HookUtils {
  queue: MessageQueue;
  worktreeManager: WorktreeManager;
  workDir: string;
  meshesDir: string;

  /**
   * Write a quality gate result to sys-msgs for visibility
   */
  writeResultMessage: (
    context: HookContext,
    gate: string,
    passed: boolean,
    summary: string,
    details?: Record<string, unknown>
  ) => void;

  /**
   * Write feedback message for quality iteration (audit trail)
   */
  writeFeedbackMessage: (
    context: HookContext,
    agentId: string,
    taskId: string,
    feedback: string,
    iteration: number
  ) => Promise<string>;

  /**
   * Extract rearmatter (self-assessment) from worker output
   */
  extractRearmatter: (solution: string) => RearmatterData;
}

/**
 * Hook handler signature with dependency injection
 */
export type HookHandler = (context: HookContext, utils: HookUtils) => Promise<void> | void;

/**
 * Legacy hook handler signature (for backward compatibility)
 */
export type LegacyHookHandler = (context: HookContext) => Promise<void> | void;

/**
 * Hook definition with priority and optional async initialization
 */
export interface HookDefinition {
  /** Unique hook name (e.g., "worktree:create", "quality:checklist") */
  name: string;

  /** Hook phase - pre runs before worker, post runs after */
  phase: 'pre' | 'post';

  /** Priority for execution order within phase (lower = earlier, default: 100) */
  priority?: number;

  /** Human-readable description */
  description?: string;

  /** Hook handler function */
  handler: HookHandler;

  /** Optional async initialization (called once before first execution) */
  initialize?: (utils: HookUtils) => Promise<void>;
}

/**
 * Quality hook configuration parsed from hook string
 * e.g., "quality:evaluate:onFail=loop,maxIterations=3"
 */
export interface QualityHookConfig {
  gates?: GateType[];
  onFail?: 'loop' | 'halt';
  maxIterations?: number;
}

/**
 * Hook metadata for introspection
 */
export interface HookMetadata {
  name: string;
  description?: string;
  phase: 'pre' | 'post';
  priority: number;
}
