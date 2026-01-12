# Mesh FSM Configuration - Exit-Based Routing

System-managed state tracking for mesh orchestration. The FSM observes message flow, provides context to agents, and routes to next states via exit-based conditions.

## Purpose

Remove state management from agent prompts. FSM handles:
- **State tracking**: Observes asks, maintains current state
- **Context injection**: Provides turn/workspace/counters to agents
- **Route determination**: Exit block decides next state via when/run/default
- **Lifecycle scripts**: Entry/exit hooks for setup and validation

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
      exit:                     # Run on exiting state, determines next_state
        gates:                  # Validate outputs (before routing)
          agent_name:
            - "$path/file.yaml" # File existence check
            - script_name       # Script check (exit 0 = pass)
        set: {key: value}       # Extract from agent outputs (before routing)
        run:                    # Imperative routing: scripts set next_state
          - script: bash code
        when:                   # Declarative routing: conditions set target
          - condition: var == "value"
            target: next_state_1
        default: fallback_state # Fallback if no when match (required)

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
- Variables: `$workspace`, `$turn`, `$REARMATTER`, `$FSM_CTX_*`
- Arithmetic: `$((turn + 1))`
- Commands: `$(yq '.field' $file)`
- String interpolation: `"$game_path/turns/turn-$turn"`

**`entry.run`**: Script names to execute (side effects like mkdir, logging)

### `exit`
Executed when exiting this state. Determines next state. Optional but critical for routing.

#### Exit.Gates: Output Validation

Validate agent outputs **before routing decision**:

```yaml
awaiting_narrator:
  exit:
    gates:
      narrator:
        - "$workspace/prose-draft.md"
        - check_min_word_count
```

- **File paths**: `"$workspace/file.yaml"` (must exist)
- **Scripts**: `check_min_word_count` (exit 0 = pass, non-zero = fail with stderr message)

If gate fails, transition blocked, stay in current state.

#### Exit.Set: Data Extraction

Extract data from agent outputs **before routing decision**:

```yaml
awaiting_narrator:
  exit:
    set:
      word_count: "$(wc -w < $workspace/prose-draft.md)"
      haiku_success_signal: "$(echo '$REARMATTER' | yq '.success_signal')"
```

Extracted values are available to `when` conditions and `run` scripts.

#### Exit.Run: Imperative Routing

Scripts that set `next_state` variable for complex routing logic:

```yaml
ralph_haiku_loop:
  exit:
    run:
      - script: |
          signal="$FSM_CTX_HAIKU_SUCCESS_SIGNAL"
          if [ "$signal" = "PASS" ]; then
            echo "next_state=sonnet_review_loop"
          elif [ "$signal" = "REFINE" ]; then
            echo "next_state=ralph_haiku_loop"
          else
            echo "next_state=blocked_state"
          fi
```

If script outputs `next_state=<value>`, use that and skip `when` clauses.

#### Exit.When: Declarative Routing

Conditions that determine next state (evaluated top-to-bottom):

```yaml
ralph_haiku_loop:
  exit:
    when:
      - condition: haiku_success_signal == "PASS"
        target: sonnet_review_loop
      - condition: haiku_success_signal == "REFINE"
        target: ralph_haiku_loop
      - condition: haiku_success_signal == "BLOCKED"
        target: blocked_state
```

**Phase 1 Operators:**
| Operator | Example | Behavior |
|----------|---------|----------|
| `==` | `signal == "PASS"` | String equality |
| `!=` | `signal != "BLOCKED"` | String inequality |

First matching condition wins. If no match, use `default`.

#### Exit.Default: Fallback Route

**Required.** Used if no `when` condition matches:

```yaml
ralph_haiku_loop:
  exit:
    default: ralph_haiku_loop
```

Prevents silent failures when routing cannot be determined.

### Exit Routing Evaluation Priority

1. **`exit.run` scripts** (if present)
   - Execute for side effects
   - If outputs `next_state=<value>`, use that and stop
   - Otherwise continue to step 2

