# Lifecycle Hooks - Integration Guide

Pre/post hooks are execution gates for mesh workflows. Use them to:
- Validate preconditions (pre-hooks)
- Validate outputs (post-hooks)
- Inject external tools (linters, tests, formatters)
- Integrate with external systems (git, CI/CD, monitoring)

---

## Hook Context

Shared data structure that flows pre-hook -> worker -> post-hook.

### HookContext Interface

```typescript
interface HookContext {
  // Identity
  meshInstance: string;
  meshName: string;
  agentName: string;
  agentId?: string;
  taskId?: string;
  workDir: string;

  // Pre-hook outputs
  worktreePath?: string;
  worktreeBranch?: string;
  qualityPreflight?: PreflightOutput;
  qualityIteration?: number;
  qualityMaxIterations?: number;
  qualityOnFail?: 'loop' | 'halt';

  // Dispatcher additions
  workerOutput?: string;
  sessionId?: string;

  // Task info
  taskBody?: string;
  featureName?: string;
  msgsDir?: string;

  [key: string]: unknown;  // Extensible
}
```

### Information Flow

```
Pre-hooks (sequential) -> Worker Execution -> Post-hooks (sequential)
```

1. **Pre-hooks set**: `qualityPreflight`, `worktreePath`, iteration config
2. **Dispatcher sets**: `workerOutput`, `sessionId`, `taskBody`
3. **Post-hooks read**: all above, validate, throw errors for iteration

---

## Built-in Hooks

### Pre-Hooks

#### `worktree:create`
Creates isolated git worktree for feature branch development.

**Sets**:
- `context.worktreePath` - Path to worktree directory
- `context.worktreeBranch` - Branch name

**Requires**: `context.featureName` must be set in task payload

```yaml
lifecycle:
  pre:
    - worktree:create
```

#### `quality:preflight`
Analyzes task body to generate checklist and rubric for quality evaluation.

**Sets**:
- `context.qualityPreflight` - Generated checklist, rubric, task type
- `context.qualityIteration` - Current iteration (starts at 1)
- `context.qualityMaxIterations` - Max retries (default: 3)
- `context.qualityOnFail` - Behavior on failure (default: 'loop')

**Behavior**: Uses LLM analysis with heuristic fallback.

```yaml
lifecycle:
  pre:
    - quality:preflight
    # Or with parameters:
    - quality:preflight:maxIterations=5,onFail=halt
```

---

### Post-Hooks

#### `quality:checklist`
Validates worker output against preflight checklist items.

**Reads**: `context.qualityPreflight`, `context.workerOutput`

**Throws**: `QualityIterationError` if items not satisfied

```yaml
lifecycle:
  post:
    - quality:checklist
    # Or with parameters:
    - quality:checklist:onFail=loop,maxIterations=3
```

#### `quality:rubric`
Scores worker output against rubric criteria.

**Reads**: `context.qualityPreflight`, `context.workerOutput`

**Throws**: `QualityIterationError` if score below threshold (default: 70)

```yaml
lifecycle:
  post:
    - quality:rubric
    - quality:rubric:onFail=halt
```

#### `quality:adversarial`
Finds edge cases, challenges assumptions, and identifies weaknesses.

**Reads**: `context.qualityPreflight`, `context.workerOutput`

**Throws**: `QualityIterationError` if critical issues found

```yaml
lifecycle:
  post:
    - quality:adversarial
```

#### `quality:accuracy`
Validates sources and first-party vs second-party claims.

**Reads**: `context.qualityPreflight`, `context.workerOutput`

**Throws**: `QualityIterationError` if inaccuracies found

```yaml
lifecycle:
  post:
    - quality:accuracy
```

#### `quality:deterministic`
Runs tests, linting, type checks via shell commands.

**Reads**: `context.workDir`, `context.deterministicCommands`

**Throws**: `QualityIterationError` if checks fail

**Note**: Requires `deterministicCommands` in context or skips gracefully.

```yaml
lifecycle:
  post:
    - quality:deterministic
```

#### `quality:summarizer`
Summarizes ensemble results (informational only, cannot fail).

**Reads**: `context.workerOutput`

**Behavior**: Never throws - always passes.

```yaml
lifecycle:
  post:
    - quality:summarizer
```

#### `commit:auto`
Spawns haiku agent to create git commits from changes.

