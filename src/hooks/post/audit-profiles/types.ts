/**
 * Audit profile types - shared shape across all checklist-audit profiles.
 *
 * A profile defines: how to detect that it applies to a worker's task,
 * how to collect verifiable evidence after the worker exits, and what
 * checklist items the auditor scores against. The generic checklist-audit
 * post-hook iterates registered profiles, picks the first match, and runs
 * a shared LLM audit using profile-supplied evidence + items.
 */

export interface ChecklistItem {
  /** Stable id used in audit verdict YAML and gap messages. */
  id: string;
  /** Short human-readable name. */
  name: string;
  /** What counts as 'done' — used by both the agent prompt and the auditor. */
  description: string;
  /** If true, status='missing' on this item triggers a block (retry). */
  blocking: boolean;
}

export interface AuditEvidence {
  /** Stable key used to name the verdict file (e.g. instance_id, task_id). */
  key: string;
  /** Primary deliverable to score against the checklist (diff, file, output). */
  artifact: string;
  /** Short label for the artifact, shown in audit prompt header. */
  artifactLabel: string;
  /** Optional tool log / trajectory tail to provide audit context. */
  trajectory?: string;
  /** Free-form k/v shown in the audit prompt header. */
  contextInfo: Record<string, string>;
}

export interface AuditProfile {
  /** Profile id, e.g. 'swebench'. */
  name: string;
  /** Detect that this profile applies to the given task body. First match wins. */
  match(taskBody: string): boolean;
  /** Collect post-completion evidence for the audit (read diff, file, log, etc.). */
  collectEvidence(taskBody: string): Promise<AuditEvidence>;
  /** Items the auditor scores. Same items used in the agent prompt for parity. */
  checklist: readonly ChecklistItem[];
  /**
   * Profile-specific gap-feedback message used for retry. If omitted, a
   * generic gap message is used.
   */
  buildGapFeedback?(blockingGaps: string[], evidence: AuditEvidence): string;
}
