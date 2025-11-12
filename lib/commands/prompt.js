const { PromptBuilder } = require('../prompt-builder');
const { ConfigLoader } = require('../config-loader');

function prompt(mesh, agent = null) {
  try {
    const agentName = agent || mesh;

    // Generate a realistic mesh instance ID for accurate debugging
    // Use format: mesh-xxxxxx (6 char hex like real spawns)
    const isPersistent = ConfigLoader.isPersistent(mesh);
    let meshInstance = mesh;

    if (mesh !== 'core' && !isPersistent) {
      // Generate a sample instance ID for non-persistent meshes
      const sampleId = require('crypto').randomBytes(3).toString('hex');
      meshInstance = `${mesh}-${sampleId}`;
    }

    const builtPrompt = PromptBuilder.build(mesh, meshInstance, agentName, null);

    console.log('━'.repeat(80));
    console.log(`PROMPT: ${meshInstance}/${agentName}`);
    console.log('━'.repeat(80));
    console.log();
    console.log(builtPrompt);
    console.log();
    console.log('━'.repeat(80));
  } catch (error) {
    console.error('❌ Failed to generate prompt:', error.message);
    process.exit(1);
  }
}

module.exports = { prompt };