**Reads**: `context.workerOutput`, `context.workDir`

**Behavior**: Creates commit with descriptive message. Writes status message to core if blocked.

```yaml
lifecycle:
  post:
    - commit:auto
```

#### `brain-update`
Sends work analysis to brain mesh for documentation.

**Reads**: `context.workerOutput`, `context.featureName`, `context.taskId`

**Behavior**: Extracts git diff and work summary, sends to brain for analysis of side effects, opportunities, and tech debt.

```yaml
lifecycle:
  post:
    - brain-update
```

#### `forensics:analyze`
Analyzes mesh execution for patterns, issues, and improvements.

**Reads**: `context.sessionId`, `context.meshName`, `context.agentName`

**Behavior**:
- Uses Haiku to analyze session transcript
- Identifies: routing failures, stale state, off-script agents, success patterns
- Writes report to `.ai/tx/forensics/{mesh}-{timestamp}.md`
- Non-blocking: failures don't halt mesh execution

**Activation**: Only runs when debug mode is enabled:
- `--debug` flag on `tx start`, OR
- `debug: true` in mesh config

```yaml
# In mesh config.yaml
debug: true

# Or via CLI
# tx start --debug
```

**CLI Alternative**: Run analysis on-demand:
```bash
tx forensics [mesh]        # Analyze specific mesh
tx forensics               # Analyze most recent session
tx forensics --session ID  # Analyze specific session
```

#### `worktree:cleanup`
Removes worktree and associated branches.

**Reads**: `context.worktreePath`, `context.worktreeBranch`

**Note**: Cleanup is NOT automatic after `worktree:create`. User typically runs `/know:done` to merge and cleanup.

```yaml
lifecycle:
  post:
    - worktree:cleanup
```

---

## Custom Hook Implementation

### Hook Definition Interface

```typescript
interface HookDefinition {
  name: string;                    // e.g., 'category:action'
  phase: 'pre' | 'post';           // Execution phase
  priority?: number;               // Lower = earlier (default: 50)
  description?: string;            // Human-readable description
  handler: HookHandler;            // Execution function
  initialize?: (utils: HookUtils) => Promise<void>;  // Optional async setup
}

type HookHandler = (context: HookContext, utils: HookUtils) => Promise<void>;

interface HookUtils {
  queue: MessageQueue;
  worktreeManager: WorktreeManager;
  workDir: string;
  meshesDir: string;
  writeResultMessage: (gate: string, passed: boolean, summary: string, details?: Record<string, unknown>) => void;
  writeFeedbackMessage: (agentId: string, taskId: string, feedback: string, iteration: number) => Promise<string>;
}
```

### Creating a New Hook

1. Create a file in `src/hooks/pre/` or `src/hooks/post/`:

```typescript
// src/hooks/post/my-custom-hook.ts
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { QualityIterationError } from '../errors.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  if (!isValid(context.workerOutput)) {
    throw new QualityIterationError('Validation failed: reason');
  }
};

export const myCustomHook: HookDefinition = {
  name: 'my-custom:validate',
  phase: 'post',
  priority: 55,  // Runs after quality gates (50-53)
  description: 'Validates output against custom rules',
  handler,
};
```

2. Register in `src/hooks/post/index.ts`:

```typescript
import { myCustomHook } from './my-custom-hook.ts';
export { myCustomHook };

// Add to allPostHooks array
export const allPostHooks = [
  // ... existing hooks
  myCustomHook,
];
```

### Priority Ordering

Hooks execute by priority within each phase (lower = earlier):

**Pre-hooks:**
| Hook | Priority |
|------|----------|
| `worktree:create` | 10 |
| `quality:preflight` | 50 |

**Post-hooks:**
| Hook | Priority |
|------|----------|
| `quality:evaluate` | 40 |
| `quality:checklist` | 50 |
| `quality:rubric` | 51 |
| `quality:adversarial` | 52 |
| `quality:accuracy` | 53 |
| `quality:summarizer` | 60 |
| `quality:deterministic` | 70 |
| `worktree:cleanup` | 80 |
| `commit:auto` | 90 |
| `forensics:analyze` | 95 |
| `brain-update` | 100 |

---

## Error Handling

### Error Types

#### `QualityIterationError`
Triggers retry with feedback.