2. **`exit.when` clauses** (if present and no run-set next_state)
   - Evaluate top-to-bottom
   - First matching condition's target is used
   - If no match, continue to step 3

3. **`exit.default`** (required)
   - If no when condition matched
   - Must be present to prevent silent failures

4. **Error** if still no next_state (log warning, stay in current state)

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
    echo "game_id=$game_id"
    echo "campaign_id=$campaign_id"
```

### Script Environment

All scripts receive:

| Variable | Type | Scope | Description |
|----------|------|-------|-------------|
| `$turn` | number | context | Turn number |
| `$game_path` | string | context | Game directory path |
| `$workspace` | string | context | Workspace path |
| `$state` | string | fsm | Current state name |
| `$FSM_CTX_*` | string | context | Any context var: `$FSM_CTX_counter` |
| `$SDK_STATS` | JSON | exit only | SDK execution metrics |
| `$REARMATTER` | YAML | exit only | Agent self-assessment fields |

#### SDK Stats (`$SDK_STATS`)

Available in exit gates after agent execution:

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "usage": {
    "input_tokens": 1542,
    "output_tokens": 324,
    "cache_read_tokens": 892
  },
  "cost_usd": 0.00567,
  "duration_ms": 2340
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

#### Rearmatter (`$REARMATTER`)

Available in exit when agent includes self-assessment YAML:

```yaml
success_signal: PASS       # PASS | REFINE | BLOCKED
confidence: 0.85           # 0.0-1.0 float
reasoning: "Task complete"
```

**Usage in when conditions:**
```yaml
exit:
  when:
    - condition: haiku_success_signal == "PASS"
      target: sonnet_review_loop
```

## Execution Flow

1. **Agent spawns** → receives injected FSM context:
   ```markdown
   ## FSM Context
   state: init
   turn: 5
   workspace: /path/to/turns/turn-5
   ```

2. **Agent completes** → emits response (possibly with rearmatter)

3. **Dispatcher observes** → receives agent message

4. **FSM exit processing** → runs in order:
   - Run `exit.gates` for validation
   - Run `exit.set` to extract values
   - Run `exit.run` scripts (may set next_state)
   - Evaluate `exit.when` clauses if no run-set next_state
   - Use `exit.default` if no when match

5. **FSM transitions** → changes to next_state

6. **FSM entry processing** → runs in order:
   - Run `entry.set` assignments
   - Run `entry.run` scripts

7. **FSM persists** → saves state + context to SQLite

## Example: Ralph Ice Cream (FSM-Driven Loops)

Three-layer evaluation with self-loops via FSM:

```yaml
fsm:
  initial: ralph_haiku_loop

  context:
    haiku_iteration: 0
    sonnet_iteration: 0
    opus_iteration: 0
    max_haiku_iterations: 5
    max_sonnet_iterations: 3
    max_opus_iterations: 2

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
        set:
          haiku_success_signal: "$(echo '$REARMATTER' | yq '.success_signal')"
        when:
          - condition: haiku_success_signal == "PASS"
            target: sonnet_review_loop
          - condition: haiku_success_signal == "REFINE"
            target: ralph_haiku_loop
          - condition: haiku_success_signal == "BLOCKED"
            target: blocked_state
        default: ralph_haiku_loop

    sonnet_review_loop:
      agents: [sonnet-reviewer]
      entry:
        set:
          sonnet_iteration: "$((sonnet_iteration + 1))"
      exit:
        gates:
          sonnet-reviewer:
            - check_sonnet_max_iterations
        set:
          sonnet_success_signal: "$(echo '$REARMATTER' | yq '.success_signal')"
        when:
          - condition: sonnet_success_signal == "PASS"
            target: opus_review_loop
          - condition: sonnet_success_signal == "REFINE"
            target: sonnet_review_loop
          - condition: sonnet_success_signal == "BLOCKED"
            target: blocked_state
        default: sonnet_review_loop

    opus_review_loop:
      agents: [opus-reviewer]
      entry:
        set:
          opus_iteration: "$((opus_iteration + 1))"
      exit:
        gates:
          opus-reviewer:
            - check_opus_max_iterations
        set:
          opus_success_signal: "$(echo '$REARMATTER' | yq '.success_signal')"
        when:
          - condition: opus_success_signal == "PASS"
            target: complete
          - condition: opus_success_signal == "REFINE"
            target: opus_review_loop
          - condition: opus_success_signal == "BLOCKED"
            target: blocked_state
        default: opus_review_loop

    blocked_state:
      agents: [core]
      exit:
        default: error_state

    error_state:
      agents: [core]

    complete:
      agents: [core]

  scripts:
    check_haiku_max_iterations: |
      [[ $haiku_iteration -le $max_haiku_iterations ]] || {
        echo "Max haiku iterations ($max_haiku_iterations) reached" >&2
        exit 1
      }

    check_sonnet_max_iterations: |
      [[ $sonnet_iteration -le $max_sonnet_iterations ]] || {
        echo "Max sonnet iterations ($max_sonnet_iterations) reached" >&2
        exit 1
      }

    check_opus_max_iterations: |
      [[ $opus_iteration -le $max_opus_iterations ]] || {
        echo "Max opus iterations ($max_opus_iterations) reached" >&2
        exit 1
      }
