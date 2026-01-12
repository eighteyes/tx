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

### `exit.run` - Direct Routing (New)

Direct routing specification using either a literal state name or a script that outputs the target state.

```yaml
# Literal state name
simple_state:
  exit:
    run: next_state  # Directly specify target state

# Script that echoes state (dynamic routing)
conditional_state:
  exit:
    run: |
      signal="$FSM_CTX_SUCCESS_SIGNAL"
      if [ "$signal" = "PASS" ]; then
        echo "sonnet_review_loop"
      else
        echo "ralph_haiku_loop"
      fi
    set:
      success_signal: "$(echo '$REARMATTER' | yq '.success_signal')"
```

**Script requirements:**
- Must output a valid state name to stdout (single line, trimmed)
- Has access to all FSM context variables via `$FSM_CTX_*` env vars
- Exit code 0 = success, non-zero = fail and fall through to `when` or `default`
- Invalid state output falls through to `when` or `default`

### `exit.when` - Conditional Routing (New)

Declarative routing based on context variable conditions. Enables self-loop patterns and dynamic state transitions based on agent output signals.

```yaml
ralph_haiku_loop:
  exit:
    when:
      - condition: "haiku_success_signal == PASS"
        target: sonnet_review_loop
      - condition: "haiku_success_signal == REFINE"
        target: ralph_haiku_loop  # Self-loop
      - condition: "haiku_success_signal == BLOCKED"
        target: error_state
    default: ralph_haiku_loop  # Fallback if no condition matches
    set:
      haiku_success_signal: "$(echo '$REARMATTER' | yq '.success_signal')"
```

**Evaluation order (exit-only routing):**
1. `run` (literal state or script output)
2. `when` clauses (first match wins)
3. `default` target
4. Error (no route found - mesh halts)

**Supported operators (Phase 1):**
- `==` : String equality
- `!=` : String inequality

**Syntax:**
```
variable_name == "value"
variable_name != "value"
```

**Notes:**
- Variables are evaluated from FSM context
- Comparison is case-sensitive
- Values can be quoted or unquoted
- First matching condition determines next state
- Missing variables evaluate to empty string ("")

**Common patterns:**

**Self-loops with exit.run (script-based):**
```yaml
layer_loop:
  exit:
    set:
      signal: "$(echo '$REARMATTER' | yq '.success_signal')"
    run: |
      if [ "$FSM_CTX_SIGNAL" = "PASS" ]; then
        echo "next_layer"
      elif [ "$FSM_CTX_SIGNAL" = "REFINE" ]; then
        echo "layer_loop"
      else
        echo "blocked_state"
      fi
```

**Self-loops with when clauses (declarative):**
```yaml
layer_loop:
  exit:
    set:
      signal: "$(echo '$REARMATTER' | yq '.success_signal')"
    when:
      - condition: "signal == PASS"
        target: next_layer
      - condition: "signal == REFINE"
        target: layer_loop  # Retry current layer
    default: blocked_state
```

**Multi-layer routing (ralph-ice-cream pattern):**
```yaml
haiku_layer:
  exit:
    when:
      - condition: "haiku_signal == PASS"
        target: sonnet_layer
      - condition: "haiku_signal == REFINE"
        target: haiku_layer
    default: error_state

sonnet_layer:
  exit:
    when:
      - condition: "sonnet_signal == PASS"
        target: opus_layer
      - condition: "sonnet_signal == REFINE"
        target: sonnet_layer
    default: haiku_layer  # Cascade back
```

**Error routing:**
```yaml
validation:
  exit:
    when:
      - condition: "validation_result != OK"
        target: error_handler
    default: next_state
```

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

| Variable | Type | Scope | Description |
|----------|------|-------|-------------|
| `$turn` | number | context | Turn number |
| `$game_path` | string | context | Game directory path |
| `$workspace` | string | context | Workspace path |
| `$entropy` | array | context | Entropy values (JSON) |
| `$state` | string | fsm | Current state name |
| `$payload` | JSON | message | Body content |
| `$from` | string | message | Sender agent name |
| `$SDK_STATS` | JSON | exit only | SDK execution metrics (see below) |
| `$REARMATTER` | YAML | exit only | Agent self-assessment fields (see below) |

#### SDK Stats (`$SDK_STATS`)

Available in exit gates after agent execution. Contains Claude SDK metrics:

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 1542,
    "output_tokens": 324,
    "cache_read_tokens": 892,
    "cache_creation_tokens": 0
  },
  "cost_usd": 0.00567,
  "duration_ms": 2340,
  "num_turns": 1
}
```

**Usage in gates:**
```bash
tokens=$(echo "$SDK_STATS" | jq '.usage.output_tokens')
[[ $tokens -le 50000 ]] || {
  echo "Token limit exceeded: $tokens > 50000" >&2
  exit 1
}
```

**Usage in context.set:**
```yaml
exit:
  set:
    narrator_tokens: "$(echo '$SDK_STATS' | jq '.usage.output_tokens')"
    total_cost: "$(echo \"scale=5; $total_cost + $(echo '$SDK_STATS' | jq '.cost_usd')\" | bc)"
