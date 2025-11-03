const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');

/**
 * Directory initializer for centralized event log architecture
 *
 * Centralized structure:
 *   .ai/tx/
 *     msgs/                    (centralized event log for ALL agents)
 *     mesh/{mesh}/
 *       agents/{agent}/
 *         prompts/             (agent-specific prompts only)
 *         workspace/           (agent workspace)
 *
 * Messages are NO LONGER stored per-agent, but in centralized .ai/tx/msgs/
 */
class DirectoryInitializer {
  /**
   * Initialize directories for an agent
   * Only creates prompts/ and workspace/ directories - messages go to centralized log
   */
  static initializeAgentDirectories(mesh, agent) {
    const baseDir = `.ai/tx/mesh/${mesh}/agents/${agent}`;
    const promptsDir = path.join(baseDir, 'prompts');
    const workspaceDir = path.join(baseDir, 'workspace');

    try {
      // Create prompts directory
      fs.ensureDirSync(promptsDir);

      // Create workspace directory
      fs.ensureDirSync(workspaceDir);

      // Ensure centralized msgs directory exists
      fs.ensureDirSync('.ai/tx/msgs');

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
