/**
 * AI Linter Types
 *
 * Interfaces for the pluggable language linter framework.
 * Each language linter implements LanguageLinter to provide
 * extension-based file grouping and violation detection.
 */

/**
 * A single lint violation found in a file
 */
export interface LintViolation {
  /** Relative file path */
  file: string;
  /** 1-based line number */
  line: number;
  /** 1-based column (optional) */
  column?: number;
  /** Rule identifier, e.g. 'smart-quotes' */
  rule: string;
  /** Human-readable description */
  message: string;
  /** Error = must fix, warning = informational */
  severity: 'error' | 'warning';
  /** Suggested fix text */
  fix?: string;
}

/**
 * Language-specific linter plugin interface.
 * Implement this to add a new language to the AI linter framework.
 */
export interface LanguageLinter {
  /** Unique name, e.g. 'js', 'python' */
  name: string;
  /** File extensions this linter handles (e.g. ['.ts', '.tsx', '.js', '.jsx']) */
  extensions: string[];
  /** Run all checks on the given files. workDir is cwd for subprocess commands. */
  lint(files: string[], workDir: string, context: Record<string, unknown>): Promise<LintViolation[]>;
}
