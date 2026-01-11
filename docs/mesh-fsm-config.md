# Mesh FSM Configuration

System-managed state tracking for mesh orchestration. The FSM observes message flow and provides context to agents.

## Purpose

Remove state management from agent prompts. Agents decide routing using the routing table; FSM observes asks and injects context.

## Schema

```yaml
fsm:
  initial: state_name           # Required: starting state

  context:                      # Optional: initial context values
    key: value

  states:                       # Required: state definitions
    state_name:
      agents: [agent1, ...]     # Agents that can send in this state
      entry:                    # Run on entering state
        set: {key: value}       # Context assignments
        run: [script1, ...]     # Scripts for side effects
      exit:                     # Run on exiting state
        gates:                  # Validate outputs
          agent_name:
            - "$path/file.yaml" # File existence
            - script_name       # Script check
        set: {key: value}       # Extract from agent outputs
        run: [script1, ...]     # Post-processing scripts
      transitions:              # Recipient → next state map
        agent_name: next_state
        [agent1, agent2]: next_state

  scripts:                      # Required: bash scripts
    script_name: "command"
    script_name: |
      multiline
      bash script
```

## State Fields

### `agents`
List of agents that can send messages in this state. Used for validation.

```yaml
awaiting_narrator:
  agents: [narrator]
```

### `entry`
Executed when entering this state. Optional.

```yaml
init:
  entry:
    set:
      turn: "$((turn + 1))"
      workspace: "$game_path/turns/turn-$turn"
    run: [generate_entropy, mkdir_workspace]
```

**`entry.set`**: Context assignments using bash syntax
- Variables: `$workspace`, `$turn`
- Arithmetic: `$((turn + 1))`
- Commands: `$(yq '.field' $file)`
- String interpolation: `"$game_path/turns/turn-$turn"`

**`entry.run`**: Script names to execute (side effects like mkdir, logging)

### `exit`
Executed when exiting this state. Optional.

```yaml
awaiting_narrator:
  exit:
    gates:
      narrator:
        - "$workspace/prose-draft.md"
        - check_min_word_count
    set:
      word_count: "$(wc -w < $workspace/prose-draft.md)"
    run: [generate_concordance, extract_dialogue]
```

**`exit.gates`**: Validate agent outputs before allowing transition
- File paths: `"$workspace/file.yaml"` (must exist)
- Scripts: `check_min_word_count` (exit 0 = pass, non-zero = fail with stderr message)

Gate results injected into coordinator prompt:
```markdown
## Gate Results
state: awaiting_narrator
agent: narrator
passed: true|false
failures:
  - check_min_word_count: "Expected 800+ words, found 654"
```

**`exit.set`**: Extract data from agent outputs (files they wrote)

**`exit.run`**: Post-processing scripts

### `transitions`
Map of message recipients → next state.

```yaml
init:
  transitions:
    narrator: game_creation                   # Single recipient
    [dramaturg, scene-crafter]: awaiting_prep # Multiple recipients
```

**Key formats:**
- Single agent: `agent_name`
- Multiple agents: `[agent1, agent2]` (exact match, order matters)

**Value**: Target state name

Coordinator decides who to ask, FSM looks up transition in current state's map.

## Scripts

All scripts run as bash. Context variables available as env vars.

### Single-line Scripts

```yaml
scripts:
  turn: "echo $((turn + 1))"
  workspace: "echo \"$game_path/campaigns/$campaign_id/turns/turn-$turn\""
```

### Multi-line Scripts

```yaml
scripts:
  extract_game_paths: |
    game_id=$(jq -r '.game_id' <<< "$payload")
    campaign_id=$(jq -r '.campaign_id' <<< "$payload")
    game_path=$(jq -r '.game_path' <<< "$payload")
    echo "game_id=$game_id"
    echo "campaign_id=$campaign_id"
    echo "game_path=$game_path"
```

### Script Environment

All scripts receive:

| Variable | Type | Description |
|----------|------|-------------|
| `$turn` | number | Context: turn number |
| `$game_path` | string | Context: game directory path |
| `$workspace` | string | Context: workspace path |
| `$entropy` | array | Context: entropy values (JSON) |
| `$state` | string | FSM: current state name |
| `$payload` | JSON | Message: body content |
| `$from` | string | Message: sender agent name |

**Output handling:**
- Entry scripts: stdout → sets `context.{script_name}`
- Exit scripts: stdout → sets `context.{script_name}`
- Multi-line output: `key=value` pairs, one per line

