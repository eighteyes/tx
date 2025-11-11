/**
 * StateDB - SQLite database wrapper for TX state management
 *
 * Provides ACID transactions, eliminates race conditions, and serves as
 * the single source of truth for all state management.
 */

const Database = require('better-sqlite3');
const fs = require('fs-extra');
const path = require('path');

class StateDB {
  static instance = null;

  /**
   * Initialize or get existing database instance
   * @param {string} dbPath - Path to SQLite database file
   * @returns {Database} SQLite database instance
   */
  static init(dbPath = '.ai/tx/state.db') {
    if (!StateDB.instance) {
      // Ensure directory exists
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Open database
      StateDB.instance = new Database(dbPath);

      // Enable WAL mode for better concurrency
      StateDB.instance.pragma('journal_mode = WAL');
      StateDB.instance.pragma('foreign_keys = ON');

      // Initialize schema
      StateDB.createSchema();
    }

    return StateDB.instance;
  }

  /**
   * Create database schema
   */
  static createSchema() {
    const db = StateDB.instance;

    // Agent lifecycle state
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK(state IN (
          'spawned', 'initializing', 'ready', 'working',
          'blocked', 'distracted', 'completing', 'error',
          'suspended', 'killed'
        )),
        session_name TEXT NOT NULL,
        current_task TEXT,
        last_activity INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Full transition history
    db.exec(`
      CREATE TABLE IF NOT EXISTS state_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        metadata TEXT,
        transitioned_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
      )
    `);

    // Flexible agent metadata
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_metadata (
        agent_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, key),
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
      )
    `);

    // Task registry
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        assigned_to TEXT,
        created_by TEXT NOT NULL,
        summary TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('critical', 'high', 'normal', 'low')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'assigned', 'in-progress', 'completed', 'failed')),
        created_at INTEGER NOT NULL,
        assigned_at INTEGER,
        started_at INTEGER,
        completed_at INTEGER,
        metadata TEXT,
        FOREIGN KEY (assigned_to) REFERENCES agents(agent_id) ON DELETE SET NULL
      )
    `);

    // Mesh-level state
    db.exec(`
      CREATE TABLE IF NOT EXISTS mesh_states (
        mesh_name TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        workflow TEXT,
        workflow_position INTEGER DEFAULT 0,
        tasks_completed INTEGER DEFAULT 0,
        current_agent TEXT,
        previous_agent TEXT,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    // Message delivery queue
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filepath TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        from_agent TEXT,
        msg_type TEXT,
        msg_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'failed')),
        error TEXT,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create indexes for performance
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agents_state ON agents(state);
      CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at);
      CREATE INDEX IF NOT EXISTS idx_transitions_agent ON state_transitions(agent_id, transitioned_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_message_queue_status ON message_queue(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_message_queue_agent ON message_queue(to_agent, status);
    `);
  }

  /**
   * Execute a transaction
   * @param {Function} fn - Function that performs database operations
   * @returns {*} Result of the transaction
   */
  static transaction(fn) {
    const db = StateDB.init();
    const txn = db.transaction(fn);
    return txn();
  }

  /**
   * Close database connection
   */
  static close() {
    if (StateDB.instance) {
      StateDB.instance.close();
      StateDB.instance = null;
    }
  }

  /**
   * Get database health info
   * @returns {Object} Database statistics
   */
  static getHealth() {
    const db = StateDB.init();

    const agentCount = db.prepare('SELECT COUNT(*) as count FROM agents').get().count;
    const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
    const transitionCount = db.prepare('SELECT COUNT(*) as count FROM state_transitions').get().count;

    return {
      agentCount,
      taskCount,
      transitionCount,
      dbSize: fs.statSync('.ai/tx/state.db').size,
      isOpen: StateDB.instance !== null
    };
  }
}

module.exports = StateDB;