```typescript
throw new QualityIterationError('Missing error handling for edge case X');
```

**Behavior**: Dispatcher catches, writes feedback, resumes session with context.

#### `QualityHaltError`
Stops immediately without retry.

```typescript
throw new QualityHaltError('Critical security issue found');
```

**Behavior**: Mesh execution halts, error escalated to user.

#### `QualityExhaustedError`
Max iterations reached.

```typescript
throw new QualityExhaustedError('Max iterations (5) reached');
```

**Behavior**: Mesh continues with warning, no further retries.

### Iteration Flow

```
1. Worker completes
2. Post-hooks execute
3. Quality hook throws QualityIterationError
4. Dispatcher:
   - Increments iteration count
   - Writes feedback to sys-msgs (audit)
   - Resumes session with feedback
5. Worker sees feedback, tries again
6. Loop until pass or max iterations
```

---

## Hook Configuration

### Explicit Hooks

```yaml
lifecycle:
  pre:
    - worktree:create
    - quality:preflight
  post:
    - quality:checklist
    - quality:rubric
    - commit:auto
```

### Parameterized Hooks

```yaml
lifecycle:
  post:
    - quality:checklist:onFail=loop,maxIterations=3
    - quality:rubric:onFail=halt
```

**Parameters**:
- `onFail` - `loop` (retry) or `halt` (stop)
- `maxIterations` - Number of retries (default: 3)
- `gates` - Specific gates to run (for preflight)

### Iteration Control (Mesh-Level)

```yaml
iteration:
  maxIterations: 5
  onFail: loop  # or 'halt'
```

---

## Shorthand Expansion

### `worktree: true`

Expands to:

```yaml
lifecycle:
  pre:
    - worktree:create
  post:
    - commit:auto
    # Note: worktree:cleanup is NOT included
    # User runs /know:done to merge and cleanup
```

---

## Hook Events

Hooks don't emit events directly, but dispatcher emits:

| Event | Payload | When |
|-------|---------|------|
| `quality:pass` | `{ agentId, iterations }` | All quality gates passed |
| `quality:retry` | `{ agentId, iteration, feedback }` | Quality iteration triggered |
| `quality:halt` | `{ agentId, error }` | Quality halted mesh |
| `quality:exhausted` | `{ agentId, iterations }` | Max iterations reached |

---

## Debugging Hooks

### Logs

Check `.ai/tx/logs/v4.jsonl` for hook execution:

```bash
tx logs | grep hooks
```

### Feedback Messages

Check `.ai/tx/sys-msgs/` for quality feedback:

```bash
ls .ai/tx/sys-msgs/
cat .ai/tx/sys-msgs/*feedback*
```

### Real-Time Monitoring

```bash
tx spy  # Watch events in real-time
```

---

## External Integration Examples

### Example 1: ESLint Pre-Hook

```typescript
hooks.addPreHook('eslint:check', async (context) => {
  const { workDir } = context;
  const { execSync } = await import('node:child_process');

  try {
    execSync('npx eslint .', { cwd: workDir, encoding: 'utf-8' });
  } catch (error) {
    throw new Error(`ESLint failed:\n${error.stderr || error.message}`);
  }
});
```

### Example 2: Docker Test Post-Hook

```typescript
hooks.addPostHook('docker:test', async (context) => {
  const { workDir } = context;
  const { execSync } = await import('node:child_process');

  try {
    execSync('docker-compose run --rm test npm test', {
      cwd: workDir,
      encoding: 'utf-8'
    });
  } catch (error) {
    throw new QualityIterationError(
      `Tests failed in Docker:\n${error.stderr || error.message}`
    );
  }
});
```

### Example 3: Sentry Error Reporting

```typescript
hooks.addPostHook('sentry:report', async (context) => {
  const { workerOutput, agentId } = context;

  // Check for errors in output
  if (workerOutput?.includes('ERROR') || workerOutput?.includes('FATAL')) {
    await Sentry.captureMessage(`Worker ${agentId} reported errors`, {
      level: 'error',
      extra: { output: workerOutput?.slice(0, 1000) }
    });
  }
});
```

### Example 4: Slack Notification

