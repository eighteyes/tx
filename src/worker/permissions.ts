/**
 * Tool permissions for SDK agents
 *
 * This module provides constants and utilities for configuring tool access
 * in Claude SDK workers using the `dontAsk` permission mode.
 *
 * ## Permission Philosophy: Docker Replacement Model
 *
 * TX replaces Docker isolation with workDir boundary enforcement.
 * Like Docker containers, agents have full tool access but cannot escape
 * their working directory.
 *
 * **Primary Security Boundary**: workDir (enforced by SDK + bash-guard)
 * **Secondary Safety Net**: Catastrophic command denylist
 *
 * ### Bash is Allowed by Default
 *
 * Bash is in DEFAULT_ALLOWED_TOOLS because:
 * - Docker let you run anything inside the container
 * - Our security model is the workDir boundary, not per-command filtering
 * - bash-guard prevents workDir escapes and catastrophic host damage
 * - Network access (curl, wget, ssh, etc.) is explicitly allowed
 *
 * ### What We Block
 *
 * 1. **workDir Boundary Violations** (bash-guard):
 *    - Any file system operation outside the project directory
 *    - Absolute paths not under workDir
 *    - Relative paths that escape workDir
 *
 * 2. **Catastrophic Host Damage** (bash-guard):
 *    - Privilege escalation (sudo, su)
 *    - Root filesystem destruction (rm -rf /)
 *    - System service manipulation (systemctl, reboot)
 *    - Raw disk operations (dd, mkfs)
 *
 * 3. **Subagent Spawning** (Task):
 *    - Denied by default to prevent uncontrolled agent proliferation
 *    - Meshes that need Task must explicitly allow it in allowedTools
 */

// Default allowed tools for safe operation (when no permissions block specified)
export const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',    // Allowed by default — workDir boundary enforced by bash-guard
];

// Tools denied by default (must be explicitly allowed in mesh config)
export const DEFAULT_DISALLOWED_TOOLS = [
  'Task',    // Prevent uncontrolled subagent spawning
];

// Full tool set for core agent (human-in-the-loop session)
export const CORE_AGENT_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'WebFetch',
  'WebSearch',
  'Task',
  'LSP',
  'MCPSearch',
  'TodoWrite',
  'NotebookEdit',
  'Skill',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'KillShell',
];

// Utility callers (no tools needed - text analysis only)
export const UTILITY_CALLER_TOOLS: string[] = [];

// Permission mode type
export type PermissionMode = 'dontAsk' | 'acceptEdits' | 'default' | 'bypassPermissions';

// Permission config interface (matches mesh config schema)
export interface AgentPermissions {
  mode?: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
}

// Resolved permissions (ready for SDK query options)
export interface ResolvedPermissions {
  mode: PermissionMode;
  allowedTools: string[];
  disallowedTools?: string[];
  allowDangerouslySkipPermissions?: boolean;
}

/**
 * Resolve agent permissions with safe defaults
 *
 * @param permissions - Agent permissions from mesh config (optional)
 * @param godMode - Whether god mode is enabled (bypasses all restrictions)
 * @returns Resolved permissions ready for SDK query options
 */
export function resolvePermissions(
  permissions: AgentPermissions | undefined,
  godMode: boolean
): ResolvedPermissions {
  // God mode: bypass all permissions
  if (godMode) {
    return {
      mode: 'bypassPermissions',
      allowedTools: [],
      allowDangerouslySkipPermissions: true,
    };
  }

  // Normal mode: use agent permissions or safe defaults
  // 'default' mode routes unapproved tools through canUseTool for HITL approval.
  // 'dontAsk' silently denies — use only when HITL is not wired up.
  const mode = permissions?.mode || 'default';
  const allowedTools = permissions?.allowedTools || DEFAULT_ALLOWED_TOOLS;
  const baseDisallowed = permissions?.disallowedTools || DEFAULT_DISALLOWED_TOOLS;

  // Explicitly allowed tools override the disallow list.
  // Prevents configs like allowedTools: [Task] from colliding with
  // DEFAULT_DISALLOWED_TOOLS: [Task].
  const allowedSet = new Set(allowedTools);
  const disallowedTools = baseDisallowed.filter(t => !allowedSet.has(t));

  return {
    mode,
    allowedTools,
    disallowedTools,
  };
}
