# Agent Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable agents to save and restore session checkpoints at arbitrary points during execution, forming a tree of rewindable branch points.

**Architecture:** New `AgentCheckpointStore` class manages checkpoint persistence in SQLite (extending existing `checkpoint_log` pattern). CLI commands under `tx mesh-cmd checkpoint` let agents save/list/restore checkpoints. Restore uses SDK `resumeSessionAt` + `forkSession` which are **replay-based** (not true server-side forks). Workspace snapshots are opt-in via `--snapshot` flag.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), existing SdkRunner fork/resume, existing GuardrailConfig patterns for `max_branches`.

### SDK Fork Reality: Replay-Based Branching

The Agent SDK's `forkSession` + `resumeSessionAt` works by:
1. Loading the full JSONL session file from disk
2. Truncating the message array at the specified UUID
3. Sending the truncated history as context for a new API conversation

**This is message replay, not true forking.** Implications:

| Concern | Impact | Mitigation |
|---------|--------|------------|
| **Input token cost** | Each branch replays full history up to checkpoint | Track `replay_token_estimate` on checkpoints; warn when branching from deep checkpoints |
| **Latency** | Replay re-processes full prefill before new work | Bias explore pattern toward earlier decision points |
| **Session file dependency** | Checkpoint is useless if JSONL file is GC'd | Store `session_file_path` in checkpoint; validate file exists before restore |
| **No shared context** | Branches can't see each other's work | By design — branches are independent explorations |

The `session_file_path` field in the checkpoint schema tracks the JSONL file location. The restore command validates the file still exists before attempting replay. If the session file is missing, restore fails with a clear error rather than silently starting fresh.

**Future optimization**: If the API adds native conversation branching, the checkpoint store is already structured correctly — just swap the restore mechanism from "replay from JSONL" to "API branch call."

---

## Chunk 1: Checkpoint Store + Schema

### Task 1: AgentCheckpointStore — Schema and Save

**Files:**
- Create: `src/checkpoint/agent-checkpoint-store.ts`
- Test: `test/unit/agent-checkpoint-store.test.ts`