```

**Key patterns:**
- **Self-loop**: `condition: haiku_success_signal == "REFINE"` → `target: ralph_haiku_loop`
- **Forward progress**: `condition: haiku_success_signal == "PASS"` → `target: sonnet_review_loop`
- **Error escalation**: `condition: haiku_success_signal == "BLOCKED"` → `target: blocked_state`
- **Iteration tracking**: `entry.set.haiku_iteration: "$((haiku_iteration + 1))"`
- **Limit enforcement**: `exit.gates` validates `check_haiku_max_iterations`

## Key Patterns

### Agent-created values:
```yaml
exit:
  set:
    game_id: "$(yq '.game_id' $workspace/game-spec.yaml)"
```
Agent writes file, FSM extracts value.

### Iteration tracking with self-loops:
```yaml
entry:
  set:
    iteration: "$((iteration + 1))"
exit:
  gates:
    - check_max_iterations
  when:
    - condition: success_signal == "REFINE"
      target: same_state      # Self-loop
    - condition: success_signal == "PASS"
      target: next_state
  default: same_state
```
Counter increments each loop, gate enforces limit, when clause handles routing.

### Complex conditional routing:
```yaml
exit:
  run:
    - script: |
        if [[ "$signal" == "PASS" && $confidence -ge 0.8 ]]; then
          echo "next_state=approved"
        elif [[ "$signal" == "PASS" && $confidence -lt 0.8 ]]; then
          echo "next_state=review"
        else
          echo "next_state=retry"
        fi
```
Multi-variable logic handled in run scripts.

## Validation

The mesh validator checks:

1. **Initial state exists** in states map
2. **When clause targets exist** in states map
3. **Default targets exist** in states map
4. **Agent names** in `agents` field match mesh agents
5. **Script syntax** (bash -n validation)

## Benefits

1. **Deterministic routing** - No LLM inference, rules-based transitions
2. **Observable state** - State transitions logged and queryable
3. **Self-loops supported** - Agents can retry via REFINE signal
4. **Resource enforcement** - Gates check token/cost/iteration limits
5. **Resumable** - State persists across worker respawns
6. **Flexible** - Both imperative (run) and declarative (when) routing

## Anti-patterns

**Don't use FSM for:**
- Linear pipelines with no branching (just use agents + routing)
- Real-time decision-making (FSM is phase-level, not within-agent)
- Complex business logic (keep that in agent prompts)

**Do use FSM for:**
- Iterative loops with resource limits (ralph pattern)
- Conditional phase transitions (when success_signal == "PASS")
- Tracking cumulative metrics (tokens, cost, iterations)
- Enforcing hard resource boundaries (via gates)
- State-dependent context injection (different info per phase)

---

*Updated 2026-01-12 to document exit-based routing (when/run/default)*
