const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('../logger');
const { PATHS, TX_ROOT } = require('../paths');

/**
 * List meshes, agents, and capabilities
 */
function list(type, options = {}) {
  try {
    switch (type) {
      case 'meshes':
        const meshOutput = listMeshes(options.prompt);
        if (options.prompt && meshOutput) {
          console.log(meshOutput);
        }
        return;

      case 'agents':
        const agentOutput = listAgents(options.prompt);
        if (options.prompt && agentOutput) {
          console.log(agentOutput);
        }
        return;

      case 'caps':
      case 'capabilities':
        const capOutput = listCapabilities(options.prompt);
        if (options.prompt && capOutput) {
          console.log(capOutput);
        }
        return;

      default:
        console.error(`❌ Unknown list type: ${type}`);
        console.error('   Valid types: meshes, agents, caps');
        process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Failed to list ${type}:`, error.message);
    Logger.error('list', `Failed to list ${type}: ${error.message}`, {
      error: error.stack
    });
    process.exit(1);
  }
}

/**
 * List all meshes with descriptions
 */
function listMeshes(promptMode = false) {
  const meshesDir = path.join(TX_ROOT, 'meshes/mesh-configs');

  if (!fs.existsSync(meshesDir)) {
    if (promptMode) return '';
    console.log('❌ No mesh configurations found');
    return;
  }

  const files = fs.readdirSync(meshesDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    if (promptMode) return '';
    console.log('📦 Meshes: None found');
    return;
  }

  const meshes = files
    .map(file => {
      const configPath = path.join(meshesDir, file);
      const config = fs.readJsonSync(configPath);
      return {
        name: config.mesh || file.replace('.json', ''),
        description: config.description || 'No description',
        type: config.type || 'unknown',
        agents: (config.agents || []).length
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (promptMode) {
    // Format for template injection - show ALL configured meshes
    return meshes
      .map(m => `- \`${m.name}\` - ${m.description}`)
      .join('\n');
  }

  // Format for CLI display
  console.log('\n📦 Meshes\n');
  meshes.forEach(m => {
    console.log(`  ${m.name}`);
    console.log(`    Description: ${m.description}`);
    console.log(`    Type: ${m.type}`);
    console.log(`    Agents: ${m.agents}`);
    console.log();
  });
}

/**
 * List all agents with descriptions
 */
function listAgents(promptMode = false) {
  const agentsDir = path.join(TX_ROOT, 'meshes/agents');

  if (!fs.existsSync(agentsDir)) {
    if (promptMode) return '';
    console.log('❌ No agents found');
    return;
  }

  const agents = [];

  // Walk through all meshes
  const meshDirs = fs.readdirSync(agentsDir).filter(f => {
    return fs.statSync(path.join(agentsDir, f)).isDirectory();
  });

  meshDirs.forEach(meshName => {
    const meshPath = path.join(agentsDir, meshName);
    const meshItems = fs.readdirSync(meshPath);

    meshItems.forEach(item => {
      const itemPath = path.join(meshPath, item);

      // Check if this is an agent directory (has config.json)
      if (fs.statSync(itemPath).isDirectory()) {
        const configPath = path.join(itemPath, 'config.json');
        if (fs.existsSync(configPath)) {
          const config = fs.readJsonSync(configPath);
          agents.push({
            mesh: meshName,
            name: item,
            description: config.description || 'No description',
            capabilities: (config.capabilities || []).length,
            orchestrator: config.orchestrator || false
          });
        }
      }
    });
  });

  // Sort by mesh, then agent name
  agents.sort((a, b) => {
    if (a.mesh !== b.mesh) return a.mesh.localeCompare(b.mesh);
    return a.name.localeCompare(b.name);
  });

  if (promptMode) {
    // Format for template injection
    return agents
      .map(a => `- \`${a.mesh}/${a.name}\` - ${a.description}${a.orchestrator ? ' [orchestrator]' : ''}`)
      .join('\n');
  }

  // Format for CLI display
  console.log('\n👤 Agents\n');
  agents.forEach(a => {
    console.log(`  ${a.mesh}/${a.name}`);
    console.log(`    Description: ${a.description}`);
    console.log(`    Capabilities: ${a.capabilities}`);
    if (a.orchestrator) {
      console.log(`    Role: Orchestrator`);
    }
    console.log();
  });
}

/**
 * List all capabilities with descriptions
 */
function listCapabilities(promptMode = false) {
  const capsDir = path.join(TX_ROOT, 'meshes/prompts/capabilities');

  if (!fs.existsSync(capsDir)) {
    if (promptMode) return '';
    console.log('❌ No capabilities found');
    return;
  }

  const capDirs = fs.readdirSync(capsDir).filter(f => {
    return fs.statSync(path.join(capsDir, f)).isDirectory();
  });

  const capabilities = capDirs
    .map(capName => {
      const capPath = path.join(capsDir, capName);
      const configPath = path.join(capPath, 'config.json');

      let templates = [];
      let description = '';

      // Read config if it exists
      if (fs.existsSync(configPath)) {
        const config = fs.readJsonSync(configPath);
        templates = config.templates || [];
        description = config.description || '';
      }

      // Get description from main md file if not in config
      if (!description) {
        const mainMdPath = path.join(capPath, `${capName}.md`);
        if (fs.existsSync(mainMdPath)) {
          const content = fs.readFileSync(mainMdPath, 'utf-8');
          // Extract first line or first paragraph
          const firstLine = content.split('\n')[0];
          description = firstLine.replace(/^#+\s+/, '').trim() || 'No description';
        }
      }

      return {
        name: capName,
        description: description || 'No description',
        templates: templates
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (promptMode) {
    // Format for template injection
    return capabilities
      .map(c => `- \`${c.name}\` - ${c.description}`)
      .join('\n');
  }

  // Format for CLI display
  console.log('\n🔧 Capabilities\n');
  capabilities.forEach(c => {
    console.log(`  ${c.name}`);
    console.log(`    Description: ${c.description}`);
    if (c.templates.length > 0) {
      console.log(`    Templates: ${c.templates.join(', ')}`);
    }
    console.log();
  });
}

/**
 * Generate mesh list for template injection (for txMeshList variable)
 */
function generateMeshListForTemplate() {
  return listMeshes(true);
}

module.exports = {
  list,
  listMeshes,
  listAgents,
  listCapabilities,
  generateMeshListForTemplate
};