This store manages the `agent_checkpoints` table. It follows the same pattern as `CheckpointLog` (constructor takes `Database`, calls `ensureSchema()`).

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id TEXT PRIMARY KEY,
  mesh_instance TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_file_path TEXT,
  message_uuid TEXT,
  parent_checkpoint_id TEXT,
  stage_number INTEGER,
  stage_total INTEGER,
  label TEXT,
  context_snapshot TEXT DEFAULT '{}',
  replay_token_estimate INTEGER,
  workspace_snapshot_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_checkpoint_id) REFERENCES agent_checkpoints(id)
);
CREATE INDEX IF NOT EXISTS idx_acp_mesh ON agent_checkpoints(mesh_instance, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acp_agent ON agent_checkpoints(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acp_parent ON agent_checkpoints(parent_checkpoint_id);
```

**Fields explained:**
- `session_file_path`: Absolute path to the JSONL session file. Required for replay-based restore.
- `message_uuid`: The SDK message UUID to truncate at. History after this point is discarded on restore.
- `replay_token_estimate`: Approximate input tokens for replaying up to this checkpoint. Helps agents/guardrails make cost-aware branching decisions.

- [ ] **Step 1: Write failing test for save**

```typescript
// test/unit/agent-checkpoint-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { AgentCheckpointStore } from '../../src/checkpoint/agent-checkpoint-store.ts';

describe('AgentCheckpointStore', () => {
  let db: Database.Database;
  let store: AgentCheckpointStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new AgentCheckpointStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('saves a checkpoint and returns its id', () => {
    const id = store.save({
      meshInstance: 'narrative-engine',
      agentId: 'narrative-engine/narrator',
      sessionId: 'sess-abc-123',
      messageUuid: 'msg-uuid-456',
      stageNumber: 3,
      stageTotal: 9,
      label: 'pre-synthesis',
      context: { game_id: 'campaign-1' },
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('retrieves a saved checkpoint by id', () => {
    const id = store.save({
      meshInstance: 'narrative-engine',
      agentId: 'narrative-engine/narrator',
      sessionId: 'sess-abc-123',
      stageNumber: 1,
      stageTotal: 5,
      label: 'init',
    });

    const cp = store.get(id);
    expect(cp).not.toBeNull();
    expect(cp!.mesh_instance).toBe('narrative-engine');
    expect(cp!.agent_id).toBe('narrative-engine/narrator');
    expect(cp!.stage_number).toBe(1);
    expect(cp!.stage_total).toBe(5);
    expect(cp!.label).toBe('init');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/agent-checkpoint-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write AgentCheckpointStore with save() and get()**

```typescript
// src/checkpoint/agent-checkpoint-store.ts
/**
 * AgentCheckpointStore - Persisted agent session checkpoints
 *
 * Saves session state at agent-initiated points so agents can
 * fork/restore to any saved checkpoint, forming a branch tree.
 *
 * Responsibilities:
 * - Schema management for agent_checkpoints table
 * - Save checkpoints with session/message/stage metadata
 * - Retrieve checkpoints by ID
 * - List/tree queries for checkpoint navigation
 * - Garbage collection of old checkpoints
 */

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { log } from '../shared/logger.ts';

export interface AgentCheckpoint {
  id: string;
  mesh_instance: string;
  agent_id: string;
  session_id: string;
  session_file_path: string | null;
  message_uuid: string | null;
  parent_checkpoint_id: string | null;
  stage_number: number | null;
  stage_total: number | null;
  label: string | null;
  context_snapshot: string;
  replay_token_estimate: number | null;
  workspace_snapshot_path: string | null;
  created_at: string;
}

export interface SaveCheckpointOpts {
  meshInstance: string;
  agentId: string;
  sessionId: string;
  sessionFilePath?: string;
  messageUuid?: string;
  parentCheckpointId?: string;
  stageNumber?: number;
  stageTotal?: number;
  label?: string;
  context?: Record<string, unknown>;
  replayTokenEstimate?: number;
  workspaceSnapshotPath?: string;
}

export class AgentCheckpointStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        id TEXT PRIMARY KEY,
        mesh_instance TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message_uuid TEXT,
        parent_checkpoint_id TEXT,
        stage_number INTEGER,
        stage_total INTEGER,
        label TEXT,
        context_snapshot TEXT DEFAULT '{}',
        workspace_snapshot_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (parent_checkpoint_id) REFERENCES agent_checkpoints(id)
      );
      CREATE INDEX IF NOT EXISTS idx_acp_mesh
        ON agent_checkpoints(mesh_instance, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_acp_agent
        ON agent_checkpoints(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_acp_parent
        ON agent_checkpoints(parent_checkpoint_id);
    `);
  }

  save(opts: SaveCheckpointOpts): string {
    const id = crypto.randomUUID().slice(0, 12);

    this.db.prepare(`
      INSERT INTO agent_checkpoints
        (id, mesh_instance, agent_id, session_id, session_file_path,
         message_uuid, parent_checkpoint_id, stage_number, stage_total,
         label, context_snapshot, replay_token_estimate,
         workspace_snapshot_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      opts.meshInstance,
      opts.agentId,
      opts.sessionId,
      opts.sessionFilePath ?? null,
      opts.messageUuid ?? null,
      opts.parentCheckpointId ?? null,
      opts.stageNumber ?? null,
      opts.stageTotal ?? null,
      opts.label ?? null,
      JSON.stringify(opts.context ?? {}),
      opts.replayTokenEstimate ?? null,
      opts.workspaceSnapshotPath ?? null,
    );

    log.debug('agent-checkpoint', 'Saved', {
      id,
      mesh: opts.meshInstance,
      agent: opts.agentId,
      stage: opts.stageNumber,
      label: opts.label,
    });

    return id;
  }

  get(id: string): AgentCheckpoint | null {
    return this.db.prepare(
      `SELECT * FROM agent_checkpoints WHERE id = ?`
    ).get(id) as AgentCheckpoint | null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/agent-checkpoint-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/checkpoint/agent-checkpoint-store.ts test/unit/agent-checkpoint-store.test.ts
git commit -m "feat(checkpoint): add AgentCheckpointStore with save/get"
```

---

### Task 2: AgentCheckpointStore — List, Tree, Children, GC

**Files:**
- Modify: `src/checkpoint/agent-checkpoint-store.ts`
- Modify: `test/unit/agent-checkpoint-store.test.ts`

- [ ] **Step 1: Write failing tests for list, children, tree, gc**

```typescript
// Append to test/unit/agent-checkpoint-store.test.ts

it('lists checkpoints for a mesh instance (most recent first)', () => {
  store.save({ meshInstance: 'mesh-a', agentId: 'mesh-a/x', sessionId: 's1', label: 'first' });
  store.save({ meshInstance: 'mesh-a', agentId: 'mesh-a/y', sessionId: 's2', label: 'second' });
  store.save({ meshInstance: 'mesh-b', agentId: 'mesh-b/z', sessionId: 's3', label: 'other' });

  const list = store.listForMesh('mesh-a');
  expect(list).toHaveLength(2);
  expect(list[0].label).toBe('second');
  expect(list[1].label).toBe('first');
});

it('lists children of a checkpoint', () => {
  const parent = store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: 's1', label: 'root' });
  store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: 's2', parentCheckpointId: parent, label: 'child-1' });
  store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: 's3', parentCheckpointId: parent, label: 'child-2' });

  const children = store.children(parent);
  expect(children).toHaveLength(2);
});

it('builds tree for a mesh', () => {
  const root = store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: 's1', label: 'root' });
  const child = store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: 's2', parentCheckpointId: root, label: 'child' });
  store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: 's3', parentCheckpointId: child, label: 'grandchild' });

  const tree = store.tree('m');
  expect(tree).toHaveLength(1); // 1 root
  expect(tree[0].children).toHaveLength(1);
  expect(tree[0].children[0].children).toHaveLength(1);
});

it('garbage collects old checkpoints', () => {
  for (let i = 0; i < 10; i++) {
    store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: `s${i}`, label: `cp-${i}` });
  }
  const deleted = store.gc(5);
  expect(deleted).toBe(5);
  expect(store.listForMesh('m')).toHaveLength(5);
});

it('counts branches for a mesh', () => {
  const root = store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: 's1', label: 'root' });
  store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: 's2', parentCheckpointId: root, label: 'b1' });
  store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: 's3', parentCheckpointId: root, label: 'b2' });

  expect(store.branchCount('m')).toBe(2);
});
```

- [ ] **Step 2: Run test to verify failures**

Run: `npx vitest run test/unit/agent-checkpoint-store.test.ts`
Expected: FAIL — methods not found

- [ ] **Step 3: Implement listForMesh, children, tree, branchCount, gc**

Add to `AgentCheckpointStore`:

```typescript
listForMesh(meshInstance: string, limit = 50): AgentCheckpoint[] {
  return this.db.prepare(`
    SELECT * FROM agent_checkpoints
    WHERE mesh_instance = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(meshInstance, limit) as AgentCheckpoint[];
}

children(checkpointId: string): AgentCheckpoint[] {
  return this.db.prepare(`
    SELECT * FROM agent_checkpoints
    WHERE parent_checkpoint_id = ?
    ORDER BY created_at ASC
  `).all(checkpointId) as AgentCheckpoint[];
}

branchCount(meshInstance: string): number {
  const result = this.db.prepare(`
    SELECT COUNT(*) as cnt FROM agent_checkpoints
    WHERE mesh_instance = ? AND parent_checkpoint_id IS NOT NULL
  `).get(meshInstance) as { cnt: number };
  return result.cnt;
}

tree(meshInstance: string): CheckpointTreeNode[] {
  const all = this.db.prepare(`
    SELECT * FROM agent_checkpoints
    WHERE mesh_instance = ?
    ORDER BY created_at ASC
  `).all(meshInstance) as AgentCheckpoint[];

  const nodeMap = new Map<string, CheckpointTreeNode>();
  const roots: CheckpointTreeNode[] = [];

  for (const cp of all) {
    nodeMap.set(cp.id, { ...cp, children: [] });
  }

  for (const cp of all) {
    const node = nodeMap.get(cp.id)!;
    if (cp.parent_checkpoint_id && nodeMap.has(cp.parent_checkpoint_id)) {
      nodeMap.get(cp.parent_checkpoint_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

gc(keepPerMesh = 50): number {
  const meshes = this.db.prepare(`
    SELECT mesh_instance, COUNT(*) as cnt FROM agent_checkpoints
    GROUP BY mesh_instance HAVING cnt > ?
  `).all(keepPerMesh) as Array<{ mesh_instance: string; cnt: number }>;

  let total = 0;
  for (const { mesh_instance } of meshes) {
    const result = this.db.prepare(`
      DELETE FROM agent_checkpoints WHERE mesh_instance = ? AND id NOT IN (
        SELECT id FROM agent_checkpoints WHERE mesh_instance = ?
        ORDER BY created_at DESC LIMIT ?
      )
    `).run(mesh_instance, mesh_instance, keepPerMesh);
    total += result.changes;
  }

  if (total > 0) {
    log.info('agent-checkpoint', 'GC pruned', { deleted: total });
  }
  return total;
}
```

Also add the tree node type:

```typescript
export interface CheckpointTreeNode extends AgentCheckpoint {
  children: CheckpointTreeNode[];
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/agent-checkpoint-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/checkpoint/agent-checkpoint-store.ts test/unit/agent-checkpoint-store.test.ts
git commit -m "feat(checkpoint): add list, tree, children, branchCount, gc"
```

---

### Task 3: Barrel Export

**Files:**
- Create: `src/checkpoint/index.ts`

- [ ] **Step 1: Create barrel**

```typescript
// src/checkpoint/index.ts
/**
 * Checkpoint module barrel export
 *
 * Responsibilities:
 * - Re-export AgentCheckpointStore and types
 */
export {
  AgentCheckpointStore,
  type AgentCheckpoint,
  type SaveCheckpointOpts,
  type CheckpointTreeNode,
} from './agent-checkpoint-store.ts';
```

- [ ] **Step 2: Commit**

```bash
git add src/checkpoint/index.ts
git commit -m "feat(checkpoint): add barrel export"
```

---

## Chunk 2: Workspace Snapshots (Opt-in)

### Task 4: WorkspaceSnapshotter

**Files:**
- Create: `src/checkpoint/workspace-snapshotter.ts`
- Test: `test/unit/workspace-snapshotter.test.ts`

Creates tarball snapshots of workspace directories for checkpoint restore. Opt-in via `--snapshot` flag.

- [ ] **Step 1: Write failing test**

```typescript
// test/unit/workspace-snapshotter.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceSnapshotter } from '../../src/checkpoint/workspace-snapshotter.ts';

describe('WorkspaceSnapshotter', () => {
  let tmpDir: string;
  let snapshotter: WorkspaceSnapshotter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-snap-'));
    snapshotter = new WorkspaceSnapshotter(path.join(tmpDir, 'snapshots'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a snapshot tar of a workspace directory', async () => {
    const wsDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(wsDir);
    fs.writeFileSync(path.join(wsDir, 'output.md'), 'test content');

    const snapPath = await snapshotter.save('cp-123', wsDir);
    expect(fs.existsSync(snapPath)).toBe(true);
    expect(snapPath).toContain('cp-123');
  });

  it('restores a snapshot to a target directory', async () => {
    const wsDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(wsDir);
    fs.writeFileSync(path.join(wsDir, 'output.md'), 'original');

    const snapPath = await snapshotter.save('cp-456', wsDir);

    // Modify workspace
    fs.writeFileSync(path.join(wsDir, 'output.md'), 'modified');

    // Restore
    const restoreDir = path.join(tmpDir, 'restored');
    await snapshotter.restore(snapPath, restoreDir);
    expect(fs.readFileSync(path.join(restoreDir, 'output.md'), 'utf-8')).toBe('original');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/workspace-snapshotter.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement WorkspaceSnapshotter**

```typescript
// src/checkpoint/workspace-snapshotter.ts
/**
 * WorkspaceSnapshotter - Tar-based workspace snapshots for checkpoint restore
 *
 * Responsibilities:
 * - Create tarball snapshots of workspace directories
 * - Restore snapshots to target directories
 * - Manage snapshot storage directory
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../shared/logger.ts';

const execFileAsync = promisify(execFile);

export class WorkspaceSnapshotter {
  private snapshotDir: string;

  constructor(snapshotDir: string) {
    this.snapshotDir = snapshotDir;
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  async save(checkpointId: string, workspaceDir: string): Promise<string> {
    const tarPath = path.join(this.snapshotDir, `${checkpointId}.tar.gz`);

    await execFileAsync('tar', [
      '-czf', tarPath,
      '-C', path.dirname(workspaceDir),
      path.basename(workspaceDir),
    ]);

    log.debug('workspace-snapshot', 'Saved', { checkpointId, tarPath });
    return tarPath;
  }

  async restore(snapshotPath: string, targetDir: string): Promise<void> {
    fs.mkdirSync(targetDir, { recursive: true });

    await execFileAsync('tar', [
      '-xzf', snapshotPath,
      '-C', targetDir,
      '--strip-components=1',
    ]);

    log.debug('workspace-snapshot', 'Restored', { snapshotPath, targetDir });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/workspace-snapshotter.test.ts`
Expected: PASS

- [ ] **Step 5: Add to barrel, commit**

Update `src/checkpoint/index.ts` to add:
```typescript
export { WorkspaceSnapshotter } from './workspace-snapshotter.ts';
```

```bash
git add src/checkpoint/workspace-snapshotter.ts test/unit/workspace-snapshotter.test.ts src/checkpoint/index.ts
git commit -m "feat(checkpoint): add WorkspaceSnapshotter for opt-in workspace tarballs"
```

---

## Chunk 3: CLI Commands — `tx mesh-cmd checkpoint`

### Task 5: mesh-cmd CLI Router

**Files:**
- Create: `src/cli/mesh-cmd.ts`
- Modify: `src/cli/index.ts`

This adds the `tx mesh-cmd` top-level command that routes to subcommand handlers. The first subcommand is `checkpoint`.

- [ ] **Step 1: Create mesh-cmd.ts router**

```typescript
// src/cli/mesh-cmd.ts
/**
 * tx mesh-cmd - Agent-callable mesh commands
 *
 * Commands agents invoke mid-session via bash tool.
 * These commands modify mesh runtime state.
 *
 * Responsibilities:
 * - Route mesh-cmd subcommands (checkpoint, dynaprompt)
 * - Parse common flags (mesh instance, agent)
 * - Provide JSON output for agent consumption
 */

import { checkpoint } from './mesh-cmd/checkpoint.ts';
import { chalk } from '../shared/colors.ts';

const HELP = `tx mesh-cmd - Agent-callable mesh commands

Subcommands:
  checkpoint save <mesh> <agent> [options]     Save a checkpoint
  checkpoint list <mesh>                       List checkpoints
  checkpoint tree <mesh>                       Show checkpoint tree
  checkpoint restore <checkpoint-id>           Restore from checkpoint
  checkpoint get <checkpoint-id>               Get checkpoint details

Run 'tx mesh-cmd <subcommand> -h' for subcommand help.`;

export async function meshCmd(args: string[]): Promise<void> {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'checkpoint':
      await checkpoint(subArgs);
      break;

    case '-h':
    case '--help':
    case undefined:
      console.log(HELP);
      break;

    default:
      console.error(chalk.red(`Unknown mesh-cmd subcommand: ${subcommand}`));
      console.log(HELP);
      process.exit(1);
  }
}
```

- [ ] **Step 2: Register in CLI index**

Add import at top of `src/cli/index.ts`:
```typescript
import { meshCmd } from './mesh-cmd.ts';
```

Add case in the switch block (before `default:`):
```typescript
case 'mesh-cmd':
  if (wantsHelp) { console.log('tx mesh-cmd - Agent-callable mesh commands\n\nRun tx mesh-cmd -h for details'); break; }
  await meshCmd(args);
  break;
```

Add to HELP.main commands list:
```
  tx mesh-cmd     Agent-callable mesh runtime commands (checkpoints, dynaprompt)
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/mesh-cmd.ts src/cli/index.ts
git commit -m "feat(cli): add tx mesh-cmd router"
```

---

### Task 6: checkpoint save command

**Files:**
- Create: `src/cli/mesh-cmd/checkpoint.ts`
- Test: `test/unit/mesh-cmd-checkpoint.test.ts`

- [ ] **Step 1: Write failing test for save**

```typescript
// test/unit/mesh-cmd-checkpoint.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AgentCheckpointStore } from '../../src/checkpoint/agent-checkpoint-store.ts';

describe('checkpoint save (unit: store integration)', () => {
  let db: Database.Database;
  let store: AgentCheckpointStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new AgentCheckpointStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('save creates checkpoint with stage metadata', () => {
    const id = store.save({
      meshInstance: 'narrative-engine',
      agentId: 'narrative-engine/narrator',
      sessionId: 'sess-123',
      stageNumber: 3,
      stageTotal: 9,
      label: 'post-world-building',
    });

    const cp = store.get(id);
    expect(cp).not.toBeNull();
    expect(cp!.stage_number).toBe(3);
    expect(cp!.stage_total).toBe(9);
    expect(cp!.label).toBe('post-world-building');
  });

  it('save with parent creates tree relationship', () => {
    const root = store.save({
      meshInstance: 'm',
      agentId: 'm/a',
      sessionId: 's1',
      label: 'root',
    });

    const child = store.save({
      meshInstance: 'm',
      agentId: 'm/a',
      sessionId: 's2',
      parentCheckpointId: root,
      label: 'branch-a',
    });

    const cp = store.get(child);
    expect(cp!.parent_checkpoint_id).toBe(root);
  });
});
```

- [ ] **Step 2: Run test to verify passes (store already built)**

Run: `npx vitest run test/unit/mesh-cmd-checkpoint.test.ts`
Expected: PASS

- [ ] **Step 3: Implement checkpoint CLI handler**

```typescript
// src/cli/mesh-cmd/checkpoint.ts
/**
 * tx mesh-cmd checkpoint - Agent-initiated checkpoint management
 *
 * Responsibilities:
 * - Parse checkpoint subcommands (save, list, tree, restore, get)
 * - Initialize AgentCheckpointStore from queue.db
 * - Format output as JSON for agent consumption
 */

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { AgentCheckpointStore, WorkspaceSnapshotter } from '../../checkpoint/index.ts';
import { chalk } from '../../shared/colors.ts';
import { log } from '../../shared/logger.ts';

const HELP = `tx mesh-cmd checkpoint - Manage agent checkpoints

Commands:
  save <mesh> <agent> [options]   Save a checkpoint
  list <mesh>                     List checkpoints for mesh
  tree <mesh>                     Show checkpoint tree
  restore <checkpoint-id>         Restore from checkpoint
  get <checkpoint-id>             Get checkpoint details

Save options:
  --session <id>            Session ID (required)
  --session-file <path>     Path to JSONL session file (for replay-based restore)
  --stage <n>               Current stage number
  --of <n>                  Total stages
  --label <text>            Human-readable label
  --parent <cp-id>          Parent checkpoint (for branching)
  --message-uuid <uuid>     SDK message UUID for resume point
  --replay-tokens <n>       Estimated input tokens for replay (cost tracking)
  --snapshot                Include workspace snapshot (opt-in)
  --workspace <path>        Workspace directory (required with --snapshot)
  --context <json>          FSM context snapshot as JSON string

Output: JSON (for agent parsing)`;

function getStore(): { store: AgentCheckpointStore; db: Database.Database } {
  const cwd = process.env.TX_CWD || process.cwd();
  const dbPath = path.join(cwd, '.ai', 'tx', 'queue.db');

  if (!fs.existsSync(dbPath)) {
    console.error(JSON.stringify({ error: 'No queue database found', path: dbPath }));
    process.exit(1);
  }

  const db = new Database(dbPath);
  const store = new AgentCheckpointStore(db);
  return { store, db };
}

function parseCheckpointFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function getNonFlags(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      // Skip flag value if present
      if (args[i + 1] && !args[i + 1].startsWith('--')) i++;
    } else {
      result.push(args[i]);
    }
  }
  return result;
}

export async function checkpoint(args: string[]): Promise<void> {
  const action = args[0];
  const subArgs = args.slice(1);

  switch (action) {
    case 'save':
      await saveCheckpoint(subArgs);
      break;

    case 'list':
      listCheckpoints(subArgs);
      break;

    case 'tree':
      showTree(subArgs);
      break;

    case 'restore':
      restoreCheckpoint(subArgs);
      break;

    case 'get':
      getCheckpoint(subArgs);
      break;

    case '-h':
    case '--help':
    case undefined:
      console.log(HELP);
      break;

    default:
      console.error(JSON.stringify({ error: `Unknown checkpoint action: ${action}` }));
      process.exit(1);
  }
}

async function saveCheckpoint(args: string[]): Promise<void> {
  const nonFlags = getNonFlags(args);
  const flags = parseCheckpointFlags(args);

  const meshInstance = nonFlags[0];
  const agentId = nonFlags[1];

  if (!meshInstance || !agentId) {
    console.error(JSON.stringify({ error: 'Usage: tx mesh-cmd checkpoint save <mesh> <agent> --session <id> [options]' }));
    process.exit(1);
  }

  const sessionId = flags.session as string;
  if (!sessionId) {
    console.error(JSON.stringify({ error: '--session is required' }));
    process.exit(1);
  }

  const { store, db } = getStore();

  let workspaceSnapshotPath: string | undefined;
  if (flags.snapshot) {
    const wsPath = flags.workspace as string;
    if (!wsPath) {
      console.error(JSON.stringify({ error: '--workspace is required with --snapshot' }));
      db.close();
      process.exit(1);
    }
    const cwd = process.env.TX_CWD || process.cwd();
    const snapshotDir = path.join(cwd, '.ai', 'tx', 'data', 'checkpoint-snapshots');
    const snapshotter = new WorkspaceSnapshotter(snapshotDir);
    // Generate temp ID for snapshot filename, will be updated after save
    const tempId = Date.now().toString(36);
    workspaceSnapshotPath = await snapshotter.save(tempId, wsPath);
  }

  let context: Record<string, unknown> | undefined;
  if (flags.context) {
    try {
      context = JSON.parse(flags.context as string);
    } catch {
      console.error(JSON.stringify({ error: 'Invalid JSON in --context' }));
      db.close();
      process.exit(1);
    }
  }

  const id = store.save({
    meshInstance,
    agentId,
    sessionId,
    sessionFilePath: flags['session-file'] as string,
    messageUuid: flags['message-uuid'] as string,
    parentCheckpointId: flags.parent as string,
    stageNumber: flags.stage ? parseInt(flags.stage as string, 10) : undefined,
    stageTotal: flags.of ? parseInt(flags.of as string, 10) : undefined,
    label: flags.label as string,
    context,
    replayTokenEstimate: flags['replay-tokens'] ? parseInt(flags['replay-tokens'] as string, 10) : undefined,
    workspaceSnapshotPath,
  });

  console.log(JSON.stringify({
    checkpoint_id: id,
    mesh_instance: meshInstance,
    agent_id: agentId,
    stage: flags.stage ? `${flags.stage}/${flags.of || '?'}` : null,
    label: flags.label || null,
    snapshot: !!flags.snapshot,
  }));

  db.close();
}

function listCheckpoints(args: string[]): void {
  const nonFlags = getNonFlags(args);
  const meshInstance = nonFlags[0];

  if (!meshInstance) {
    console.error(JSON.stringify({ error: 'Usage: tx mesh-cmd checkpoint list <mesh>' }));
    process.exit(1);
  }

  const { store, db } = getStore();
  const checkpoints = store.listForMesh(meshInstance);
  console.log(JSON.stringify({ mesh_instance: meshInstance, checkpoints }, null, 2));
  db.close();
}

function showTree(args: string[]): void {
  const nonFlags = getNonFlags(args);
  const meshInstance = nonFlags[0];

  if (!meshInstance) {
    console.error(JSON.stringify({ error: 'Usage: tx mesh-cmd checkpoint tree <mesh>' }));
    process.exit(1);
  }

  const { store, db } = getStore();
  const tree = store.tree(meshInstance);
  console.log(JSON.stringify({ mesh_instance: meshInstance, tree }, null, 2));
  db.close();
}

function restoreCheckpoint(args: string[]): void {
  const nonFlags = getNonFlags(args);
  const checkpointId = nonFlags[0];

  if (!checkpointId) {
    console.error(JSON.stringify({ error: 'Usage: tx mesh-cmd checkpoint restore <checkpoint-id>' }));
    process.exit(1);
  }

  const { store, db } = getStore();
  const cp = store.get(checkpointId);

  if (!cp) {
    console.error(JSON.stringify({ error: `Checkpoint not found: ${checkpointId}` }));
    db.close();
    process.exit(1);
  }

  // Validate session file exists (replay-based restore needs the JSONL)
  if (cp.session_file_path && !fs.existsSync(cp.session_file_path)) {
    console.error(JSON.stringify({
      error: `Session file missing: ${cp.session_file_path}`,
      hint: 'The JSONL session file has been deleted or moved. Replay-based restore requires the original session history.',
      checkpoint_id: cp.id,
    }));
    db.close();
    process.exit(1);
  }

  // Output restore instructions — dispatcher reads this to fork session
  console.log(JSON.stringify({
    action: 'restore',
    checkpoint_id: cp.id,
    session_id: cp.session_id,
    session_file_path: cp.session_file_path,
    message_uuid: cp.message_uuid,
    agent_id: cp.agent_id,
    mesh_instance: cp.mesh_instance,
    context_snapshot: JSON.parse(cp.context_snapshot),
    workspace_snapshot_path: cp.workspace_snapshot_path,
    replay_token_estimate: cp.replay_token_estimate,
    stage: cp.stage_number ? `${cp.stage_number}/${cp.stage_total || '?'}` : null,
    label: cp.label,
  }));

  db.close();
}

function getCheckpoint(args: string[]): void {
  const nonFlags = getNonFlags(args);
  const checkpointId = nonFlags[0];

  if (!checkpointId) {
    console.error(JSON.stringify({ error: 'Usage: tx mesh-cmd checkpoint get <checkpoint-id>' }));
    process.exit(1);
  }

  const { store, db } = getStore();
  const cp = store.get(checkpointId);

  if (!cp) {
    console.error(JSON.stringify({ error: `Checkpoint not found: ${checkpointId}` }));
    db.close();
    process.exit(1);
  }

  console.log(JSON.stringify(cp, null, 2));
  db.close();
}
```

- [ ] **Step 4: Commit**

```bash
mkdir -p src/cli/mesh-cmd
git add src/cli/mesh-cmd/checkpoint.ts src/cli/mesh-cmd.ts
git commit -m "feat(cli): add tx mesh-cmd checkpoint save/list/tree/restore/get"
```

---

## Chunk 4: Guardrail — max_branches

### Task 7: Add max_branches guardrail

**Files:**
- Modify: `src/worker/guardrail-config.ts`
- Modify: `src/checkpoint/agent-checkpoint-store.ts`
- Test: `test/unit/agent-checkpoint-store.test.ts`

Follows existing guardrail patterns. `max_branches` limits how many child checkpoints can exist per mesh instance. Same override chain: agent > mesh > global > default.

- [ ] **Step 1: Write failing test for branch limit check**

```typescript
// Append to test/unit/agent-checkpoint-store.test.ts

it('enforces max branches limit', () => {
  const root = store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: 's1', label: 'root' });

  // Save 3 branches
  for (let i = 0; i < 3; i++) {
    store.save({ meshInstance: 'm', agentId: 'm/a', sessionId: `s${i+2}`, parentCheckpointId: root, label: `b${i}` });
  }

  // Check if at limit
  expect(store.isAtBranchLimit('m', 3)).toBe(true);
  expect(store.isAtBranchLimit('m', 5)).toBe(false);
});
```

- [ ] **Step 2: Run test — FAIL**

Run: `npx vitest run test/unit/agent-checkpoint-store.test.ts`

- [ ] **Step 3: Add isAtBranchLimit to store**

```typescript
// Add to AgentCheckpointStore
isAtBranchLimit(meshInstance: string, maxBranches: number): boolean {
  return this.branchCount(meshInstance) >= maxBranches;
}
```

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Add max_branches to GuardrailConfig**

Add to `src/worker/guardrail-config.ts`:

In `AgentOverrides` interface, add:
```typescript
max_branches?: MaxBranchesOverride | number | null;
```

Add new interface:
```typescript
interface MaxBranchesOverride {
  strict?: boolean;
  warning?: boolean;
  limit?: number | null;
}
```

Add to `DEFAULTS`:
```typescript
max_branches: null as number | null,
```

Add to `GUARDRAIL_DEFAULT_MODES`:
```typescript
max_branches: { strict: true, warning: true },
```

Add resolver method:
```typescript
getMaxBranches(meshName: string, agentName?: string): number | null {
  const local = this.meshLocal.get(meshName);
  const g = this.config.guardrails;

  if (agentName) {
    const localAgent = this.extractLimit(local?.agents?.[agentName]?.max_branches as MaxBranchesOverride | number | null | undefined);
    if (localAgent !== undefined) return localAgent;
  }

  const localMesh = this.extractLimit(local?.max_branches as MaxBranchesOverride | number | null | undefined);
  if (localMesh !== undefined) return localMesh;

  if (agentName) {
    const globalAgent = this.extractLimit(g?.meshes?.[meshName]?.agents?.[agentName]?.max_branches as MaxBranchesOverride | number | null | undefined);
    if (globalAgent !== undefined) return globalAgent;
  }

  const globalMesh = this.extractLimit(g?.meshes?.[meshName]?.max_branches as MaxBranchesOverride | number | null | undefined);
  if (globalMesh !== undefined) return globalMesh;

  const globalVal = this.extractLimit(g?.max_branches as MaxBranchesOverride | number | null | undefined);
  if (globalVal !== undefined) return globalVal;

  return DEFAULTS.max_branches;
}
```

Add `max_branches` to the `getMode()` method's type union.

- [ ] **Step 6: Enforce max_branches in checkpoint save CLI**

In `src/cli/mesh-cmd/checkpoint.ts` `saveCheckpoint()`, add before the `store.save()` call:

```typescript
// Check max_branches guardrail
const guardrails = new GuardrailConfig(cwd);
const meshName = meshInstance.split('/')[0] || meshInstance;
const agentName = agentId.split('/')[1];
const maxBranches = guardrails.getMaxBranches(meshName, agentName);

if (maxBranches !== null && store.isAtBranchLimit(meshInstance, maxBranches)) {
  const mode = guardrails.getMode('max_branches', meshName, agentName);
  if (mode.strict) {
    console.error(JSON.stringify({
      error: `max_branches limit reached (${maxBranches})`,
      guardrail: 'max_branches',
      mode: 'strict',
    }));
    db.close();
    process.exit(1);
  }
  if (mode.warning) {
    log.warn('agent-checkpoint', 'max_branches WARNING', {
      meshInstance, agentId, limit: maxBranches, current: store.branchCount(meshInstance),
    });
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/worker/guardrail-config.ts src/checkpoint/agent-checkpoint-store.ts src/cli/mesh-cmd/checkpoint.ts test/unit/agent-checkpoint-store.test.ts
git commit -m "feat(guardrails): add max_branches with override chain"
```

---

## Chunk 5: Integration — Wire Store into Dispatcher

### Task 8: Initialize AgentCheckpointStore in Dispatcher

**Files:**
- Modify: `src/worker/dispatcher.ts`

The dispatcher already has access to `queue.db`. Add an `AgentCheckpointStore` instance so it can be used for restore operations (spawning forked workers from checkpoints).

- [ ] **Step 1: Add import and field**

In `src/worker/dispatcher.ts`, add import:
```typescript
import { AgentCheckpointStore } from '../checkpoint/index.ts';
```

In `WorkerDispatcher` class, add field:
```typescript
private agentCheckpoints?: AgentCheckpointStore;
```

In constructor, after the line `this.guardrails = new GuardrailConfig(config.workDir);`, add:
```typescript
// Agent checkpoint store (shares queue.db)
// Initialized lazily when first checkpoint command is received
```

- [ ] **Step 2: Add initCheckpointStore helper**

```typescript
private getAgentCheckpointStore(): AgentCheckpointStore {
  if (!this.agentCheckpoints) {
    this.agentCheckpoints = new AgentCheckpointStore(this.queue.db);
  }
  return this.agentCheckpoints;
}
```

Note: This requires `MessageQueue` to expose its db instance. Check if `this.queue.db` is accessible — if not, the CLI commands use their own db connection (which they already do), and the dispatcher integration can be deferred to a follow-up task.

- [ ] **Step 3: Commit**

```bash
git add src/worker/dispatcher.ts
git commit -m "feat(dispatcher): add lazy AgentCheckpointStore initialization"
```

---

### Task 9: Add `mesh-cmd` to CLAUDE.md and agent-help

**Files:**
- Modify: `CLAUDE.md` (tx-core)
- Modify: `src/cli/agent-help.ts`

- [ ] **Step 1: Add mesh-cmd to CLAUDE.md CLI Commands table**

Add row:
```
| `tx mesh-cmd`  | Agent-callable mesh commands (checkpoints) |
```

- [ ] **Step 2: Add checkpoint reference to agent-help**

Add a new section to the agent-help topics covering checkpoint usage:

```typescript
// In agent-help.ts, add topic
checkpoints: `## Agent Checkpoints

Save and restore session checkpoints during execution.

### Save a checkpoint
\`\`\`bash
tx mesh-cmd checkpoint save <mesh> <agent> \\
  --session <session-id> \\
  --stage <n> --of <total> \\
  --label "description" \\
  [--parent <checkpoint-id>] \\
  [--snapshot --workspace <path>]
\`\`\`

### List checkpoints
\`\`\`bash
tx mesh-cmd checkpoint list <mesh>
\`\`\`

### Show checkpoint tree
\`\`\`bash
tx mesh-cmd checkpoint tree <mesh>
\`\`\`

### Restore from checkpoint
\`\`\`bash
tx mesh-cmd checkpoint restore <checkpoint-id>
\`\`\`

Output is JSON. Use jq for parsing.
`,
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md src/cli/agent-help.ts
git commit -m "docs: add mesh-cmd checkpoint to CLI docs and agent-help"
```

---

### Task 10: Update mesh-builder skill

**Files:**
- Modify: `.claude/skills/mesh-builder/SKILL.md`

Per CLAUDE.md requirement: update mesh-builder skill when config patterns change.

- [ ] **Step 1: Add checkpoint CLI reference to skill**

Add a section documenting the `tx mesh-cmd checkpoint` commands as available bash tools for agents. Document the guardrail config field `max_branches`.

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/mesh-builder/SKILL.md
git commit -m "docs: update mesh-builder skill with checkpoint commands"
```

---

## Chunk 6: Tests — E2E Checkpoint Flow

### Task 11: E2E test for checkpoint save/list/tree/get

**Files:**
- Create: `test/e2e/37-checkpoint-infra.test.ts`

Infrastructure test (no LLM) that exercises the full CLI flow through store.

- [ ] **Step 1: Write E2E test**

```typescript
// test/e2e/37-checkpoint-infra.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('tx mesh-cmd checkpoint (e2e)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-cp-e2e-'));
    // Create minimal TX structure
    fs.mkdirSync(path.join(tmpDir, '.ai', 'tx', 'data'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.ai', 'tx', 'msgs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runCmd(cmd: string): string {
    return execSync(cmd, {
      cwd: tmpDir,
      env: { ...process.env, TX_CWD: tmpDir },
      encoding: 'utf-8',
    }).trim();
  }

  it('save + list + get round-trips', () => {
    // Need queue.db to exist first
    const Database = require('better-sqlite3');
    const db = new Database(path.join(tmpDir, '.ai', 'tx', 'queue.db'));
    db.close();

    const saveOutput = runCmd(
      `npx tsx src/cli/index.ts mesh-cmd checkpoint save test-mesh test-mesh/worker --session sess-123 --stage 2 --of 5 --label "mid-point"`
    );
    const saved = JSON.parse(saveOutput);
    expect(saved.checkpoint_id).toBeDefined();

    const listOutput = runCmd(
      `npx tsx src/cli/index.ts mesh-cmd checkpoint list test-mesh`
    );
    const listed = JSON.parse(listOutput);
    expect(listed.checkpoints).toHaveLength(1);

    const getOutput = runCmd(
      `npx tsx src/cli/index.ts mesh-cmd checkpoint get ${saved.checkpoint_id}`
    );
    const got = JSON.parse(getOutput);
    expect(got.label).toBe('mid-point');
    expect(got.stage_number).toBe(2);
  });

  it('tree shows parent-child relationships', () => {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(tmpDir, '.ai', 'tx', 'queue.db'));
    db.close();

    const root = JSON.parse(runCmd(
      `npx tsx src/cli/index.ts mesh-cmd checkpoint save m m/a --session s1 --label root`
    ));

    runCmd(
      `npx tsx src/cli/index.ts mesh-cmd checkpoint save m m/a --session s2 --parent ${root.checkpoint_id} --label branch-a`
    );

    const treeOutput = JSON.parse(runCmd(
      `npx tsx src/cli/index.ts mesh-cmd checkpoint tree m`
    ));

    expect(treeOutput.tree).toHaveLength(1);
    expect(treeOutput.tree[0].children).toHaveLength(1);
    expect(treeOutput.tree[0].children[0].label).toBe('branch-a');
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run test/e2e/37-checkpoint-infra.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/e2e/37-checkpoint-infra.test.ts
git commit -m "test(e2e): add checkpoint infrastructure tests"
```

---

## Summary: File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/checkpoint/agent-checkpoint-store.ts` | SQLite store for agent checkpoints |
| Create | `src/checkpoint/workspace-snapshotter.ts` | Opt-in workspace tar snapshots |
| Create | `src/checkpoint/index.ts` | Barrel export |
| Create | `src/cli/mesh-cmd.ts` | Top-level mesh-cmd router |
| Create | `src/cli/mesh-cmd/checkpoint.ts` | Checkpoint CLI handler |
| Modify | `src/cli/index.ts` | Register mesh-cmd command |
| Modify | `src/worker/guardrail-config.ts` | Add max_branches guardrail |
| Modify | `src/worker/dispatcher.ts` | Lazy checkpoint store init |
| Modify | `CLAUDE.md` | Document mesh-cmd |
| Modify | `src/cli/agent-help.ts` | Add checkpoint reference |
| Modify | `.claude/skills/mesh-builder/SKILL.md` | Document checkpoint pattern |
| Create | `test/unit/agent-checkpoint-store.test.ts` | Unit tests |
| Create | `test/unit/workspace-snapshotter.test.ts` | Unit tests |
| Create | `test/unit/mesh-cmd-checkpoint.test.ts` | CLI integration tests |
| Create | `test/e2e/37-checkpoint-infra.test.ts` | E2E infrastructure test |
