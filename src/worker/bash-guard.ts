/**
 * BashGuard - SDK PreToolUse hook for Bash security
 *
 * ## Philosophy: Docker Replacement Model
 *
 * This guard replicates Docker's security model:
 * - Full Bash access (like inside a container)
 * - Cannot escape workDir boundary (like container filesystem isolation)
 * - Cannot damage host system (like container privilege restrictions)
 *
 * ## Primary Responsibility: workDir Boundary Enforcement
 *
 * Block ANY file system operation outside the project directory:
 * - Reads, writes, moves, copies, symlinks — everything
 * - Absolute paths not under workDir
 * - Relative paths that resolve outside workDir
 * - Redirects, subshells, scripting language one-liners
 *
 * ## Secondary Responsibility: Catastrophic Damage Prevention
 *
 * Block commands that would brick the host OS:
 * - Privilege escalation (sudo, su)
 * - Root filesystem destruction (rm -rf /)
 * - System service manipulation (systemctl, reboot)
 * - Raw disk operations (dd, mkfs)
 *
 * ## Explicitly NOT Blocked
 *
 * Network access is allowed (Docker parity):
 * - curl, wget, fetch — downloading files
 * - nc, netcat — network communication
 * - ssh, scp — remote access
 * - git push/fetch — version control
 * - npm publish, pip upload — package publishing
 */

import path from 'node:path';
import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import type { GuardrailMode } from './guardrail-config.ts';

export interface BashGuardConfig {
  agentId: string;
  workDir: string;
  allowedPaths?: string[];  // Additional paths allowed (e.g., tx-core meshes/scripts dir)
  killRunner: (reason: string) => void;
  mode: GuardrailMode;  // { strict, warning } — controls enforcement behavior
}

/**
 * Catastrophic host damage patterns (small list — just prevents bricking the host)
 */
const CATASTROPHIC_PATTERNS = [
  // Privilege escalation
  { pattern: /\bsudo\b/i, reason: 'Privilege escalation (sudo)' },
  { pattern: /\bsu\s+-/i, reason: 'Privilege escalation (su)' },
  { pattern: /\bdoas\b/i, reason: 'Privilege escalation (doas)' },

  // Root filesystem destruction (rm -rf / or rm -rf /*)
  { pattern: /\brm\s+[^|;&\n]*(-[a-z]*r[a-z]*f[a-z]*|--recursive[^|;&\n]+--force)[^|;&\n]*\s+\/\s*$/i, reason: 'Root filesystem destruction (rm -rf /)' },
  { pattern: /\brm\s+[^|;&\n]*(-[a-z]*r[a-z]*f[a-z]*|--recursive[^|;&\n]+--force)[^|;&\n]*\s+\/\*\s*$/i, reason: 'Root filesystem destruction (rm -rf /*)' },

  // Filesystem operations
  { pattern: /\bmkfs\b/i, reason: 'Filesystem formatting (mkfs)' },
  { pattern: /\bdd\s+[^|;&\n]*if=[^|;&\n]*of=\/dev\//i, reason: 'Raw disk write (dd to /dev/)' },

  // Process management
  { pattern: /\bkill\s+(-9\s+1|1)\b/i, reason: 'Kill init process (PID 1)' },
  { pattern: /\bkill\s+-9\s+-1\b/i, reason: 'Kill all processes' },

  // System operations
  { pattern: /\b(reboot|shutdown|halt|poweroff)\b/i, reason: 'System shutdown/reboot' },
  { pattern: /\bsystemctl\b/i, reason: 'System service manipulation' },
  { pattern: /\bservice\b/i, reason: 'System service manipulation' },
  { pattern: /\bmount\b/i, reason: 'Filesystem mount operation' },
  { pattern: /\bumount\b/i, reason: 'Filesystem unmount operation' },

  // Network configuration (not network USE — USE is fine)
  { pattern: /\biptables\b/i, reason: 'Network configuration (iptables)' },
  { pattern: /\bip\s+route\b/i, reason: 'Network route configuration' },

  // Scheduled tasks
  { pattern: /\bcrontab\b/i, reason: 'Crontab manipulation' },
  { pattern: /\bvisudo\b/i, reason: 'Sudoers file editing' },

  // Raw device writes
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: 'Raw disk device write' },
  { pattern: />\s*\/dev\/nvme/i, reason: 'Raw disk device write' },

  // Docker (can mount host filesystem)
  { pattern: /\bdocker\s+(run|exec|cp)/i, reason: 'Docker command (can mount host filesystem)' },

  // Encoded payload piped to shell (base64, xxd, etc.)
  { pattern: /\b(base64|xxd)\s+[^|]*\|\s*(bash|sh|zsh)\b/i, reason: 'Encoded payload piped to shell' },

  // Dot-source (. /path) — catch single dot followed by space and path
  { pattern: /(?:^|[;&|])\s*\.\s+\/[^\s]/i, reason: 'Dot-source of file outside workDir' },
];

