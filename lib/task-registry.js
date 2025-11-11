/**
 * TaskRegistry - SQLite-backed task tracking
 *
 * Provides centralized task management with priority queues,
 * orphan detection, and lifecycle tracking.
 */

const StateDB = require('./state-db');
const { Logger } = require('./logger');

class TaskRegistry {
  static PRIORITIES = {
    CRITICAL: 'critical',
    HIGH: 'high',
    NORMAL: 'normal',
    LOW: 'low'
  };

  static STATUSES = {
    PENDING: 'pending',
    ASSIGNED: 'assigned',
    IN_PROGRESS: 'in-progress',
    COMPLETED: 'completed',
    FAILED: 'failed'
  };

  /**
   * Register a new task
   * @param {string} taskId - Unique task identifier
   * @param {Object} options - Task options
   * @returns {Object} Created task
   */
  static register(taskId, options = {}) {
    const {
      createdBy,
      summary,
      priority = TaskRegistry.PRIORITIES.NORMAL,
      metadata = {}
    } = options;

    if (!createdBy || !summary) {
      throw new Error('createdBy and summary are required');
    }

    const db = StateDB.init();
    const now = Date.now();

    db.prepare(`
      INSERT INTO tasks (
        task_id, created_by, summary, priority, status,
        created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      createdBy,
      summary,
      priority,
      TaskRegistry.STATUSES.PENDING,
      now,
      JSON.stringify(metadata)
    );

    Logger.log('task-registry', `Registered task ${taskId}`, { priority, createdBy });

    return TaskRegistry.getTask(taskId);
  }

  /**
   * Assign task to agent
   * @param {string} taskId - Task identifier
   * @param {string} agentId - Agent identifier
   */
  static assign(taskId, agentId) {
    const db = StateDB.init();
    const now = Date.now();

    return StateDB.transaction(() => {
      db.prepare(`
        UPDATE tasks
        SET assigned_to = ?, assigned_at = ?, status = ?
        WHERE task_id = ?
      `).run(agentId, now, TaskRegistry.STATUSES.ASSIGNED, taskId);

      Logger.log('task-registry', `Assigned task ${taskId} to ${agentId}`);
    });
  }

  /**
   * Mark task as started
   * @param {string} taskId - Task identifier
   */
  static start(taskId) {
    const db = StateDB.init();
    const now = Date.now();

    db.prepare(`
      UPDATE tasks
      SET status = ?, started_at = ?
      WHERE task_id = ?
    `).run(TaskRegistry.STATUSES.IN_PROGRESS, now, taskId);

    Logger.log('task-registry', `Started task ${taskId}`);
  }

  /**
   * Mark task as completed
   * @param {string} taskId - Task identifier
   * @param {Object} result - Completion result/metadata
   */
  static complete(taskId, result = {}) {
    const db = StateDB.init();
    const now = Date.now();

    return StateDB.transaction(() => {
      const task = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);

      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      // Update task
      db.prepare(`
        UPDATE tasks
        SET status = ?, completed_at = ?, metadata = ?
        WHERE task_id = ?
      `).run(
        TaskRegistry.STATUSES.COMPLETED,
        now,
        JSON.stringify({ ...JSON.parse(task.metadata || '{}'), result }),
        taskId
      );

      // Clear from agent
      if (task.assigned_to) {
        const { StateManager } = require('./state-manager');
        StateManager.updateTask(task.assigned_to, null);
      }

      Logger.log('task-registry', `Completed task ${taskId}`);
    });
  }

  /**
   * Mark task as failed
   * @param {string} taskId - Task identifier
   * @param {Object} error - Error information
   */
  static fail(taskId, error = {}) {
    const db = StateDB.init();
    const now = Date.now();

    return StateDB.transaction(() => {
      const task = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);

      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      db.prepare(`
        UPDATE tasks
        SET status = ?, metadata = ?
        WHERE task_id = ?
      `).run(
        TaskRegistry.STATUSES.FAILED,
        JSON.stringify({ ...JSON.parse(task.metadata || '{}'), error, failedAt: now }),
        taskId
      );

      // Clear from agent
      if (task.assigned_to) {
        const { StateManager } = require('./state-manager');
        StateManager.updateTask(task.assigned_to, null);
      }

      Logger.error('task-registry', `Failed task ${taskId}`, error);
    });
  }

  /**
   * Get task by ID
   * @param {string} taskId - Task identifier
   * @returns {Object} Task object
   */
  static getTask(taskId) {
    const db = StateDB.init();
    const task = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);

    if (!task) return null;

    return {
      taskId: task.task_id,
      assignedTo: task.assigned_to,
      createdBy: task.created_by,
      summary: task.summary,
      priority: task.priority,
      status: task.status,
      createdAt: new Date(task.created_at).toISOString(),
      assignedAt: task.assigned_at ? new Date(task.assigned_at).toISOString() : null,
      startedAt: task.started_at ? new Date(task.started_at).toISOString() : null,
      completedAt: task.completed_at ? new Date(task.completed_at).toISOString() : null,
      metadata: task.metadata ? JSON.parse(task.metadata) : {}
    };
  }

  /**
   * Get pending tasks ordered by priority
   * @param {number} limit - Max tasks to return
   * @returns {Array} Array of pending tasks
   */
  static getPending(limit = 50) {
    const db = StateDB.init();

    const tasks = db.prepare(`
      SELECT * FROM tasks
      WHERE status = ?
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        created_at ASC
      LIMIT ?
    `).all(TaskRegistry.STATUSES.PENDING, limit);

    return tasks.map(t => TaskRegistry.getTask(t.task_id));
  }

  /**
   * Get tasks assigned to agent
   * @param {string} agentId - Agent identifier
   * @returns {Array} Array of tasks
   */
  static getTasksForAgent(agentId) {
    const db = StateDB.init();

    const tasks = db.prepare(`
      SELECT * FROM tasks
      WHERE assigned_to = ?
      AND status IN (?, ?)
      ORDER BY created_at DESC
    `).all(agentId, TaskRegistry.STATUSES.ASSIGNED, TaskRegistry.STATUSES.IN_PROGRESS);

    return tasks.map(t => TaskRegistry.getTask(t.task_id));
  }

  /**
   * Find orphaned tasks (assigned to dead/error agents)
   * @returns {Array} Array of orphaned tasks
   */
  static findOrphanedTasks() {
    const db = StateDB.init();

    const orphaned = db.prepare(`
      SELECT t.* FROM tasks t
      LEFT JOIN agents a ON t.assigned_to = a.agent_id
      WHERE t.status IN (?, ?)
        AND (a.agent_id IS NULL OR a.state IN ('killed', 'error'))
    `).all(TaskRegistry.STATUSES.ASSIGNED, TaskRegistry.STATUSES.IN_PROGRESS);

    return orphaned.map(t => TaskRegistry.getTask(t.task_id));
  }

  /**
   * Reassign orphaned task
   * @param {string} taskId - Task identifier
   * @param {string} newAgentId - New agent identifier (optional)
   */
  static reassignOrphanedTask(taskId, newAgentId = null) {
    const db = StateDB.init();

    return StateDB.transaction(() => {
      if (newAgentId) {
        // Reassign to specific agent
        TaskRegistry.assign(taskId, newAgentId);
        Logger.log('task-registry', `Reassigned orphaned task ${taskId} to ${newAgentId}`);
      } else {
        // Reset to pending
        db.prepare(`
          UPDATE tasks
          SET assigned_to = NULL, assigned_at = NULL, status = ?
          WHERE task_id = ?
        `).run(TaskRegistry.STATUSES.PENDING, taskId);

        Logger.log('task-registry', `Reset orphaned task ${taskId} to pending`);
      }
    });
  }

  /**
   * Get task statistics
   * @returns {Object} Task statistics
   */
  static getStats() {
    const db = StateDB.init();

    const total = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;

    const byStatus = {};
    for (const status of Object.values(TaskRegistry.STATUSES)) {
      byStatus[status] = db.prepare(
        'SELECT COUNT(*) as count FROM tasks WHERE status = ?'
      ).get(status).count;
    }

    const byPriority = {};
    for (const priority of Object.values(TaskRegistry.PRIORITIES)) {
      byPriority[priority] = db.prepare(
        'SELECT COUNT(*) as count FROM tasks WHERE priority = ?'
      ).get(priority).count;
    }

    return {
      total,
      byStatus,
      byPriority,
      orphaned: TaskRegistry.findOrphanedTasks().length
    };
  }

  /**
   * Clean up old completed/failed tasks
   * @param {number} olderThanDays - Delete tasks older than X days
   * @returns {number} Number of tasks deleted
   */
  static cleanup(olderThanDays = 7) {
    const db = StateDB.init();
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    const result = db.prepare(`
      DELETE FROM tasks
      WHERE status IN (?, ?)
        AND completed_at < ?
    `).run(TaskRegistry.STATUSES.COMPLETED, TaskRegistry.STATUSES.FAILED, cutoff);

    Logger.log('task-registry', `Cleaned up ${result.changes} old tasks`);

    return result.changes;
  }
}

module.exports = TaskRegistry;
