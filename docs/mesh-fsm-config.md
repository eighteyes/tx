# Mesh FSM Configuration

System-managed state tracking for mesh orchestration. The FSM observes message flow, provides context to agents, routes to next states via exit-based conditions, and supports parallel agent execution via ensemble states.

## Purpose

Remove state management from agent prompts. FSM handles:
- **State tracking**: Observes asks, maintains current state
- **Context injection**: Provides turn/workspace/counters to agents
- **Route determination**: Exit block decides next state via when/run/default
- **Parallel execution**: Ensemble states spawn multiple agents simultaneously
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
      type: normal              # Optional: 'normal' (default) or 'ensemble'
      subtask: false            # Optional: inject subtask generation context
      ensemble:                 # Required if type: ensemble
        agents: [a1, a2]        # Agents to run in parallel
        aggregation: concat     # Strategy: concat, voting, consensus, etc
        timeout_ms: 120000      # Per-agent timeout
        fault_tolerance:        # Optional failure handling
          min_success_count: 2
          retry_failed: false
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

**Entry processing order:**
1. **`entry.set`** - Context assignments
2. **`entry.run`** - Side effect scripts

```yaml
init:
  entry:
    set:
      turn: "$((turn + 1))"
      workspace: "$game_path/turns/turn-$turn"
    run: [generate_entropy, mkdir_workspace]
```

**`entry.set`**: Context assignments using bash syntax
- Variables: `$workspace`, `$turn`, `$rearmatter`, `$variable_name`
- Arithmetic: `$((turn + 1))`
- Commands: `$(yq '.field' $file)`
- String interpolation: `"$game_path/turns/turn-$turn"`

**`entry.run`**: Script names or inline scripts to execute (side effects like mkdir, logging)

### `exit`
Executed when exiting this state. Determines next state. Optional but critical for routing.

**Exit processing order (strict sequence):**
1. **`exit.gates`** - Validate outputs (stop if fail)
2. **`exit.set`** - Extract values
3. **`exit.when`** - Evaluate conditions
4. **`exit.run`** - Determine next state
5. **`exit.default`** - Fallback if no route
6. **Transition** to next state

#### Exit.Gates: Output Validation (Step 1)

Validate agent outputs **before any routing decision**:

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

#### Exit.Set: Data Extraction (Step 2)

Extract data from agent outputs **before routing decision**:

```yaml
awaiting_narrator:
  exit:
    set:
      word_count: "$(wc -w < $workspace/prose-draft.md)"
      haiku_success_signal: "$(echo '$rearmatter' | yq '.success_signal')"
```

Extracted values are available to `when` conditions and `run` scripts.

#### Exit.When: Declarative Routing (Step 3)

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

First matching condition wins. If no match, continue to Step 4.

#### Exit.Run: Determine Next State (Step 4)

State name OR script that outputs state name (for complex routing logic):

```yaml
ralph_haiku_loop:
  exit:
    run: |
      signal="$haiku_success_signal"
      if [ "$signal" = "PASS" ]; then
        echo "sonnet_review_loop"
      elif [ "$signal" = "REFINE" ]; then
        echo "ralph_haiku_loop"
      else
        echo "blocked_state"
      fi
```

- **Literal state name**: `run: sonnet_review_loop` → echoed to stdout, state is used
- **Script**: Script echoes state name to stdout → that state is used

If `run` outputs a valid state name, use it. If `run` is empty or undefined, continue to Step 5.

#### Exit.Default: Fallback Route (Step 5)

**Required.** Used if no `when` condition matches and no `run` output:

```yaml
ralph_haiku_loop:
  exit:
    default: ralph_haiku_loop
```

Prevents silent failures when routing cannot be determined.

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

## Ensemble States (Parallel Execution)

FSM supports parallel agent execution within a single state using the ensemble pattern. When a state has `type: ensemble`, all configured agents spawn simultaneously and their results are aggregated.

### Configuration