Example multi-value output:
```bash
echo "game_id=$game_id"
echo "campaign_id=$campaign_id"
echo "game_path=$game_path"
```

## Execution Flow

1. **Agent spawns** → receives injected FSM context in prompt:
   ```markdown
   ## FSM Context
   state: init
   turn: 5
   workspace: /path/to/turns/turn-5
   entropy: [23, 89, 12, ...]
   ```

2. **Agent decides routing** → writes ask to recipients (using routing table)

3. **Dispatcher observes ask** → extracts recipients from message

4. **FSM looks up transition** → checks `current_state.transitions[recipients]`

5. **FSM runs exit scripts** → executes current state's exit scripts (if any)

6. **FSM transitions** → changes to new state

7. **FSM runs entry scripts** → executes new state's entry scripts, updates context

8. **FSM persists** → saves state + context to SQLite

9. **Dispatcher injects** → adds updated FSM context to ask before sending

## Example: narrative-engine (complete)

```yaml
fsm:
  initial: init

  context:
    turn: 0
    game_id: null
    campaign_id: null
    game_path: null
    workspace: null
    entropy: []
    revision_count: 0
    max_revisions: 3

  states:
    init:
      agents: [coordinator]
      entry:
        set:
          turn: "$((turn + 1))"
          workspace: "$game_path/campaigns/$campaign_id/turns/turn-$turn"
          revision_count: 0
        run: [generate_entropy, mkdir_workspace]
      exit:
        gates:
          coordinator:
            - "$workspace"
      transitions:
        narrator: game_creation
        [dramaturg, scene-crafter]: awaiting_prep

    game_creation:
      agents: [narrator]
      entry:
        set:
          turn: 0
      exit:
        gates:
          narrator:
            - check_game_created
        set:
          game_id: "$(yq '.game_id' $workspace/game-spec.yaml)"
          campaign_id: "$(yq '.campaign_id' $workspace/game-spec.yaml)"
          game_path: "$(yq '.game_path' $workspace/game-spec.yaml)"
      transitions:
        coordinator: prologue

    prologue:
      agents: [coordinator]
      entry:
        set:
          workspace: "$game_path/campaigns/$campaign_id/turns/turn-0"
        run: [generate_entropy, mkdir_workspace]
      exit:
        gates:
          coordinator:
            - "$workspace/context.yaml"
      transitions:
        [dramaturg, scene-crafter]: awaiting_prep

    awaiting_prep:
      agents: [dramaturg, scene-crafter]
      exit:
        gates:
          dramaturg:
            - "$workspace/dramaturg-notes.yaml"
            - check_dramaturg_valid
          scene-crafter:
            - "$workspace/scene-outline.yaml"
            - check_scene_valid
      transitions:
        narrator: awaiting_narrator

    awaiting_narrator:
      agents: [narrator]
      exit:
        gates:
          narrator:
            - "$workspace/prose-draft.md"
            - check_min_word_count
        run: [generate_concordance, extract_dialogue]
        set:
          word_count: "$(wc -w < $workspace/prose-draft.md)"
      transitions:
        core: awaiting_hitl
        editor: awaiting_editor

    awaiting_hitl:
      agents: [core]
      exit:
        set:
          user_input: "$(yq '.response' $workspace/hitl-response.yaml)"
      transitions:
        narrator: awaiting_narrator

    awaiting_editor:
      agents: [editor]
      entry:
        set:
          revision_count: "$((revision_count + 1))"
      exit:
        gates:
          editor:
            - "$workspace/review.yaml"
            - check_max_revisions
        set:
          verdict: "$(yq '.verdict' $workspace/review.yaml)"
          violations_count: "$(yq '.violations | length' $workspace/review.yaml)"
        run: [log_revision]
      transitions:
        narrator: awaiting_narrator
        oracle: awaiting_oracle

    awaiting_oracle:
      agents: [oracle]
      entry:
        run: [rename_prose_final]
      exit:
        gates:
          oracle:
            - "$workspace/oracle-verdict.yaml"
        set:
          approved: "$(yq '.approved' $workspace/oracle-verdict.yaml)"
          lore_violations: "$(yq '.violations | length' $workspace/oracle-verdict.yaml)"
      transitions:
        narrator: awaiting_narrator
        scribe: awaiting_scribe

    awaiting_scribe:
      agents: [scribe]
      exit:
        gates:
          scribe:
            - "$workspace/summary.md"
            - "$workspace/entities-updated.yaml"
        run: [update_story_concordance]
      transitions:
        coordinator: complete

    complete:
      agents: [coordinator]
      entry:
        set:
          revision_count: 0
      exit:
        gates:
          coordinator:
            - check_coordinator_ready
      transitions:
        [dramaturg, scene-crafter]: awaiting_prep

  scripts:
    generate_entropy: |
      shuf -i 1-100 -n 10 | jq -c -s '.' > $workspace/entropy.json
      cat $workspace/entropy.json

    mkdir_workspace: |
      mkdir -p $workspace

    check_game_created: |
      [[ -f $workspace/game-spec.yaml ]] && \
      yq -e '.game_path' $workspace/game-spec.yaml > /dev/null

    check_dramaturg_valid: |
      yq -e '.beats | length >= 3' $workspace/dramaturg-notes.yaml

    check_scene_valid: |
      yq -e '.scenes | length >= 1' $workspace/scene-outline.yaml

    check_min_word_count: |
      count=$(wc -w < $workspace/prose-draft.md)
      [[ $count -ge 800 ]] || {
        echo "Expected 800+ words, found $count" >&2
        exit 1
      }

    check_max_revisions: |
      [[ $revision_count -le $max_revisions ]] || {
        echo "Max revisions ($max_revisions) reached" >&2
        exit 1
      }

    check_coordinator_ready: |
      ./scripts/coordinator-ready.sh $workspace

    generate_concordance: |
      tr '[:upper:]' '[:lower:]' < $workspace/prose-draft.md | \
      tr -cs '[:alpha:]' '\n' | \
      sort | uniq -c | sort -rn > $workspace/concordance.txt

    extract_dialogue: |
      ./meshes/narrative-engine/extract-dialogue.sh \
        $workspace/prose-draft.md \
        $workspace/dialogue-pairs.txt

    rename_prose_final: |
      mv $workspace/prose-draft.md $workspace/prose.md

    update_story_concordance: |
      cat $workspace/concordance.txt >> $game_path/story-concordance.txt
      sort $game_path/story-concordance.txt | \
      uniq -c | sort -rn > $game_path/story-concordance-sorted.txt
      mv $game_path/story-concordance-sorted.txt $game_path/story-concordance.txt

    log_revision: |
      echo "Turn $turn revision $revision_count: verdict=$verdict, violations=$violations_count" \
        >> $workspace/revision.log
```

