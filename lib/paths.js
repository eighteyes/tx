const path = require('path');

/**
 * Get TX package root directory
 * Works for both local and global npm installs
 *
 * IMPORTANT: All mesh-related paths MUST use TX_ROOT to ensure they resolve
 * to the package directory, not process.cwd(). This is critical for global
 * npm installs where process.cwd() is the user's working directory.
 */
function getTxRoot() {
  // From lib/paths.js, go up one level to package root
  return path.resolve(__dirname, '..');
}

// Export commonly used paths
const TX_ROOT = getTxRoot();

const PATHS = {
  ROOT: TX_ROOT,
  MESHES: path.join(TX_ROOT, 'meshes'),
  MESH_CONFIGS: path.join(TX_ROOT, 'meshes/mesh-configs'),
  MESH_AGENTS: path.join(TX_ROOT, 'meshes/agents'),
  PROMPTS: path.join(TX_ROOT, 'meshes/prompts'),
  PROMPT_TEMPLATES: path.join(TX_ROOT, 'meshes/prompts/templates'),
  PROMPT_CAPABILITIES: path.join(TX_ROOT, 'meshes/prompts/capabilities'),

  // Helper functions
  meshConfig: (meshName) => path.join(TX_ROOT, 'meshes/mesh-configs', `${meshName}.json`),
  agentDir: (agentPath) => path.join(TX_ROOT, 'meshes/agents', agentPath),
  agentConfig: (agentPath) => path.join(TX_ROOT, 'meshes/agents', agentPath, 'config.json'),
  promptTemplate: (templateName) => path.join(TX_ROOT, 'meshes/prompts/templates', `${templateName}.md`),
  capability: (capName) => path.join(TX_ROOT, 'meshes/prompts/capabilities', capName)
};

module.exports = { PATHS, TX_ROOT };
