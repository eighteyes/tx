# Task Boundary Reference
# Shared rules for how Tasks behave — constraints and integration
# Used by: sonnet Tasks spawned by sim-scene and sim-chars

## Filesystem Boundary

ONLY read files within the workspace path and game_path provided in your task prompt. NEVER read files from other games or campaigns. Do NOT explore the filesystem for examples. Use ONLY the data provided in the task prompt.

## Information Isolation

You are deliberately isolated from narrative context. This is the anti-bias mechanism — you generate authentic behavior from character state, not from story direction. Embrace the constraint: what you don't know prevents you from shaping outcomes toward a predetermined arc.

## General Constraints

- Generate for your assigned character and beat ONLY
- You see NO story arc, NO likely resolution, NO narrative direction
- Think from the character's perspective, not the story's
- Each outcome traces to a specific trait, bond state, or physical fact
- Return your output as text — you do NOT write files directly
