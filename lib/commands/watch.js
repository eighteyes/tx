const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');
const { FileWatcherManager } = require('../file-watcher-manager');
const { Logger } = require('../logger');
const { Message } = require('../message');
const { Watcher } = require('../watcher');
const { spawn } = require('./spawn');
const { TmuxInjector } = require('../tmux-injector');
const { PATHS, TX_ROOT } = require('../paths');

/**
 * Safe console.log that handles EPIPE errors
 */
function safeConsoleLog(...args) {
  try {
    console.log(...args);
  } catch (error) {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
      // Silently ignore
    } else {
      throw error;
    }
  }
}

/**
 * Watch a file for changes and process through a mesh
 *
 * @param {string} filePath - File to watch
 * @param {string} meshName - Mesh to process changes
 * @param {object} options - Options
 * @param {boolean} options.detach - Run in background
 */
async function watch(filePath, meshName, options = {}) {
  try {
    // Resolve file path
    const absolutePath = path.resolve(filePath);

    if (!options.detach) {
      safeConsoleLog(`👁️  Starting watcher for ${absolutePath}`);
      safeConsoleLog(`   Mesh: ${meshName}`);
      safeConsoleLog(`   Debounce: 1s\n`);
    }

    // Validate mesh exists
    const meshConfigPath = path.join(TX_ROOT, 'meshes/mesh-configs', `${meshName}.json`);
    if (!fs.existsSync(meshConfigPath)) {
      console.error(`❌ Mesh not found: ${meshName}`);
      console.error(`   Expected config at: ${meshConfigPath}\n`);
      Logger.error('watch', 'Mesh not found', { meshName, meshConfigPath });
      process.exit(1);
    }

    // Load mesh config to find which agent should handle the watch messages
    const meshConfig = fs.readJsonSync(meshConfigPath);
    let coordinatorAgent = meshName; // Default to mesh name

    // If mesh has multiple agents, look for a coordinator or use first agent
    if (meshConfig.agents && meshConfig.agents.length > 0) {
      // Find coordinator agent (or use first agent as default)
      const coordAgent = meshConfig.agents.find(a => {
        const agentName = a.includes('/') ? a.split('/').pop() : a;
        return agentName === 'coordinator' || agentName === meshName;
      });

      if (coordAgent) {
        coordinatorAgent = coordAgent.includes('/') ? coordAgent.split('/').pop() : coordAgent;
      } else {
        // Use first agent
        coordinatorAgent = meshConfig.agents[0].includes('/')
          ? meshConfig.agents[0].split('/').pop()
          : meshConfig.agents[0];
      }
    }

    if (!options.detach) {
      safeConsoleLog(`📋 Coordinator agent: ${coordinatorAgent}\n`);
    }

    // Check if mesh is already spawned
    const sessions = TmuxInjector.listSessions();
    const meshPattern = new RegExp(`^${meshName}(-[a-f0-9]+)?-${coordinatorAgent}$`);
    const existingSession = sessions.find(s => meshPattern.test(s));

    let meshInstance = meshName;

    if (!existingSession) {
      if (!options.detach) {
        safeConsoleLog(`🚀 Spawning mesh ${meshName}...\n`);
      }

      // Spawn the mesh (this will handle creating the mesh instance)
      await spawn(meshName, null, { detach: true });

      // Find the spawned session
      const newSessions = TmuxInjector.listSessions();
      const spawnedSession = newSessions.find(s => meshPattern.test(s));

      if (spawnedSession) {
        // Extract mesh instance from session name: mesh-uuid-agent
        const parts = spawnedSession.split('-');
        if (parts.length >= 2) {
          // Reconstruct mesh instance (everything except the last part which is the agent)
          meshInstance = parts.slice(0, -1).join('-');
        }
      }

      if (!options.detach) {
        safeConsoleLog(`✅ Mesh spawned: ${meshInstance}\n`);
      }
    } else {
      // Extract mesh instance from existing session
      const parts = existingSession.split('-');
      if (parts.length >= 2) {
        meshInstance = parts.slice(0, -1).join('-');
      }

      if (!options.detach) {
        safeConsoleLog(`✅ Using existing mesh: ${meshInstance}\n`);
      }
    }

    // Create file watcher manager
    const watcher = new FileWatcherManager(absolutePath, meshInstance);

    // Setup event handlers
    watcher.on('delta', async (delta) => {
      try {
        if (!options.detach) {
          safeConsoleLog(`📨 New content detected (${delta.newLines.length} lines)`);
        }

        Logger.log('watch', 'Delta detected', {
          meshInstance,
          fromLine: delta.fromLine,
          toLine: delta.toLine,
          newLines: delta.newLines.length
        });

        // Create message in mesh inbox
        await createDeltaMessage(meshInstance, coordinatorAgent, delta, filePath);

        if (!options.detach) {
          safeConsoleLog(`✅ Message sent to ${meshInstance}/${coordinatorAgent}\n`);
        }

      } catch (error) {
        Logger.error('watch', `Error handling delta: ${error.message}`);
        if (!options.detach) {
          safeConsoleLog(`❌ Error: ${error.message}\n`);
        }
      }
    });

    watcher.on('processing-complete', () => {
      if (!options.detach) {
        safeConsoleLog(`✅ Processing complete, watching for next change...\n`);
      }
    });

    watcher.on('error', (error) => {
      Logger.error('watch', `Watcher error: ${error.message}`);
      if (!options.detach) {
        safeConsoleLog(`❌ Watcher error: ${error.message}\n`);
      }
    });

    watcher.on('ready', () => {
      if (!options.detach) {
        safeConsoleLog(`👁️  Watching ${absolutePath}...\n`);
        safeConsoleLog(`   Press Ctrl+C to stop\n`);
      }
      Logger.log('watch', 'Watcher ready', { meshInstance, filePath: absolutePath });
    });

    // Watch for completion messages from the mesh
    setupCompletionWatcher(meshInstance, coordinatorAgent, watcher, options.detach);

    // Start watching
    await watcher.start();

    // Handle shutdown
    const shutdown = async () => {
      if (!options.detach) {
        safeConsoleLog(`\n🛑 Stopping watcher...`);
      }
      await watcher.stop();
      if (!options.detach) {
        safeConsoleLog(`✅ Watcher stopped\n`);
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // If detached, return immediately
    if (options.detach) {
      Logger.log('watch', 'Watcher started in detached mode', { meshInstance, filePath: absolutePath });
      return;
    }

    // Keep process alive in attached mode
    await new Promise(() => {}); // Never resolves, keeps process alive

  } catch (error) {
    console.error('❌ Failed to start watch:', error.message);
    Logger.error('watch', `Failed to start watch: ${error.message}`, {
      filePath,
      meshName,
      error: error.stack
    });
    process.exit(1);
  }
}

/**
 * Create a delta message in the mesh inbox
 */
async function createDeltaMessage(meshInstance, agent, delta, originalFile) {
  const msgsDir = `.ai/tx/mesh/${meshInstance}/agents/${agent}/msgs`;
  await fs.ensureDir(msgsDir);

  // Generate unique message filename
  const timestamp = Date.now();
  const messageFile = path.join(msgsDir, `watch-delta-${timestamp}.md`);

  // Format delta content
  let content = `New content detected in \`${path.basename(originalFile)}\`:\n\n`;
  content += `Lines ${delta.fromLine} → ${delta.toLine}:\n\n`;
  content += '```\n';
  content += delta.content;
  content += '\n```\n';

  // Create message with metadata
  const message = `---
from: watcher
to: ${meshInstance}/${agent}
type: delta
file: ${originalFile}
fromLine: ${delta.fromLine}
toLine: ${delta.toLine}
---

${content}
`;

  // Write message
  await fs.writeFile(messageFile, message);

  Logger.log('watch', 'Delta message created', {
    meshInstance,
    agent,
    messageFile,
    fromLine: delta.fromLine,
    toLine: delta.toLine
  });
}

/**
 * Setup watcher for completion messages from the mesh
 */
function setupCompletionWatcher(meshInstance, agent, fileWatcher, isDetached) {
  const outboxDir = `.ai/tx/mesh/${meshInstance}/agents/${agent}/msgs`;

  // Watch for new messages in the agent's msgs directory
  const outboxWatcher = chokidar.watch(outboxDir, {
    ignored: [
      /[^/]*-done\.md$/,  // Ignore completed messages
      /[^/]*-orphan\.md$/, // Ignore orphaned messages
      /[^/]*watch-delta.*\.md$/ // Ignore our own delta messages
    ],
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50
    }
  });

  outboxWatcher.on('add', async (filepath) => {
    try {
      // Only process .md files that aren't delta messages
      if (!filepath.endsWith('.md') || filepath.includes('watch-delta')) {
        return;
      }

      Logger.log('watch', 'Completion message detected', { filepath });

      // Parse message
      const message = Message.parseMessage(filepath);
      if (!message) {
        return;
      }

      // Check if this is a completion message (from agent back to watcher or core)
      const { type, to } = message.metadata;

      if (type === 'completion' || type === 'task-complete') {
        if (!isDetached) {
          safeConsoleLog(`✅ ${message.content.trim()}\n`);
        }

        Logger.log('watch', 'Processing completion', {
          type,
          to,
          content: message.content.substring(0, 100)
        });

        // Read file to get current line count
        const watchedFile = fileWatcher.filePath;
        if (await fs.pathExists(watchedFile)) {
          const content = await fs.readFile(watchedFile, 'utf-8');
          const lines = content.split('\n');
          const lineCount = lines.length > 0 && lines[lines.length - 1] === ''
            ? lines.length - 1
            : lines.length;

          // Update watcher state
          await fileWatcher.updateState(lineCount);
        }
      }

    } catch (error) {
      Logger.error('watch', `Error processing completion: ${error.message}`);
    }
  });

  // Cleanup on process exit
  process.on('exit', () => {
    outboxWatcher.close();
  });
}

module.exports = { watch };
