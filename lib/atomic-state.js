const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { EventBus } = require('./event-bus');

class AtomicState {
  static locks = new Map(); // mesh -> lock promise

  /**
   * Ensure mesh state file exists with defaults
   */
  static _ensureState(mesh) {
    const meshDir = `.ai/tx/mesh/${mesh}`;
    const stateFile = path.join(meshDir, 'state.json');

    fs.ensureDirSync(meshDir);

    if (!fs.existsSync(stateFile)) {
      const defaultState = {
        mesh,
        status: 'initialized',
        started: new Date().toISOString(),
        current_agent: null,
        workflow: [],
        workflow_position: 0,
        tasks_completed: 0,
        previous_agent: null,
        active_sessions: [],
        current_session: null
      };

      fs.writeJsonSync(stateFile, defaultState, { spaces: 2 });
    }
  }

  /**
   * Acquire lock for mesh (simple file-based locking)
   */
  static async _acquireLock(mesh, timeout = 5000) {
    const lockFile = `.ai/tx/mesh/${mesh}/.lock`;

    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        // Try to create lock file exclusively
        fs.ensureDirSync(path.dirname(lockFile));

        if (!fs.existsSync(lockFile)) {
          fs.writeFileSync(lockFile, process.pid.toString());
          return lockFile;
        }

        // Wait a bit and retry
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch (error) {
        // Retry on error
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    throw new Error(`Failed to acquire lock for mesh: ${mesh}`);
  }

  /**
   * Release lock
   */
  static _releaseLock(lockFile) {
    try {
      if (fs.existsSync(lockFile)) {
        fs.removeSync(lockFile);
      }
    } catch (error) {
      Logger.warn('atomic-state', `Failed to release lock: ${error.message}`);
    }
  }

  /**
   * Read state for mesh
   */
  static read(mesh) {
    AtomicState._ensureState(mesh);

    const stateFile = path.join(`.ai/tx/mesh/${mesh}`, 'state.json');
    try {
      return fs.readJsonSync(stateFile);
    } catch (error) {
      Logger.error('atomic-state', `Failed to read state: ${error.message}`, {
        mesh
      });
      return null;
    }
  }

  /**
   * Update state for mesh (async to support locking)
   */
  static async update(mesh, changes) {
    AtomicState._ensureState(mesh);

    const stateFile = path.join(`.ai/tx/mesh/${mesh}`, 'state.json');
    const lockFile = await AtomicState._acquireLock(mesh);

    try {
      // Read current state
      const previous = fs.readJsonSync(stateFile);

      // Apply changes
      const current = { ...previous, ...changes };

      // Write updated state
      fs.writeJsonSync(stateFile, current, { spaces: 2 });

      // Emit change event
      EventBus.emit('state:changed', {
        mesh,
        changes,
        previous,
        current
      });

      Logger.log('atomic-state', 'State updated', {
        mesh,
        changes
      });

      return current;
    } finally {
      AtomicState._releaseLock(lockFile);
    }
  }

  /**
   * Synchronous update (for tests)
   */
  static updateSync(mesh, changes) {
    AtomicState._ensureState(mesh);

    const stateFile = path.join(`.ai/tx/mesh/${mesh}`, 'state.json');

    try {
      // Read current state
      const previous = fs.readJsonSync(stateFile);

      // Apply changes
      const current = { ...previous, ...changes };

      // Write updated state
      fs.writeJsonSync(stateFile, current, { spaces: 2 });

      // Emit change event
      EventBus.emit('state:changed', {
        mesh,
        changes,
        previous,
        current
      });

      Logger.log('atomic-state', 'State updated (sync)', {
        mesh,
        changes
      });

      return current;
    } catch (error) {
      Logger.error('atomic-state', `Failed to update state: ${error.message}`, {
        mesh
      });
      throw error;
    }
  }

  /**
   * Get nested value from state
   */
  static get(mesh, key) {
    const state = AtomicState.read(mesh);
    if (!state) return null;

    // Support nested keys like 'workflow.position'
    const keys = key.split('.');
    let value = state;

    for (const k of keys) {
      value = value?.[k];
    }

    return value;
  }

  /**
   * Increment a numeric value in state
   */
  static async increment(mesh, key, amount = 1) {
    const current = AtomicState.get(mesh, key) || 0;
    return AtomicState.update(mesh, { [key]: current + amount });
  }

  /**
   * Clear state for mesh
   */
  static clear(mesh) {
    const meshDir = `.ai/tx/mesh/${mesh}`;
    if (fs.existsSync(meshDir)) {
      fs.removeSync(meshDir);
    }
  }
}

module.exports = { AtomicState };