## Key Patterns Shown

**Agent-created values:**
```yaml
game_creation:
  exit:
    set:
      game_id: "$(yq '.game_id' $workspace/game-spec.yaml)"
      game_path: "$(yq '.game_path' $workspace/game-spec.yaml)"
```
Narrator writes game-spec.yaml, FSM extracts paths from it.

**Iteration tracking:**
```yaml
awaiting_editor:
  entry:
    set:
      revision_count: "$((revision_count + 1))"
  exit:
    gates:
      editor:
        - check_max_revisions
```
Counter increments on each loop, gate enforces limit.

**Gate validation with error messages:**
```yaml
scripts:
  check_min_word_count: |
    count=$(wc -w < $workspace/prose-draft.md)
    [[ $count -ge 800 ]] || {
      echo "Expected 800+ words, found $count" >&2
      exit 1
    }
```
Coordinator sees gate failure with message in injected context.

**Parallel agents:**
```yaml
awaiting_prep:
  agents: [dramaturg, scene-crafter]
  exit:
    gates:
      dramaturg: [...]
      scene-crafter: [...]
```
Both must respond and pass gates before coordinator can transition.

## Validation

The mesh validator checks:

1. **Initial state exists** in states map
2. **Transition targets exist** in states map
3. **Agent names** in `agents` field match mesh agents
4. **Transition keys** match mesh routing config
5. **Script syntax** (bash -n validation)

## Benefits

1. **Agents focus on decisions** - routing logic in agent prompts
2. **FSM provides context** - turn, workspace, entropy available
3. **Deterministic state** - no LLM inference, system tracks state
4. **Observable** - state transitions logged, queryable via CLI
5. **Resumable** - state persists across worker spawns

## Anti-patterns

**Don't use FSM for:**
- Controlling agent routing (agents decide that)
- Complex conditional logic (keep in agent prompts)
- Micro-managing agent interactions (FSM is for phase-level state)

**Do use FSM for:**
- Tracking pipeline state (init → prep → render → review → complete)
- Providing turn context (workspace paths, entropy, counters)
- Running lifecycle scripts (workspace creation, post-processing)
