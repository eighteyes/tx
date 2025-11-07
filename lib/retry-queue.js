const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { TmuxInjector } = require('./tmux-injector');

/**
 * Persistent retry queue for failed message injections
 *
 * Handles:
 * - Session not available when message sent
 * - User actively typing (don't interrupt)
 * - Temporary injection failures
 * - Retries with exponential backoff
 */
class RetryQueue {
  static queueFile = '.ai/tx/state/retry-queue.json';
  static retryTimer = null;
  static running = false;

  // Configuration
  static config = {
    retryInterval: 10000,      // Check retry queue every 10 seconds
    maxAttempts: 20,           // Max 20 retry attempts (≈3 minutes total)
    initialBackoff: 5000,      // Wait 5 seconds before first retry
    maxBackoff: 30000,         // Max 30 seconds between retries
    userTypingThreshold: 3000, // Don't inject if user typed in last 3 seconds
  };

  /**
   * Add failed injection to retry queue
   * @param {string} session - Target session name
   * @param {string} filepath - Message file path
   * @param {boolean} isPrompt - Whether this is a prompt injection
   * @param {string} reason - Failure reason (for logging)
   * @param {object} metadata - Additional routing metadata
   */
  static enqueue(session, filepath, isPrompt, reason, metadata = {}) {
    try {
      const queue = RetryQueue.load();

      // Generate unique ID for this retry
      const retryId = `${session}-${path.basename(filepath)}-${Date.now()}`;

      // Calculate next retry time with initial backoff
      const nextRetry = Date.now() + RetryQueue.config.initialBackoff;

      queue[retryId] = {
        id: retryId,
        session,
        filepath,
        isPrompt,
        metadata, // Store from/to/type for logging
        attempts: 0,
        lastAttempt: null,
        reason,
        nextRetry,
        queuedAt: new Date().toISOString()
      };

      RetryQueue.save(queue);

      Logger.log('retry-queue', `Queued for retry: ${metadata.from || '?'} → ${session} (${reason})`, {
        retryId,
        filepath,
        nextRetry: new Date(nextRetry).toISOString()
      });

      return retryId;
    } catch (error) {
      Logger.error('retry-queue', `Failed to enqueue retry: ${error.message}`);
      return null;
    }
  }

  /**
   * Remove item from retry queue (successful delivery or max attempts)
   */
  static dequeue(retryId) {
    try {
      const queue = RetryQueue.load();

      if (queue[retryId]) {
        delete queue[retryId];
        RetryQueue.save(queue);
        Logger.log('retry-queue', `Removed from retry queue: ${retryId}`);
      }
    } catch (error) {
      Logger.error('retry-queue', `Failed to dequeue: ${error.message}`);
    }
  }

  /**
   * Load retry queue from disk
   */
  static load() {
    try {
      if (!fs.existsSync(RetryQueue.queueFile)) {
        return {};
      }

      return fs.readJsonSync(RetryQueue.queueFile);
    } catch (error) {
      Logger.error('retry-queue', `Failed to load retry queue: ${error.message}`);
      return {};
    }
  }

  /**
   * Save retry queue to disk
   */
  static save(queue) {
    try {
      fs.ensureDirSync(path.dirname(RetryQueue.queueFile));
      fs.writeJsonSync(RetryQueue.queueFile, queue, { spaces: 2 });
    } catch (error) {
      Logger.error('retry-queue', `Failed to save retry queue: ${error.message}`);
    }
  }

