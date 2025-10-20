const fs = require('fs-extra');
const { Logger } = require('./logger');

/**
 * Directory Initializer - Ensures all required message queues exist
 * Implements filepaths.md specification for mesh/agent communication
 */
class DirectoryInitializer {
  // Standard queue subdirectories
  static QUEUE_DIRS = ['inbox', 'next', 'active', 'complete', 'archive'];

  /**
   * Create queue directories for a given base path
   * @private
   */
  static _createQueueDirs(baseDir, logContext) {
    try {
      DirectoryInitializer.QUEUE_DIRS.forEach(dir => {
        fs.ensureDirSync(`${baseDir}/${dir}`);
      });
      return true;
    } catch (error) {
      Logger.error('directory-initializer', `Failed to create queue directories: ${error.message}`, logContext);
      return false;
    }
  }

  /**
   * Initialize mesh-level message directories
   * Creates: inbox, next, active, complete, archive
   */
  static initializeMeshDirectories(mesh) {
    const baseDir = `.ai/tx/mesh/${mesh}/msgs`;
    const success = DirectoryInitializer._createQueueDirs(baseDir, { mesh });

    if (success) {
      Logger.log('directory-initializer', 'Mesh directories initialized', { mesh });
    }
    return success;
  }

  /**
   * Initialize agent-level message directories
   * Creates: inbox, next, active, complete, archive
   */
  static initializeAgentDirectories(mesh, agent) {
    const baseDir = `.ai/tx/mesh/${mesh}/agents/${agent}/msgs`;
    const success = DirectoryInitializer._createQueueDirs(baseDir, { mesh, agent });

    if (success) {
      Logger.log('directory-initializer', 'Agent directories initialized', { mesh, agent });
    }
    return success;
  }

  /**
   * Initialize both mesh and agent directories
   */
  static initializeAll(mesh, agent) {
    const meshSuccess = DirectoryInitializer.initializeMeshDirectories(mesh);
    const agentSuccess = DirectoryInitializer.initializeAgentDirectories(mesh, agent);
    return meshSuccess && agentSuccess;
  }
}

module.exports = { DirectoryInitializer };
