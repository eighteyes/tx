/**
 * Tool permissions for SDK agents
 *
 * Responsibilities:
 * - Define permission constants and types for Claude SDK workers
 * - Resolve agent permissions from mesh config into SDK-ready format
 * - Enforce deny-by-default for dangerous tools (Task)
 *
 * ## Permission Model
 *
 * Permissive by default. Agents get full SDK tool access unless restricted.
 *
 * **Primary Security Boundary**: workDir (enforced by SDK + bash-guard)
 * **Secondary Safety Net**: Catastrophic command denylist in bash-guard
 *
 * ### What We Block
 *
 * 1. **workDir Boundary Violations** (bash-guard):
 *    - File system operations outside the project directory
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

// All tools pre-approved by default (when no permissions block defined)
export const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
  'TodoWrite',
  'KillShell',
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
 * No permissions block = unrestricted (empty allowedTools → SDK uses full set).
 * Task is denied by default via disallowedTools unless explicitly allowed.
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

  // No permissions block = all tools pre-approved.
  // canUseTool HITL gate remains active as fallback for unknown tools.
  if (!permissions) {
    return {
      mode: 'default',
      allowedTools: DEFAULT_ALLOWED_TOOLS,
      disallowedTools: DEFAULT_DISALLOWED_TOOLS,
    };
  }

  // Explicit permissions: 'default' routes unapproved tools through canUseTool.
  const mode = permissions.mode || 'default';
  const allowedTools = permissions.allowedTools || [];
  const baseDisallowed = permissions.disallowedTools || DEFAULT_DISALLOWED_TOOLS;

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