```typescript
hooks.addPostHook('slack:notify', async (context) => {
  const { meshName, agentName, workerOutput } = context;

  const summary = workerOutput?.match(/## Summary\n([\s\S]*?)(?=\n##|$)/)?.[1] || 'Task completed';

  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `*${meshName}/${agentName}* completed\n${summary.slice(0, 500)}`
    })
  });
});
```

---

## Best Practices

### Idempotent Hooks

Hooks may run multiple times (quality iteration). Design for re-execution:

```typescript
// Good - checks before acting
hooks.addPostHook('setup:dir', async (context) => {
  if (!fs.existsSync(context.outputDir)) {
    fs.mkdirSync(context.outputDir, { recursive: true });
  }
});

// Bad - fails on re-run
hooks.addPostHook('setup:dir', async (context) => {
  fs.mkdirSync(context.outputDir);  // Throws if exists
});
```

### Fast Pre-Hooks

Keep pre-hooks under 5 seconds. Long pre-hooks delay worker spawn:

```typescript
// Good - quick validation
hooks.addPreHook('validate:config', (context) => {
  if (!context.taskBody) throw new Error('No task body');
});

// Bad - expensive operation before worker even starts
hooks.addPreHook('precompile:all', async (context) => {
  await compileEntireProject();  // Minutes...
});
```

### Detailed Feedback

Provide clear, actionable feedback for iteration:

```typescript
// Good - specific feedback
throw new QualityIterationError(
  `Missing error handling:\n` +
  `- Line 45: No try/catch around API call\n` +
  `- Line 78: Null check missing for user.email`
);

// Bad - vague feedback
throw new QualityIterationError('Code needs improvement');
```

### Graceful Degradation

Handle missing data gracefully:

```typescript
hooks.addPostHook('analyze:output', async (context) => {
  const output = context.workerOutput;
  if (!output) {
    log.warn('hooks', 'No output to analyze, skipping');
    return;  // Don't throw, just skip
  }
  // Continue with analysis...
});
```

---

## API Reference

### LifecycleHooks Class

**Constructor**:
```typescript
new LifecycleHooks(workDir: string, queue: MessageQueue, meshesDir?: string)
```

**Methods**:

| Method | Description |
|--------|-------------|
| `addPreHook(name, handler)` | Register pre-hook |
| `addPostHook(name, handler)` | Register post-hook |
| `executePreHooks(hooks, context)` | Execute pre-hooks |
| `executePostHooks(hooks, context)` | Execute post-hooks |
| `listPreHooks()` | List registered pre-hooks |
| `listPostHooks()` | List registered post-hooks |
| `hasPreHook(name)` | Check if pre-hook exists |
| `hasPostHook(name)` | Check if post-hook exists |
| `getWorktreeManager()` | Get worktree manager instance |

**Location**: `src/worker/hooks.ts`

---

## Files Reference

| Component | File | Description |
|-----------|------|-------------|
| **Hook System** | `src/hooks/` | Modular hook directory |
| Types | `src/hooks/types.ts` | HookContext, HookUtils, HookDefinition |
| Errors | `src/hooks/errors.ts` | QualityIterationError, QualityHaltError, etc. |
| Registry | `src/hooks/registry.ts` | Hook registration with priority ordering |
| Lifecycle Class | `src/hooks/lifecycle-hooks.ts` | Main LifecycleHooks class |
| Pre-hooks | `src/hooks/pre/*.ts` | Individual pre-hook implementations |
| Post-hooks | `src/hooks/post/*.ts` | Individual post-hook implementations |
| Utilities | `src/hooks/utils/*.ts` | Shared utilities (messages, quality, rearmatter) |
| **Integration** | | |
| Lifecycle Resolution | `src/worker/lifecycle-utils.ts` | Resolves hooks from config |
| Dispatcher | `src/worker/dispatcher.ts` | Orchestrates hook execution |
| **Forensics** | | |
| Analyzer | `src/forensics/analyzer.ts` | Haiku-powered transcript analysis |
| CLI Command | `src/cli/forensics.ts` | On-demand forensics via CLI |

**Note**: `src/worker/hooks.ts` is now a re-export shim for backward compatibility.

---

## Related Documentation

- [Mesh Configuration Reference](./mesh-config.md) - Config field documentation
- [Message Format](./message-format.md) - Message schema and rearmatter
- [FSM Configuration](.ai/docs/mesh-fsm-config.md) - State machine configuration