```yaml
fsm:
  states:
    parallel_review:
      type: ensemble              # Enable ensemble mode
      ensemble:
        agents: [rev-1, rev-2]    # Agents to spawn in parallel
        aggregation: concat       # How to combine results
        timeout_ms: 120000        # Per-agent timeout
        fault_tolerance:          # Optional
          min_success_count: 2    # Min agents that must succeed
          retry_failed: false
      exit:
        set:
          results: "$ENSEMBLE_OUTPUT"  # Aggregated output
        default: next_state
```

### Ensemble Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Set to `ensemble` to enable parallel execution |
| `ensemble.agents` | string[] | Yes* | List of agent names to run in parallel |
| `ensemble.agent` | string | Yes* | Single agent to run N times (alternative to agents) |
| `ensemble.count` | number/string | No | Number of times to spawn agent (use with `agent`) |
| `ensemble.aggregation` | string | Yes | Strategy: `concat`, `deduplicate`, `voting`, `consensus`, `custom` |
| `ensemble.timeout_ms` | number | No | Timeout per agent (default: 120000) |
| `ensemble.fault_tolerance` | object | No | Failure handling config |

*Either `agents` (different agents) OR `agent` + `count` (same agent N times) required.

### Aggregation Strategies

| Strategy | Behavior |
|----------|----------|
| `concat` | Concatenate all outputs with agent labels |
| `deduplicate` | Remove duplicate outputs, keep unique |
| `voting` | Select most common output (majority wins) |
| `consensus` | Require all agents agree, fail if mismatch |
| `custom` | Use custom aggregation prompt (advanced) |

### Subtask Generation

Use `subtask: true` on a state to inject subtask generation context into the agent prompt. This tells the agent to break down work for parallel execution.

```yaml
generate_subtasks:
  agents: [coordinator]
  subtask: true              # Injects subtask generation context
  exit:
    default: parallel_review

parallel_review:
  type: ensemble
  ensemble:
    agents: [reviewer-1, reviewer-2, reviewer-3]
    aggregation: concat
  exit:
    default: synthesize
```

The coordinator agent receives context explaining how to format subtasks for parallel agents.

### Accessing Ensemble Output

Use `$ENSEMBLE_OUTPUT` in `exit.set` to capture aggregated results:

```yaml
parallel_review:
  type: ensemble
  ensemble:
    agents: [rev-1, rev-2, rev-3]
    aggregation: concat
  exit:
    set:
      review_results: "$ENSEMBLE_OUTPUT"  # Store aggregated output
    default: synthesize
```

The `review_results` context variable is then available to subsequent states.

### Example: Code Review Ensemble

```yaml
mesh: code-review-ensemble
description: "Parallel code review - logic, architecture, robustness analysis"

agents:
  - name: entry
    model: haiku
    prompt: prompts/entry.md

  - name: reviewer-logic
    model: sonnet
    prompt: prompts/reviewer-logic.md

  - name: reviewer-architecture
    model: sonnet
    prompt: prompts/reviewer-architecture.md

  - name: reviewer-robustness
    model: haiku
    prompt: prompts/reviewer-robustness.md

  - name: synthesizer
    model: sonnet
    prompt: prompts/synthesizer.md

entry_point: entry

fsm:
  initial: generate_subtasks

  states:
    # Step 1: Entry agent generates subtasks
    generate_subtasks:
      agents: [entry]
      subtask: true              # Inject subtask context
      exit:
        default: parallel_review

    # Step 2: Three reviewers run in parallel
    parallel_review:
      type: ensemble
      ensemble:
        agents: [reviewer-logic, reviewer-architecture, reviewer-robustness]
        aggregation: concat
        timeout_ms: 120000
      exit:
        set:
          review_results: "$ENSEMBLE_OUTPUT"
        default: synthesize

    # Step 3: Synthesizer combines findings
    synthesize:
      agents: [synthesizer]
      exit:
        default: complete

    # Step 4: Terminal state
    complete:
      agents: [core]

  scripts: {}
```

**Execution flow:**
1. User sends code → `entry` agent (subtask generation mode)
2. FSM transitions → `parallel_review` state
3. Three reviewers spawn simultaneously (logic, architecture, robustness)
4. Each reviewer analyzes code independently
5. FSM aggregates results using `concat` strategy
6. FSM transitions → `synthesize` state
7. Synthesizer receives aggregated reviews, creates final report
8. FSM transitions → `complete`, returns to user

