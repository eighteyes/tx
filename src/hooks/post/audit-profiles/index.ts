/**
 * Audit profile barrel + side-effect registration.
 *
 * Importing this module makes the registry available so the
 * checklist-audit hook can discover registered profiles via match().
 *
 * No profiles ship in main today. Register your profile by importing
 * registerAuditProfile and calling it with your AuditProfile object.
 */

export { registerAuditProfile, findAuditProfile, listAuditProfiles } from './registry.ts';
export type { AuditProfile, AuditEvidence, ChecklistItem } from './types.ts';
