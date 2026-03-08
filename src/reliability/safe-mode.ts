/**
 * SafeMode - Gradual autonomy toggle for mesh execution
 *
 * Nine 4 pattern: Treat autonomy as a knob, not a switch.
 * When reliability drops below SLI thresholds, automatically
 * restrict agent capabilities to prevent further damage.
 *
 * Levels:
 * - normal: Full autonomy (all tools, all actions)
 * - cautious: Disable risky tools (Bash write ops), require confirmation
 * - restricted: Read-only mode, no file writes, no bash commands
 * - lockdown: Stop all agent execution, alert human
 *
 * Safe mode can be triggered manually or automatically via SLI thresholds.
 */

import { log } from '../shared/logger.ts';

export type SafeModeLevel = 'normal' | 'cautious' | 'restricted' | 'lockdown';

export interface SafeModeConfig {
  /** Default safe mode level (default: 'normal') */
  defaultLevel: SafeModeLevel;
  /** SLI threshold for auto-escalation to cautious (default: 0.95) */
  cautiousThreshold: number;
  /** SLI threshold for auto-escalation to restricted (default: 0.90) */
  restrictedThreshold: number;
  /** SLI threshold for auto-escalation to lockdown (default: 0.80) */
  lockdownThreshold: number;
  /** Enable auto-escalation based on SLI (default: false) */
  autoEscalate: boolean;
}

export interface SafeModeState {
  level: SafeModeLevel;
  reason: string;
  changedAt: number;
  autoEscalated: boolean;
  /** Tools disabled at this level */
  disabledTools: string[];
  /** Actions blocked at this level */
  blockedActions: string[];
}

const DEFAULT_CONFIG: SafeModeConfig = {
  defaultLevel: 'normal',
  cautiousThreshold: 0.95,
  restrictedThreshold: 0.90,
  lockdownThreshold: 0.80,
  autoEscalate: false,
};

/** Tools restricted at each level */
const TOOL_RESTRICTIONS: Record<SafeModeLevel, string[]> = {
  normal: [],
  cautious: [],  // No tool blocks, but Bash writes require confirmation via guardrails
  restricted: ['Write', 'Edit', 'NotebookEdit', 'Bash'],
  lockdown: ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Glob', 'Grep', 'Read'],
};

/** Actions blocked at each level */
const ACTION_RESTRICTIONS: Record<SafeModeLevel, string[]> = {
  normal: [],
  cautious: ['destructive_bash', 'git_push', 'file_delete'],
  restricted: ['all_writes', 'all_bash', 'git_operations'],
  lockdown: ['all_operations'],
};

export class SafeMode {
  private config: SafeModeConfig;
  private levels: Map<string, SafeModeLevel> = new Map();  // per-mesh
  private globalLevel: SafeModeLevel;
  private changeHistory: Array<{ meshName: string | null; from: SafeModeLevel; to: SafeModeLevel; reason: string; at: number }> = [];

  constructor(config?: Partial<SafeModeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.globalLevel = this.config.defaultLevel;
  }

  /**
   * Get effective safe mode level for a mesh
   * Mesh-specific overrides take priority over global
   */
  getLevel(meshName?: string): SafeModeLevel {
    if (meshName && this.levels.has(meshName)) {
      return this.levels.get(meshName)!;
    }
    return this.globalLevel;
  }

  /**
   * Get full state for display/API
   */
  getState(meshName?: string): SafeModeState {
    const level = this.getLevel(meshName);
    const lastChange = this.changeHistory.filter(
      h => h.meshName === (meshName || null)
    ).pop();

    return {
      level,
      reason: lastChange?.reason || 'default',
      changedAt: lastChange?.at || 0,
      autoEscalated: lastChange?.reason.startsWith('auto:') || false,
      disabledTools: TOOL_RESTRICTIONS[level],
      blockedActions: ACTION_RESTRICTIONS[level],
    };
  }

  /**
   * Set safe mode level for a specific mesh
   */
  setLevel(meshName: string, level: SafeModeLevel, reason: string): void {
    const prev = this.levels.get(meshName) || this.globalLevel;
    this.levels.set(meshName, level);

    this.changeHistory.push({
      meshName,
      from: prev,
      to: level,
      reason,
      at: Date.now(),
    });

    log.info('safe-mode', `Level changed: ${prev} → ${level}`, {
      meshName,
      reason,
    });
  }

  /**
   * Set global safe mode level
   */
  setGlobalLevel(level: SafeModeLevel, reason: string): void {
    const prev = this.globalLevel;
    this.globalLevel = level;

    this.changeHistory.push({
      meshName: null,
      from: prev,
      to: level,
      reason,
      at: Date.now(),
    });

    log.info('safe-mode', `Global level changed: ${prev} → ${level}`, { reason });
  }

  /**
   * Check if a tool is allowed at the current safe mode level
   */
  isToolAllowed(toolName: string, meshName?: string): boolean {
    const level = this.getLevel(meshName);
    return !TOOL_RESTRICTIONS[level].includes(toolName);
  }

  /**
   * Check if an action is allowed
   */
  isActionAllowed(action: string, meshName?: string): boolean {
    const level = this.getLevel(meshName);
    const blocked = ACTION_RESTRICTIONS[level];
    return !blocked.includes(action) && !blocked.includes('all_operations');
  }

  /**
   * Auto-evaluate safe mode based on current SLI success rate
   * Only acts if autoEscalate is enabled
   */
  evaluateSLI(successRate: number, meshName?: string): SafeModeLevel {
    if (!this.config.autoEscalate) {
      return this.getLevel(meshName);
    }

    let targetLevel: SafeModeLevel = 'normal';
    let reason = '';

    if (successRate < this.config.lockdownThreshold) {
      targetLevel = 'lockdown';
      reason = `auto: SLI ${(successRate * 100).toFixed(1)}% < ${this.config.lockdownThreshold * 100}% lockdown threshold`;
    } else if (successRate < this.config.restrictedThreshold) {
      targetLevel = 'restricted';
      reason = `auto: SLI ${(successRate * 100).toFixed(1)}% < ${this.config.restrictedThreshold * 100}% restricted threshold`;
    } else if (successRate < this.config.cautiousThreshold) {
      targetLevel = 'cautious';
      reason = `auto: SLI ${(successRate * 100).toFixed(1)}% < ${this.config.cautiousThreshold * 100}% cautious threshold`;
    }

    const currentLevel = this.getLevel(meshName);
    // Only escalate, never auto-de-escalate (human must clear)
    if (this.severity(targetLevel) > this.severity(currentLevel)) {
      if (meshName) {
        this.setLevel(meshName, targetLevel, reason);
      } else {
        this.setGlobalLevel(targetLevel, reason);
      }
    }

    return this.getLevel(meshName);
  }

  private severity(level: SafeModeLevel): number {
    const map: Record<SafeModeLevel, number> = {
      normal: 0,
      cautious: 1,
      restricted: 2,
      lockdown: 3,
    };
    return map[level];
  }

  /**
   * Get change history (for forensics)
   */
  getHistory(): typeof this.changeHistory {
    return [...this.changeHistory];
  }

  /**
   * Reset safe mode for a mesh (manual recovery)
   */
  resetMesh(meshName: string): void {
    this.levels.delete(meshName);
    log.info('safe-mode', 'Mesh safe mode reset', { meshName });
  }

  /**
   * Reset all safe mode state
   */
  resetAll(): void {
    this.levels.clear();
    this.globalLevel = this.config.defaultLevel;
    this.changeHistory = [];
  }
}