### Fault Tolerance

Handle partial failures with `fault_tolerance` config:

```yaml
parallel_review:
  type: ensemble
  ensemble:
    agents: [rev-1, rev-2, rev-3]
    aggregation: concat
    timeout_ms: 120000
    fault_tolerance:
      min_success_count: 2      # Only 2/3 must succeed
      retry_failed: false        # Don't retry failed agents
  exit:
    default: synthesize
```

If fewer than `min_success_count` agents succeed, the ensemble fails and the mesh halts.

### Same Agent Multiple Times

Run the same agent N times for Monte Carlo sampling or variance analysis:

```yaml
sampling:
  type: ensemble
  ensemble:
    agent: sampler              # Single agent
    count: 5                    # Run 5 times
    aggregation: voting         # Pick most common result
  exit:
    default: next_state
```

### Ensemble vs Sequential

| Pattern | When to Use |
|---------|-------------|
| **Ensemble** (`type: ensemble`) | Independent parallel work (code review, analysis, sampling) |
| **Sequential** (regular FSM) | Dependent steps, self-loops, conditional routing |

Use ensemble for embarrassingly parallel tasks. Use sequential FSM for workflows with dependencies and branching.

### Architecture Note

FSM ensemble states replace mesh-level `ensemble:` config. Both patterns achieve parallel execution, but FSM ensemble integrates with state tracking and conditional routing.

**Mesh-level ensemble** (deprecated):
```yaml
# OLD: mesh-level pattern
ensemble:
  coordinator: entry
  agents: [rev-1, rev-2]
  reviewer: synthesizer
  aggregation_strategy: concat
```

**FSM ensemble** (preferred):
```yaml
# NEW: FSM state-level pattern
fsm:
  states:
    parallel_review:
      type: ensemble
      ensemble:
        agents: [rev-1, rev-2]
        aggregation: concat
```

FSM ensemble provides:
- Better state tracking and observability
- Conditional routing based on ensemble results
- Integration with FSM context and scripts
- Single orchestration pattern for both sequential and parallel workflows

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
| `$variable_name` | string | context | Any context var: `$success_signal`, `$iteration` |
| `$SDK_STATS` | JSON | exit only | SDK execution metrics |
| `$rearmatter` | YAML | exit only | Agent self-assessment fields |

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

#### Rearmatter (`$rearmatter`)

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
   - Evaluate `exit.when` clauses (first match wins)
   - Run `exit.run` script (outputs state name)
   - Use `exit.default` if no route found

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
          haiku_success_signal: "$(echo '$rearmatter' | yq '.success_signal')"
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
          sonnet_success_signal: "$(echo '$rearmatter' | yq '.success_signal')"
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
          opus_success_signal: "$(echo '$rearmatter' | yq '.success_signal')"
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
5. **Ensemble agents** exist in mesh config (when `type: ensemble`)
6. **Ensemble aggregation** is valid strategy
7. **Script syntax** (bash -n validation)

## Benefits

1. **Deterministic routing** - No LLM inference, rules-based transitions
2. **Observable state** - State transitions logged and queryable
3. **Self-loops supported** - Agents can retry via REFINE signal
4. **Resource enforcement** - Gates check token/cost/iteration limits
5. **Resumable** - State persists across worker respawns
6. **Flexible** - Both imperative (run) and declarative (when) routing
7. **Parallel execution** - Ensemble states spawn multiple agents simultaneously
8. **Single orchestration pattern** - Sequential and parallel workflows in one system

## Anti-patterns

**Don't use FSM for:**
- Linear pipelines with no branching (just use agents + routing)
- Real-time decision-making (FSM is phase-level, not within-agent)
- Complex business logic (keep that in agent prompts)

**Do use FSM for:**
- Iterative loops with resource limits (ralph pattern)
- Conditional phase transitions (when success_signal == "PASS")
- Parallel agent execution (ensemble states for code review, analysis)
- Tracking cumulative metrics (tokens, cost, iterations)
- Enforcing hard resource boundaries (via gates)
- State-dependent context injection (different info per phase)

---

*Updated 2026-01-14 to document ensemble states (parallel execution) and exit-based routing*
