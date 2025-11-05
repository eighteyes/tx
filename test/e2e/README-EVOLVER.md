# E2E Test: Evolver Mesh

## Overview

This test validates the self-modification system with lens filtering by spawning a real evolver mesh and verifying the complete workflow.

## What It Tests

1. **Mesh Spawning**: Evolver mesh spawns successfully
2. **Self-Modify Frontmatter**: Agent receives `self-modify: true` from mesh config
3. **Lens Configuration**: Agent gets lens list (lens: true → all 8 lenses)
4. **Prompt Injection**: Self-modify instructions injected correctly
5. **Workflow Completion**: Agent completes task and signals core
6. **EventLogConsumer**: Full integration with message processing
7. **Context Management**: Tmux session lifecycle

## Running the Test

```bash
# Run E2E test
node test/e2e/test-e2e-evolver.js

# Expected output:
# ✅ E2E Test PASSED
```

## Test Flow

1. **Start tx System**: Spawn tx in detached mode
2. **Wait for Core**: Core session ready + Claude initialized
3. **E2EWorkflow**: Test mesh spawning and task completion
   - Inject natural language to core
   - Core spawns evolver mesh
   - Send task to evolver
   - Evolver receives self-modify instructions
   - Evolver processes with lens access
   - Evolver signals task-complete to core
4. **Validation**: E2EWorkflow confirms completion
5. **Cleanup**: Kill sessions and stop tx

## Success Criteria

✅ Evolver mesh spawns with UUID session
✅ Agent receives message with self-modify frontmatter
✅ Lens list injected (all 8 lenses)
✅ Agent completes workflow
✅ task-complete sent to core
✅ E2EWorkflow validation passes

## Mesh Configuration

The test uses `meshes/mesh-configs/evolver.json`:

```json
{
  "mesh": "evolver",
  "frontmatter": {
    "self-modify": true,
    "max-iterations": 5,
    "clear-context": true,
    "lens": true
  }
}
```

This configuration enables:
- Self-modification mode
- All 8 lenses available
- Context clearing between iterations
- Maximum 5 iterations

## Validation

The test uses `E2EWorkflow` which validates:
- Mesh session creation (UUID pattern matching)
- Message injection via `@filepath`
- Agent processing and response
- Completion signal to core

## Troubleshooting

### Test Timeout
- Increase `TEST_TIMEOUT` (default: 180s)
- Check Claude initialization time

### Mesh Not Spawning
- Verify `meshes/mesh-configs/evolver.json` exists
- Check agent config at `meshes/agents/test/evolver/`

### Session Not Found
- Ensure tmux server is running
- Check UUID pattern in session name

### Cleanup Issues
- Manually kill sessions: `tmux kill-server`
- Check for orphaned tx processes

## Related Tests

- `test-self-modify.js` - Unit tests for core components
- `test-lens-filtering.js` - Lens filtering modes
- `test-e2e-self-modify.js` - Integration (not live mesh)

## Notes

This test follows TX E2E patterns:
- Uses `E2EWorkflow` for validation
- Only injects to core session
- Validates via session output
- Uses idle state for completion
- Proper cleanup of sessions