  /**
   * Process retry queue - attempt pending retries
   */
  static async processRetries() {
    try {
      const queue = RetryQueue.load();
      const now = Date.now();
      const retries = Object.values(queue);

      if (retries.length === 0) {
        return;
      }

      Logger.log('retry-queue', `Processing ${retries.length} pending retries`);

      for (const retry of retries) {
        // Skip if not ready for retry yet
        if (retry.nextRetry > now) {
          continue;
        }

        // Skip if max attempts reached
        if (retry.attempts >= RetryQueue.config.maxAttempts) {
          Logger.warn('retry-queue', `Max attempts reached, dropping: ${retry.id}`, {
            session: retry.session,
            filepath: retry.filepath,
            attempts: retry.attempts
          });
          RetryQueue.dequeue(retry.id);
          continue;
        }

        // Check if session exists
        if (!TmuxInjector.sessionExists(retry.session)) {
          Logger.log('retry-queue', `Session not ready, will retry: ${retry.session}`);
          RetryQueue.updateRetry(retry.id, 'session-not-found');
          continue;
        }

        // Check if user is actively typing
        if (await TmuxInjector.isUserTyping(retry.session, RetryQueue.config.userTypingThreshold)) {
          Logger.log('retry-queue', `User typing, postponing injection: ${retry.session}`);
          RetryQueue.updateRetry(retry.id, 'user-typing');
          continue;
        }

        // Attempt injection
        Logger.log('retry-queue', `Retrying injection [attempt ${retry.attempts + 1}]: ${retry.metadata.from || '?'} → ${retry.session}`);

        try {
          const success = TmuxInjector.injectFile(retry.session, retry.filepath, retry.isPrompt);

          if (success) {
            Logger.log('retry-queue', `Retry successful: ${retry.id}`);
            RetryQueue.dequeue(retry.id);

            // Record delivery (same as Queue.recordMessageDelivery)
            const { Queue } = require('./queue');
            Queue.recordMessageDelivery(retry.filepath, retry.metadata.to);
          } else {
            Logger.warn('retry-queue', `Retry failed: ${retry.id}`);
            RetryQueue.updateRetry(retry.id, 'injection-failed');
          }
        } catch (error) {
          Logger.error('retry-queue', `Retry error: ${error.message}`);
          RetryQueue.updateRetry(retry.id, `error: ${error.message}`);
        }
      }
    } catch (error) {
      Logger.error('retry-queue', `Error processing retries: ${error.message}`);
    }
  }

  /**
   * Update retry with new attempt and backoff
   */
  static updateRetry(retryId, reason) {
    try {
      const queue = RetryQueue.load();
      const retry = queue[retryId];

      if (!retry) {
        return;
      }

      retry.attempts++;
      retry.lastAttempt = new Date().toISOString();
      retry.reason = reason;

      // Calculate exponential backoff: 5s, 10s, 20s, 30s (max)
      const backoff = Math.min(
        RetryQueue.config.initialBackoff * Math.pow(2, retry.attempts - 1),
        RetryQueue.config.maxBackoff
      );

      retry.nextRetry = Date.now() + backoff;

      RetryQueue.save(queue);

      Logger.log('retry-queue', `Updated retry [${retry.attempts}/${RetryQueue.config.maxAttempts}]: ${retryId}`, {
        nextRetry: new Date(retry.nextRetry).toISOString(),
        reason
      });
    } catch (error) {
      Logger.error('retry-queue', `Failed to update retry: ${error.message}`);
    }
  }

  /**
   * Start retry processor (periodic check)
   */
  static start() {
    if (RetryQueue.running) {
      return;
    }

    Logger.log('retry-queue', 'Starting retry queue processor');

    RetryQueue.running = true;

    // Process immediately on start
    RetryQueue.processRetries();

    // Then process periodically
    RetryQueue.retryTimer = setInterval(() => {
      RetryQueue.processRetries();
    }, RetryQueue.config.retryInterval);
  }

  /**
   * Stop retry processor
   */
  static stop() {
    if (!RetryQueue.running) {
      return;
    }

    Logger.log('retry-queue', 'Stopping retry queue processor');

    if (RetryQueue.retryTimer) {
      clearInterval(RetryQueue.retryTimer);
      RetryQueue.retryTimer = null;
    }

    RetryQueue.running = false;
  }

  /**
   * Get queue status (for stats/health commands)
   */
  static getStatus() {
    try {
      const queue = RetryQueue.load();
      const retries = Object.values(queue);

      return {
        total: retries.length,
        bySession: retries.reduce((acc, r) => {
          acc[r.session] = (acc[r.session] || 0) + 1;
          return acc;
        }, {}),
        oldestRetry: retries.length > 0
          ? Math.min(...retries.map(r => new Date(r.queuedAt).getTime()))
          : null
      };
    } catch (error) {
      Logger.error('retry-queue', `Failed to get status: ${error.message}`);
      return { total: 0, bySession: {}, oldestRetry: null };
    }
  }
}

module.exports = { RetryQueue };
