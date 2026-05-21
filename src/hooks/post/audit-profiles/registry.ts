/**
 * Audit profile registry - lookup-by-match for the checklist-audit hook.
 *
 * Profiles register themselves at module load (see ./index.ts). The hook
 * iterates registered profiles and dispatches to the first one whose
 * match(taskBody) returns true. If none match, the hook fails open.
 */

import type { AuditProfile } from './types.ts';

const profiles: AuditProfile[] = [];

export function registerAuditProfile(profile: AuditProfile): void {
  if (profiles.some(p => p.name === profile.name)) return;
  profiles.push(profile);
}

export function findAuditProfile(taskBody: string): AuditProfile | null {
  for (const p of profiles) {
    try {
      if (p.match(taskBody)) return p;
    } catch {
      /* a misbehaving matcher must not break the loop */
    }
  }
  return null;
}

export function listAuditProfiles(): readonly AuditProfile[] {
  return profiles;
}
