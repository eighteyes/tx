const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');

/**
 * Simplified directory initializer
 * Creates single msgs/ folder instead of 7 subdirectories
 *
 * Old structure:
 *   msgs/
 *     inbox/
 *     next/
 *     active/
 *     outbox/
 *     complete/
 *     archive/
 *     orphans/
 *
 * New structure:
 *   msgs/
 *     (all files here)
 */
class DirectoryInitializer {
  /**
   * Initialize directories for an agent
   */
  static initializeAgentDirectories(mesh, agent) {
    const baseDir = `.ai/tx/mesh/${mesh}/agents/${agent}`;
    const msgsDir = path.join(baseDir, 'msgs');
    const promptsDir = path.join(baseDir, 'prompts');

    try {
      // Create msgs directory (single folder)
      fs.ensureDirSync(msgsDir);

      // Create prompts directory
      fs.ensureDirSync(promptsDir);

      Logger.log('directory-init', `Initialized directories for ${mesh}/${agent}`);

      return true;
    } catch (error) {
      Logger.error('directory-init', `Failed to initialize directories for ${mesh}/${agent}: ${error.message}`);
      return false;
    }
  }

  /**
   * Initialize directories for a mesh
   */
  static initializeMeshDirectories(mesh) {
    const baseDir = `.ai/tx/mesh/${mesh}`;
    const msgsDir = path.join(baseDir, 'msgs');

    try {
      // Create mesh msgs directory (single folder)
      fs.ensureDirSync(msgsDir);

      // Create agents directory
      fs.ensureDirSync(path.join(baseDir, 'agents'));

      Logger.log('directory-init', `Initialized directories for mesh ${mesh}`);

      return true;
    } catch (error) {
      Logger.error('directory-init', `Failed to initialize directories for mesh ${mesh}: ${error.message}`);
      return false;
    }
  }

  /**
   * Clean up orphaned messages (messages left from previous runs)
   * In simplified queue, just checks msgs/ folder
   */
  static cleanupOrphanedMessages(mesh, agent) {
    const msgsDir = `.ai/tx/mesh/${mesh}/agents/${agent}/msgs`;

    try {
      if (!fs.existsSync(msgsDir)) {
        return 0;
      }

      // In simplified system, we don't auto-delete anything
      // Messages stay until explicitly marked as done (*-done.md)
      // Just return 0 (no cleanup needed)

      return 0;

    } catch (error) {
      Logger.error('directory-init', `Failed to cleanup orphaned messages: ${error.message}`);
      return 0;
    }
  }
}

module.exports = { DirectoryInitializer };