```

#### Rearmatter (`$REARMATTER`)

Available in exit gates when agent includes rearmatter in output message. Contains agent self-assessment:

```yaml
success_signal: PASS       # PASS | REFINE | BLOCKED
confidence: 0.85           # 0.0-1.0 float
reasoning: "Draft covers all requirements"
iteration_number: 2
```

**Usage in gates:**
```bash
confidence=$(echo "$REARMATTER" | yq '.confidence // 0')
if (( $(echo "$confidence < 0.8" | bc -l) )); then
  echo "Confidence too low: $confidence" >&2
  exit 1
fi
```

**Usage in context.set:**
```yaml
exit:
  set:
    haiku_success_signal: "$(echo '$REARMATTER' | yq '.success_signal')"
    haiku_confidence: "$(echo '$REARMATTER' | yq '.confidence')"
```

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

## Example: Token/Cost Tracking with SDK Stats

Track cumulative token usage and cost across mesh execution:

```yaml
fsm:
  initial: ralph_haiku_loop

  context:
    haiku_iteration: 0
    sonnet_iteration: 0
    total_tokens: 0
    total_cost: 0.00
    token_budget: 100000
    cost_limit: 5.00

  states:
    ralph_haiku_loop:
      agents: [ralph-haiku]
      entry:
        set:
          haiku_iteration: "$((haiku_iteration + 1))"
      exit:
        gates:
          ralph-haiku:
            - check_haiku_max_iterations
            - check_token_budget
            - check_cost_limit
        set:
          haiku_success_signal: "$(echo '$REARMATTER' | yq '.success_signal')"
          haiku_confidence: "$(echo '$REARMATTER' | yq '.confidence')"
          haiku_tokens: "$(echo '$SDK_STATS' | jq '.usage.output_tokens')"
          haiku_cost: "$(echo '$SDK_STATS' | jq '.cost_usd')"
          total_tokens: "$((total_tokens + haiku_tokens))"
          total_cost: "$(echo \"scale=5; $total_cost + $haiku_cost\" | bc)"
      transitions:
        sonnet-reviewer: sonnet_review_loop
        ralph-haiku: ralph_haiku_loop

    sonnet_review_loop:
      agents: [sonnet-reviewer]
      entry:
        set:
          sonnet_iteration: "$((sonnet_iteration + 1))"
      exit:
        gates:
          sonnet-reviewer:
            - check_sonnet_max_iterations
            - check_token_budget
            - check_cost_limit
        set:
          sonnet_success_signal: "$(echo '$REARMATTER' | yq '.success_signal')"
          sonnet_tokens: "$(echo '$SDK_STATS' | jq '.usage.output_tokens')"
          sonnet_cost: "$(echo '$SDK_STATS' | jq '.cost_usd')"
          total_tokens: "$((total_tokens + sonnet_tokens))"
          total_cost: "$(echo \"scale=5; $total_cost + $sonnet_cost\" | bc)"
      transitions:
        core: complete
        sonnet-reviewer: sonnet_review_loop

    complete:
      agents: [core]

  scripts:
    check_haiku_max_iterations: |
      [[ $haiku_iteration -le 5 ]] || {
        echo "Haiku max iterations (5) reached" >&2
        exit 1
      }

    check_sonnet_max_iterations: |
      [[ $sonnet_iteration -le 3 ]] || {
        echo "Sonnet max iterations (3) reached" >&2
        exit 1
      }

    check_token_budget: |
      if [[ -n "$SDK_STATS" ]]; then
        tokens=$(echo "$SDK_STATS" | jq '.usage.output_tokens')
        new_total=$((total_tokens + tokens))
        if [[ $new_total -gt $token_budget ]]; then
          echo "Token budget exceeded: $new_total > $token_budget" >&2
          exit 1
        fi
      fi

    check_cost_limit: |
      if [[ -n "$SDK_STATS" ]]; then
        cost=$(echo "$SDK_STATS" | jq '.cost_usd')
        new_total=$(echo "scale=5; $total_cost + $cost" | bc)
        if (( $(echo "$new_total > $cost_limit" | bc -l) )); then
          echo "Cost limit exceeded: \$$new_total > \$$cost_limit" >&2
          exit 1
        fi
      fi
```

**Key patterns:**
- `$SDK_STATS` available after agent execution in exit gates
- `$REARMATTER` available when agent emits structured output
- Gate scripts check limits before allowing transition
- Context.set accumulates totals across iterations

## Anti-patterns

**Don't use FSM for:**
- Controlling agent routing (agents decide that)
- Complex conditional logic (keep in agent prompts)
- Micro-managing agent interactions (FSM is for phase-level state)

**Do use FSM for:**
- Tracking pipeline state (init → prep → render → review → complete)
- Providing turn context (workspace paths, entropy, counters)
- Running lifecycle scripts (workspace creation, post-processing)
- Token/cost budget enforcement (via exit gates with $SDK_STATS)
- Quality signal routing (via rearmatter success_signal)