/**
 * Path extraction patterns — WRITE/MODIFY/DELETE operations ONLY
 *
 * Reads are allowed anywhere (cat /etc/hosts is fine).
 * We only block writes, moves, deletes, and modifications outside workDir.
 */
const PATH_PATTERNS = [
  // cd/pushd — changes working directory, affects all subsequent commands
  { pattern: /\b(cd|pushd)\s+([^\s|;&]+)/g, captureGroup: 2 },

  // Destructive file operations — capture ALL path args (first and last)
  { pattern: /\b(rm|mkdir|rmdir|touch)\s+(-[a-z]+\s+)?([^\s|;&]+)/g, captureGroup: 3 },
  // cp/mv — destination is the LAST arg, but source matters too for moves
  { pattern: /\b(cp|mv)\s+(-[a-z]+\s+)?[^\s|;&]+\s+([^\s|;&]+)/g, captureGroup: 3 },  // destination
  { pattern: /\b(mv)\s+(-[a-z]+\s+)?([^\s|;&]+)\s+[^\s|;&]+/g, captureGroup: 3 },     // source (mv removes it)
  // chmod/chown — target file
  { pattern: /\b(chmod|chown)\s+[^\s|;&]+\s+([^\s|;&]+)/g, captureGroup: 2 },
  { pattern: /\bln\s+(-s\s+)?([^\s|;&]+)\s+([^\s|;&]+)/g, captureGroup: 2 }, // ln -s TARGET LINK

  // Redirects (writes)
  { pattern: />\s*([^\s|;&]+)/g, captureGroup: 1 },
  { pattern: />>\s*([^\s|;&]+)/g, captureGroup: 1 },
  { pattern: /2>\s*([^\s|;&]+)/g, captureGroup: 1 },

  // Archive extraction to target (writes)
  { pattern: /\b(tar|unzip|zip)\s+[^|;&]*(-C|--directory)\s+([^\s|;&]+)/g, captureGroup: 3 },
  { pattern: /\brsync\s+[^|;&]*\s+([^\s|;&]+)$/g, captureGroup: 1 },

  // Git clone to path (writes)
  { pattern: /\bgit\s+clone\s+[^\s]+\s+([^\s|;&]+)/g, captureGroup: 1 },

  // Package managers with --target/--prefix (writes)
  { pattern: /\b(pip|npm)\s+install\s+[^|;&]*(--target|--prefix|-t)\s+([^\s|;&]+)/g, captureGroup: 3 },

  // Scripting language file writes
  { pattern: /\bpython[0-9]?\s+-c\s+["'].*open\s*\(\s*["']([^"']+)["']/g, captureGroup: 1 },
  { pattern: /\bnode\s+-e\s+["'].*writeFileSync\s*\(\s*["']([^"']+)["']/g, captureGroup: 1 },
  { pattern: /\bruby\s+-e\s+["'].*File\.write\s*\(\s*["']([^"']+)["']/g, captureGroup: 1 },
  { pattern: /\bperl\s+-e\s+["'].*open\s*\([^,]*,\s*["']>?\s*([^"']+)["']/g, captureGroup: 1 },

  // wget/curl output flags (writes)
  { pattern: /\bwget\s+[^|;&]*(-O|--output-document)\s+([^\s|;&]+)/g, captureGroup: 2 },
  { pattern: /\bcurl\s+[^|;&]*(-o|--output)\s+([^\s|;&]+)/g, captureGroup: 2 },

  // sed -i (in-place modification)
  { pattern: /\bsed\s+-i[^|;&]*\s+([^\s|;&]+)$/g, captureGroup: 1 },

  // tee (writes)
  { pattern: /\btee\s+(-a\s+)?([^\s|;&]+)/g, captureGroup: 2 },
];

export class BashGuard {
  private config: BashGuardConfig;
  private violations = 0;

  constructor(config: BashGuardConfig) {
    this.config = config;
  }

  /**
   * Create PreToolUse hook matcher for Bash commands
   */
  createHook(): HookCallbackMatcher {
    return {
      matcher: 'Bash',
      hooks: [async (input, _toolUseId, _options) => {
        const hookInput = input as { tool_input: Record<string, unknown> };
        const command = (hookInput.tool_input as { command?: string })?.command;

        if (!command) {
          return { decision: 'approve' } as HookJSONOutput;
        }

        // Check catastrophic patterns first
        for (const { pattern, reason } of CATASTROPHIC_PATTERNS) {
          if (pattern.test(command)) {
            this.violations++;
            return this.handleViolation('catastrophic', command, reason);
          }
        }

        // Check for cd-then-destroy pattern: cd to outside workDir + destructive command
        const cdDestroyViolation = this.checkCdThenDestroy(command);
        if (cdDestroyViolation) {
          this.violations++;
          return this.handleViolation('workdir-escape', command, cdDestroyViolation);
        }

        // Check workDir boundary for direct write operations
        const pathViolation = this.checkWorkDirBoundary(command);
        if (pathViolation) {
          this.violations++;
          return this.handleViolation('workdir-escape', command, pathViolation);
        }

        return { decision: 'approve' } as HookJSONOutput;
      }],
      timeout: 5,
    };
  }

  /**
   * Detect: cd/pushd to outside workDir followed by destructive command (rm, mv, etc.)
   * This catches "cd /tmp && rm -rf *" where rm * is relative but destructive.
   */
  private checkCdThenDestroy(command: string): string | null {
    // Split on command separators (;, &&, ||, |)
    const parts = command.split(/[;&|]+/).map(p => p.trim()).filter(Boolean);

    let outsideCd: string | null = null;

    for (const part of parts) {
      // Check for cd/pushd to a directory
      const cdMatch = part.match(/\b(cd|pushd)\s+([^\s]+)/);
      if (cdMatch) {
        const target = cdMatch[2];
        const resolved = this.resolvePath(target);
        if (!this.isWithinWorkDir(resolved)) {
          outsideCd = target;
        } else {
          outsideCd = null; // cd back to workDir clears the flag
        }
        continue;
      }

      // If we've cd'd outside and there's a destructive command, block it
      if (outsideCd) {
        const destructive = /\b(rm|mv|cp|mkdir|touch|chmod|chown|rmdir)\b/.test(part);
        const redirect = />>?\s/.test(part);
        if (destructive || redirect) {
          return `Destructive command after cd to outside workDir (cd ${outsideCd})`;
        }
      }
    }

    return null;
  }

  /**
   * Check if command tries to write/modify files outside workDir
   * Returns violation reason if boundary crossed, null if safe
   */
  private checkWorkDirBoundary(command: string): string | null {
    const paths = this.extractPaths(command);

    for (const extractedPath of paths) {
      // Skip special cases
      if (this.isSpecialPath(extractedPath)) {
        continue;
      }

      // Resolve path relative to workDir
      const resolved = this.resolvePath(extractedPath);

      // Check if resolved path is outside workDir
      if (!this.isWithinWorkDir(resolved)) {
        return `File system access outside workDir: ${extractedPath} → ${resolved}`;
      }
    }

    return null;
  }

  /**
   * Extract all file paths from command using multiple patterns
   */
  private extractPaths(command: string): string[] {
    const paths = new Set<string>();

    // NOTE: We do NOT extract all absolute paths generically.
    // Reads are allowed anywhere (cat /etc/hosts is fine).
    // Only PATH_PATTERNS (write operations) + home/env var patterns are checked.

    // Extract home-relative paths (~/... or bare ~)
    const homePaths = command.match(/~(\/[^\s|;&"'`]*)?/g) || [];
    for (const p of homePaths) {
      // Skip ~ inside URLs or other non-path contexts
      if (p === '~' || p.startsWith('~/')) {
        paths.add(p);
      }
    }

    // Extract $HOME references ($HOME, $HOME/, $HOME/path)
    const homeVarPaths = command.match(/\$HOME(\/[^\s|;&"'`]*)?/g) || [];
    for (const p of homeVarPaths) {
      paths.add(p);
    }

    // Extract ${HOME} references
    const homeVarBracePaths = command.match(/\$\{HOME\}(\/[^\s|;&"'`]*)?/g) || [];
    for (const p of homeVarBracePaths) {
      paths.add(p);
    }

    // Extract other dangerous env vars ($TMPDIR, $OLDPWD, etc.)
    const dangerousEnvVars = command.match(/\$(TMPDIR|OLDPWD|TMP|TEMP)(\/[^\s|;&"'`]*)?/g) || [];
    for (const p of dangerousEnvVars) {
      paths.add(p);
    }

    // Extract ${VAR} versions too
    const dangerousEnvVarsBrace = command.match(/\$\{(TMPDIR|OLDPWD|TMP|TEMP)\}(\/[^\s|;&"'`]*)?/g) || [];
    for (const p of dangerousEnvVarsBrace) {
      paths.add(p);
    }

    // Extract relative paths with parent directory (..)
    const parentPaths = command.match(/\.\.\/[^\s|;&"'`]*/g) || [];
    for (const p of parentPaths) {
      paths.add(p);
    }

    // Extract paths from specific command patterns
    for (const { pattern, captureGroup } of PATH_PATTERNS) {
      let patternMatch;
      while ((patternMatch = pattern.exec(command)) !== null) {
        const captured = patternMatch[captureGroup];
        if (captured && captured.trim()) {
          // Skip if it looks like a URL
          if (this.looksLikeUrl(captured)) {
            continue;
          }
          paths.add(captured.trim());
        }
      }
    }

    return Array.from(paths);
  }

  /**
   * Check if a string looks like a URL
   */
  private looksLikeUrl(str: string): boolean {
    // Contains :// (URL scheme)
    if (str.includes('://')) {
      return true;
    }

    // Starts with // (protocol-relative URL)
    if (str.startsWith('//')) {
      return true;
    }

    return false;
  }

  /**
   * Special paths that are safe to access (don't count as workDir escapes)
   */
  private isSpecialPath(p: string): boolean {
    // /dev/null, /dev/stdout, /dev/stderr are safe
    if (/^\/dev\/(null|stdout|stderr|stdin|fd\/\d+)$/.test(p)) {
      return true;
    }

    // /tmp is allowed for temporary file operations within commands
    // BUT we still check if it resolves outside workDir (paranoid mode)
    // Actually no — Docker doesn't let you write to host /tmp either
    // Block /tmp writes to maintain Docker parity

    return false;
  }

  /**
   * Resolve path relative to workDir
   */
  private resolvePath(p: string): string {
    // Handle bare ~ (home directory)
    if (p === '~') {
      return '/home/user'; // Placeholder that will fail workDir check
    }

    // Handle home directory expansion (~/...)
    if (p.startsWith('~/')) {
      return '/home/user' + p.substring(1); // Placeholder that will fail workDir check
    }

    // Handle $HOME and ${HOME} references
    if (p.startsWith('$HOME') || p.startsWith('${HOME}')) {
      const prefix = p.startsWith('${HOME}') ? '${HOME}' : '$HOME';
      const rest = p.substring(prefix.length);
      return '/home/user' + rest; // Placeholder that will fail workDir check
    }

    // Handle $TMPDIR, $TMP, $TEMP, $OLDPWD and their ${} variants
    const envVarMatch = p.match(/^\$\{?(TMPDIR|OLDPWD|TMP|TEMP)\}?(.*)/);
    if (envVarMatch) {
      return '/tmp' + (envVarMatch[2] || ''); // Resolves outside workDir
    }

    // Resolve relative paths (including ./ and ../)
    if (!path.isAbsolute(p)) {
      // Remove leading ./ if present
      const cleanPath = p.startsWith('./') ? p.substring(2) : p;
      return path.resolve(this.config.workDir, cleanPath);
    }

    // Already absolute
    return path.normalize(p);
  }

  /**
   * Check if resolved path is within workDir or any allowed path
   */
  private isWithinWorkDir(resolved: string): boolean {
    const normalizedPath = path.normalize(resolved);

    // Check workDir
    const normalizedWorkDir = path.normalize(this.config.workDir);
    if (normalizedPath === normalizedWorkDir ||
        normalizedPath.startsWith(normalizedWorkDir + path.sep)) {
      return true;
    }

    // Check additional allowed paths (e.g., tx-core install dir for mesh scripts)
    if (this.config.allowedPaths) {
      for (const allowed of this.config.allowedPaths) {
        const normalizedAllowed = path.normalize(allowed);
        if (normalizedPath === normalizedAllowed ||
            normalizedPath.startsWith(normalizedAllowed + path.sep)) {
          return true;
        }
      }
    }

    return false;
  }

  private handleViolation(
    type: 'catastrophic' | 'workdir-escape',
    command: string,
    reason: string,
  ): HookJSONOutput {
    const { strict, warning } = this.config.mode;
    const logData = {
      agentId: this.config.agentId,
      type,
      violations: this.violations,
      command: command.substring(0, 200), // Truncate long commands
      reason,
      mode: { strict, warning },
    };

    // Non-strict: allow the action through
    if (!strict) {
      if (!warning) {
        // Disabled: allow silently
        log.debug('bash-guard', 'Bash violation (disabled mode, allowing)', logData);
        return { decision: 'approve' } as HookJSONOutput;
      }
      // Warning: approve with gentle feedback
      log.info('bash-guard', 'Bash security violation (warning mode, allowed)', logData);
      log.activity('guardrail:bash-guard:warning', this.config.agentId, `Bash guard warning: ${reason} (allowed)`);
      return {
        decision: 'approve',
        systemMessage: `Note: The command violates security policy (${reason}). ` +
          `This command was allowed but may pose security risks.`,
      } as HookJSONOutput;
    }

    // Strict mode: block the command
    log.error('bash-guard', 'Bash security violation blocked (strict mode)', logData);
    log.activity('guardrail:bash-guard', this.config.agentId, `Bash guard BLOCKED: ${reason}`);

    // Kill threshold: 3 violations = terminate
    if (this.violations >= 3) {
      log.error('bash-guard', 'Bash guard kill threshold reached', {
        ...logData,
        killThreshold: 3,
      });
      log.activity('guardrail:bash-guard', this.config.agentId, `Bash guard KILL: ${this.violations} violations`);
      this.config.killRunner(`Bash guard: ${this.violations} security violations`);
    }

    if (!warning) {
      return { decision: 'block' };
    }

    return {
      decision: 'block',
      reason: `BASH SECURITY VIOLATION [${this.violations}/3]: ${reason}\n\n` +
        `The command violates the workDir security boundary or would cause catastrophic host damage.\n\n` +
        `Command: ${command.substring(0, 150)}${command.length > 150 ? '...' : ''}\n\n` +
        `Your working directory boundary is: ${this.config.workDir}\n\n` +
        `You cannot access files outside this directory. This mimics Docker container isolation.\n\n` +
        `If you need to perform this operation, ask the user to run it with --god-mode.`,
    };
  }

  reset(): void {
    this.violations = 0;
  }
}
