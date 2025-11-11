/**
 * State Manager - SQLite-backed agent lifecycle tracking
 *
 * Core states:
 * - spawned: Just created, tmux pane exists
 * - initializing: Injecting prompts, setting up
 * - ready: Idle, available for tasks
 * - working: Actively processing task
 * - blocked: Waiting on input
 * - distracted: Has task but inactive >10s 🐿️
 * - completing: Writing final outputs
 * - error: Crashed or fatal error
 * - suspended: Manually paused
 * - killed: Terminated
 */

const StateDB = require('./state-db');
const { EventBus } = require('./event-bus');
const { Logger } = require('./logger');

class StateManager {
  static STATES = {
    SPAWNED: 'spawned',
    INITIALIZING: 'initializing',
    READY: 'ready',
    WORKING: 'working',
    BLOCKED: 'blocked',
    DISTRACTED: 'distracted',
    COMPLETING: 'completing',
    ERROR: 'error',
    SUSPENDED: 'suspended',
    KILLED: 'killed'
  };

  static DISTRACTION_THRESHOLD = 60000; // 60 seconds (1 minute)
  static monitors = new Map(); // agentId -> monitor interval

  /**
   * Initialize state for a new agent
   * @param {string} agentId - Agent identifier (mesh/agent)
   * @param {string} sessionName - Tmux session name
   * @param {boolean} startMonitoring - Whether to start monitoring
   * @returns {Object} Initial state
   */
  static initializeAgent(agentId, sessionName, startMonitoring = false) {
    const db = StateDB.init();
    const now = Date.now();

    return StateDB.transaction(() => {
      // Insert agent
      db.prepare(`
        INSERT OR REPLACE INTO agents (
          agent_id, state, session_name, current_task,
          last_activity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(agentId, StateManager.STATES.SPAWNED, sessionName, null, now, now, now);

      // Record initial transition
      db.prepare(`
        INSERT INTO state_transitions (agent_id, from_state, to_state, transitioned_at)
        VALUES (?, ?, ?, ?)
      `).run(agentId, null, StateManager.STATES.SPAWNED, now);

      Logger.log('state-manager', `Initialized state for ${agentId}`, {
        state: StateManager.STATES.SPAWNED,
        session: sessionName
      });

      if (startMonitoring) {
        StateManager.startMonitoring(agentId);
      }

      return StateManager.getState(agentId);
    });
  }

  /**
   * Transition agent to new state
   * @param {string} agentId - Agent identifier
   * @param {string} newState - New state
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Updated state
   */
  static transitionState(agentId, newState, metadata = {}) {
    const db = StateDB.init();

    return StateDB.transaction(() => {
      const current = db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId);

      if (!current) {
        Logger.warn('state-manager', `No state found for ${agentId}`);
        return null;
      }

      // Validate transition
      if (!StateManager.isValidTransition(current.state, newState)) {
        Logger.warn('state-manager', `Invalid transition for ${agentId}`, {
          from: current.state,
          to: newState
        });
        return current;
      }

      const now = Date.now();

      // Update agent state
      db.prepare(`
        UPDATE agents
        SET state = ?, updated_at = ?
        WHERE agent_id = ?
      `).run(newState, now, agentId);

      // Record transition
      db.prepare(`
        INSERT INTO state_transitions (agent_id, from_state, to_state, metadata, transitioned_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(agentId, current.state, newState, JSON.stringify(metadata), now);

      // Update metadata if provided
      if (Object.keys(metadata).length > 0) {
        for (const [key, value] of Object.entries(metadata)) {
          db.prepare(`
            INSERT OR REPLACE INTO agent_metadata (agent_id, key, value, updated_at)
            VALUES (?, ?, ?, ?)
          `).run(agentId, key, JSON.stringify(value), now);
        }
      }

      Logger.log('state-manager', `State transition: ${agentId}`, {
        from: current.state,
        to: newState
      });

      // Emit event
      EventBus.emit('agent:state:changed', {
        agentId,
        oldState: current.state,
        newState,
        timestamp: new Date(now).toISOString()
      });

      return StateManager.getState(agentId);
    });
  }

  /**
   * Update agent activity timestamp
   * @param {string} agentId - Agent identifier
   */
  static updateActivity(agentId) {
    const db = StateDB.init();
    const now = Date.now();

    db.prepare(`
      UPDATE agents
      SET last_activity = ?, updated_at = ?
      WHERE agent_id = ?
    `).run(now, now, agentId);
  }

  /**
   * Update current task for agent
   * @param {string} agentId - Agent identifier
   * @param {string} taskId - Task identifier
   */
  static updateTask(agentId, taskId) {
    const db = StateDB.init();
    const now = Date.now();

    return StateDB.transaction(() => {
      db.prepare(`
        UPDATE agents
        SET current_task = ?, updated_at = ?
        WHERE agent_id = ?
      `).run(taskId, now, agentId);

      if (taskId) {
        db.prepare(`
          INSERT OR REPLACE INTO agent_metadata (agent_id, key, value, updated_at)
          VALUES (?, 'taskStarted', ?, ?)
        `).run(agentId, now.toString(), now);
      } else {
        db.prepare(`
          DELETE FROM agent_metadata
          WHERE agent_id = ? AND key = 'taskStarted'
        `).run(agentId);
      }
    });
  }

  /**
   * Get current state for agent
   * @param {string} agentId - Agent identifier
   * @returns {Object} Agent state with metadata
   */
  static getState(agentId) {
    const db = StateDB.init();

    const agent = db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId);
    if (!agent) return null;

    // Get metadata
    const metadataRows = db.prepare(`
      SELECT key, value FROM agent_metadata WHERE agent_id = ?
    `).all(agentId);

    const metadata = {};
    for (const row of metadataRows) {
      try {
        metadata[row.key] = JSON.parse(row.value);
      } catch {
        metadata[row.key] = row.value;
      }
    }

    return {
      agentId: agent.agent_id,
      state: agent.state,
      sessionName: agent.session_name,
      currentTask: agent.current_task,
      lastActivity: new Date(agent.last_activity).toISOString(),
      createdAt: new Date(agent.created_at).toISOString(),
      updatedAt: new Date(agent.updated_at).toISOString(),
      metadata
    };
  }

  /**
   * Get all agent states
   * @returns {Object} Map of agentId -> state
   */
  static getAllStates() {
    const db = StateDB.init();
    const agents = db.prepare('SELECT * FROM agents').all();

    const states = {};
    for (const agent of agents) {
      states[agent.agent_id] = StateManager.getState(agent.agent_id);
    }

    return states;
  }

  /**
   * Get agents by state
   * @param {string} state - State to filter by
   * @returns {Array} Array of agent states
   */
  static getAgentsByState(state) {
    const db = StateDB.init();
    const agents = db.prepare('SELECT agent_id FROM agents WHERE state = ?').all(state);

    return agents.map(a => StateManager.getState(a.agent_id));
  }

  /**
   * Get transition history for agent
   * @param {string} agentId - Agent identifier
   * @param {number} limit - Max transitions to return
   * @returns {Array} Transition history
   */
  static getTransitionHistory(agentId, limit = 20) {
    const db = StateDB.init();

    return db.prepare(`
      SELECT * FROM state_transitions
      WHERE agent_id = ?
      ORDER BY transitioned_at DESC
      LIMIT ?
    `).all(agentId, limit).map(t => ({
      from: t.from_state,
      to: t.to_state,
      metadata: t.metadata ? JSON.parse(t.metadata) : {},
      at: new Date(t.transitioned_at).toISOString()
    }));
  }

  /**
   * Validate state transition
   * @param {string} from - Current state
   * @param {string} to - Target state
   * @returns {boolean} Whether transition is valid
   */
  static isValidTransition(from, to) {
    // Can't transition from killed
    if (from === StateManager.STATES.KILLED) {
      return false;
    }

    // Can always transition to error
    if (to === StateManager.STATES.ERROR) {
      return true;
    }

    const validTransitions = {
      [StateManager.STATES.SPAWNED]: [StateManager.STATES.INITIALIZING, StateManager.STATES.KILLED],
      [StateManager.STATES.INITIALIZING]: [StateManager.STATES.READY, StateManager.STATES.ERROR, StateManager.STATES.KILLED],
      [StateManager.STATES.READY]: [StateManager.STATES.WORKING, StateManager.STATES.BLOCKED, StateManager.STATES.SUSPENDED, StateManager.STATES.KILLED],
      [StateManager.STATES.WORKING]: [StateManager.STATES.READY, StateManager.STATES.DISTRACTED, StateManager.STATES.COMPLETING, StateManager.STATES.BLOCKED, StateManager.STATES.KILLED],
      [StateManager.STATES.BLOCKED]: [StateManager.STATES.READY, StateManager.STATES.WORKING, StateManager.STATES.KILLED],
      [StateManager.STATES.DISTRACTED]: [StateManager.STATES.WORKING, StateManager.STATES.READY, StateManager.STATES.KILLED],
      [StateManager.STATES.COMPLETING]: [StateManager.STATES.READY, StateManager.STATES.KILLED],
      [StateManager.STATES.ERROR]: [StateManager.STATES.KILLED, StateManager.STATES.READY],
      [StateManager.STATES.SUSPENDED]: [StateManager.STATES.READY, StateManager.STATES.KILLED]
    };

    return validTransitions[from]?.includes(to) || false;
  }

  /**
   * Start monitoring agent activity
   * @param {string} agentId - Agent identifier
   */
  static startMonitoring(agentId) {
    if (StateManager.monitors.has(agentId)) {
      return; // Already monitoring
    }

    const interval = setInterval(() => {
      StateManager.checkAgentActivity(agentId);
    }, 2000); // Check every 2 seconds

    StateManager.monitors.set(agentId, interval);
  }

  /**
   * Stop monitoring agent activity
   * @param {string} agentId - Agent identifier
   */
  static stopMonitoring(agentId) {
    const interval = StateManager.monitors.get(agentId);
    if (interval) {
      clearInterval(interval);
      StateManager.monitors.delete(agentId);
    }
  }

  /**
   * Check agent activity and update state if needed
   * @param {string} agentId - Agent identifier
   */
  static checkAgentActivity(agentId) {
    const state = StateManager.getState(agentId);
    if (!state) return;

    // Only check working agents
    if (state.state !== StateManager.STATES.WORKING) {
      return;
    }

    const lastActivity = new Date(state.lastActivity).getTime();
    const now = Date.now();
    const inactiveDuration = now - lastActivity;

    // Check for distraction (>10s inactive while working)
    if (inactiveDuration > StateManager.DISTRACTION_THRESHOLD) {
      StateManager.transitionState(agentId, StateManager.STATES.DISTRACTED, {
        inactiveDuration,
        lastActivity: state.lastActivity
      });
    }
  }

  /**
   * Cleanup all monitoring intervals
   */
  static cleanup() {
    for (const [agentId, interval] of StateManager.monitors.entries()) {
      clearInterval(interval);
    }
    StateManager.monitors.clear();
  }

  /**
   * Delete agent state completely
   * @param {string} agentId - Agent identifier
   */
  static deleteAgent(agentId) {
    const db = StateDB.init();
    db.prepare('DELETE FROM agents WHERE agent_id = ?').run(agentId);
    StateManager.stopMonitoring(agentId);
  }
}

module.exports = { StateManager };
