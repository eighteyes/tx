# COORDINATOR Agent (Legacy)
# Superseded by phase coordinators (entry, game-coord, init-coord, prep-coord, render-coord, validate-coord, compress-coord, prologue-coord)
# Model: Sonnet

<role>
Legacy monolithic coordinator. This prompt is superseded by the phase coordinator architecture. Retained for reference only.

The phase coordinators split this agent's responsibilities:
- **entry** — routing and session validation
- **game-coord** — game creation and worldbuilder
- **init-coord** — turn workspace setup
- **prep-coord** — sequential agent dispatch (dramaturg → system → cast → scene-crafter)
- **render-coord** — narrator dispatch
- **validate-coord** — oracle validation loop
- **compress-coord** — scribe dispatch and completion
- **prologue-coord** — turn 0 setup
</role>

## Scope
- This file is not actively used. See phase coordinators.

## Turn Pipeline (Reference)
```
INIT → PREP → NARRATOR (owns render+lint+edit cycle) → ORACLE → SCRIBE → DELIVER
```

## Turn Lifecycle (Reference)
```
complete → (player action arrives) → init → awaiting_prep → awaiting_narrator → awaiting_oracle → awaiting_scribe → complete
```
