#!/usr/bin/env node

/**
 * Migration Script - File-based state to SQLite
 *
 * Migrates existing agent states from JSON files to SQLite database
 */

const fs = require('fs-extra');
const path = require('path');
const StateDB = require('../lib/state-db');
const { StateManager } = require('../lib/state-manager');

async function migrate() {
  console.log('🔄 Starting migration to SQLite...\n');

  // Initialize database
  console.log('📦 Initializing database...');
  StateDB.init();
  console.log('✅ Database initialized\n');

  // Backup existing state files
  const backupDir = '.ai/tx/state-backups';
  const stateDir = '.ai/tx/state';

  if (await fs.pathExists(stateDir)) {
    console.log('💾 Backing up existing state files...');
    await fs.copy(stateDir, backupDir);
    console.log(`✅ Backed up to ${backupDir}\n`);
  }

  let migratedCount = 0;
  let errorCount = 0;

  // Migrate agent states from .ai/tx/state/agents/
  const agentsDir = path.join(stateDir, 'agents');
  if (await fs.pathExists(agentsDir)) {
    console.log('🔍 Scanning agent state files...');

    const files = await fs.readdir(agentsDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = path.join(agentsDir, file);
        const stateData = await fs.readJson(filePath);

        // Extract agentId from filename or data
        const agentId = stateData.agentId || file.replace('.json', '');

        // Initialize agent in SQLite
        StateManager.initializeAgent(
          agentId,
          stateData.sessionName || agentId.split('/')[0],
          false
        );

        // Transition to current state
        if (stateData.state && stateData.state !== 'spawned') {
          StateManager.transitionState(agentId, stateData.state, stateData.metadata || {});
        }

        // Update task if present
        if (stateData.currentTask) {
          StateManager.updateTask(agentId, stateData.currentTask);
        }

        // Update last activity
        if (stateData.lastActivity) {
          const db = StateDB.init();
          const timestamp = new Date(stateData.lastActivity).getTime();
          db.prepare(`
            UPDATE agents
            SET last_activity = ?
            WHERE agent_id = ?
          `).run(timestamp, agentId);
        }

        console.log(`  ✅ Migrated ${agentId}`);
        migratedCount++;
      } catch (error) {
        console.error(`  ❌ Failed to migrate ${file}:`, error.message);
        errorCount++;
      }
    }
  }

  // Migrate mesh states from .ai/tx/mesh/*/state.json
  const meshDir = '.ai/tx/mesh';
  if (await fs.pathExists(meshDir)) {
    console.log('\n🔍 Scanning mesh state files...');

    const meshes = await fs.readdir(meshDir);

    for (const mesh of meshes) {
      const meshStatePath = path.join(meshDir, mesh, 'state.json');

      if (await fs.pathExists(meshStatePath)) {
        try {
          const meshState = await fs.readJson(meshStatePath);

          const db = StateDB.init();
          const now = Date.now();

          db.prepare(`
            INSERT OR REPLACE INTO mesh_states (
              mesh_name, status, workflow, workflow_position,
              tasks_completed, current_agent, previous_agent,
              started_at, updated_at, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            mesh,
            meshState.status || 'active',
            JSON.stringify(meshState.workflow || []),
            meshState.workflow_position || meshState.workflowPosition || 0,
            meshState.tasks_completed || meshState.tasksCompleted || 0,
            meshState.current_agent || meshState.currentAgent || null,
            meshState.previous_agent || meshState.previousAgent || null,
            meshState.started ? new Date(meshState.started).getTime() : (meshState.startedAt ? new Date(meshState.startedAt).getTime() : now),
            now,
            JSON.stringify(meshState)
          );

          console.log(`  ✅ Migrated mesh ${mesh}`);
          migratedCount++;
        } catch (error) {
          console.error(`  ❌ Failed to migrate mesh ${mesh}:`, error.message);
          errorCount++;
        }
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Migration Summary');
  console.log('='.repeat(50));
  console.log(`✅ Successfully migrated: ${migratedCount}`);
  console.log(`❌ Errors: ${errorCount}`);

  // Verify database health
  const health = StateDB.getHealth();
  console.log(`\n📈 Database Health:`);
  console.log(`  Agents: ${health.agentCount}`);
  console.log(`  Tasks: ${health.taskCount}`);
  console.log(`  Transitions: ${health.transitionCount}`);
  console.log(`  DB Size: ${Math.round(health.dbSize / 1024)} KB`);

  console.log('\n✨ Migration complete!');
  console.log('\n💡 Next steps:');
  console.log('  1. Test with: tx status');
  console.log('  2. If issues, restore from backup:');
  console.log('     cp -r .ai/tx/state-backups/* .ai/tx/state/');
  console.log('  3. Old state files kept in .ai/tx/state-backups/');

  // Close database
  StateDB.close();
}

// Run migration
migrate().catch(error => {
  console.error('\n❌ Migration failed:', error);
  process.exit(1);
});
