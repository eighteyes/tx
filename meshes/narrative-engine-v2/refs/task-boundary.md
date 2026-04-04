# Task Boundary Reference
# Shared rules for how Tasks behave — constraints and integration
# Used by: all haiku Tasks spawned by architect

## Filesystem Boundary

ONLY read files within the workspace path and game_path provided in your task prompt. NEVER read files from other games or campaigns. Do NOT explore the filesystem for examples. Use ONLY the data provided in the task prompt.

## Thread Integration

Life threads are things running underneath the scene — they may surface in subtable entries as texture. When generating subtable entries, consider: could this outcome trigger a thread to surface? If so, reference it in the `mechanical_note`. Threads don't replace outcome types — they color the specific manifestation within each type.

## General Constraints

- Generate possibilities for your assigned domain ONLY
- You see NO story arc, NO likely resolution, NO narrative direction
- Think from the character's perspective, not the story's
- Each outcome traces to a specific trait, bond state, or physical fact
- Write output files to `{workspace}/entropy_tables/` as specified in your task prompt
