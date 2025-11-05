const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { AtomicState } = require('./atomic-state');
const { generateMeshListForTemplate } = require('./commands/list');
const { PATHS, TX_ROOT } = require('./paths');

class PromptBuilder {
  /**
   * Build complete agent prompt from components
   * Assembles: preamble + agent prompt + task + capabilities + workflow
   * @param {string} mesh - Base mesh name (for config lookup)
   * @param {string} meshInstance - Mesh instance ID (mesh-uuid for runtime paths)
   * @param {string} agent - Agent name
   * @param {string} [task] - Optional task to inject (from spawn --init)
   */
  static build(mesh, meshInstance, agent, task = null) {
    try {
      // Handle agent names that may include mesh prefix (e.g. "core/core" or just "core")
      const agentName = agent || mesh;

      // Determine agent directory by looking up mesh config for category/agent format
      let agentDir;
      if (agentName.includes('/')) {
        // Already includes category prefix (e.g., "test/echo")
        agentDir = path.join(TX_ROOT, 'meshes/agents', agentName);
      } else {
        // Look up from mesh config to find full path
        const meshConfigPath = path.join(TX_ROOT, 'meshes/mesh-configs', `${mesh}.json`);
        if (fs.existsSync(meshConfigPath)) {
          const meshConfig = fs.readJsonSync(meshConfigPath);
          if (meshConfig.agents) {
            const fullAgentPath = meshConfig.agents.find(a => {
              const agentPart = a.includes('/') ? a.split('/').pop() : a;
              return agentPart === agentName;
            });
            if (fullAgentPath) {
              agentDir = path.join(TX_ROOT, 'meshes/agents', fullAgentPath);
            } else {
              // Fallback to old logic
              agentDir = mesh === agentName ? path.join(TX_ROOT, 'meshes/agents', mesh) : path.join(TX_ROOT, 'meshes/agents', mesh, agentName);
            }
          } else {
            // Fallback to old logic
            agentDir = mesh === agentName ? path.join(TX_ROOT, 'meshes/agents', mesh) : path.join(TX_ROOT, 'meshes/agents', mesh, agentName);
          }
        } else {
          // Fallback to old logic
          agentDir = mesh === agentName ? path.join(TX_ROOT, 'meshes/agents', mesh) : path.join(TX_ROOT, 'meshes/agents', mesh, agentName);
        }
      }

      // 1. Preamble
      let preamble = PromptBuilder._getPreamble(meshInstance, agent || mesh);

      // 2. Agent Prompt
      let agentPrompt = PromptBuilder._getAgentPrompt(agentDir);
      // Apply template variable injection to agent prompt
      agentPrompt = PromptBuilder._injectTemplateVariables(agentPrompt, {
        mesh: meshInstance,
        agent: agent || mesh
      });

      // 3. Task (from parameter or task.md file)
      let taskContent = PromptBuilder._getTask(agentDir, task);

      // 4. Capabilities
      let capabilities = PromptBuilder._getCapabilities(agentDir);

      // 5. Frontmatter (use base mesh name for config lookup)
      let frontmatter = PromptBuilder._getFrontmatter(mesh, agent || mesh);

      // Combine all sections
      const fullPrompt = [
        preamble,
        agentPrompt,
        taskContent,
        capabilities,
        frontmatter
      ]
        .filter(s => s && s.trim())
        .join('\n\n---\n\n');

      // Log build completion BEFORE saving (for correct log order)
      Logger.log('prompt-builder', 'Prompt built', {
        mesh,
        meshInstance,
        agent: agent || mesh,
        'section.preamble': preamble.length,
        'section.agent-prompt': agentPrompt.length,
        'section.task': taskContent.length,
        'section.capabilities': capabilities.length,
        'section.frontmatter': frontmatter.length,
        'task.source': task ? 'spawn-init' : 'task.md'
      });

      // Save to agent workspace for reference
      PromptBuilder._savePrompt(meshInstance, agent || mesh, fullPrompt);

      return fullPrompt;
    } catch (error) {
      Logger.error('prompt-builder', `Failed to build prompt: ${error.message}`, {
        mesh,
        agent,
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Get preamble with mesh context
   */
  static _getPreamble(mesh, agent) {
    // Try to read custom preamble
    const customPath = path.join(TX_ROOT, 'meshes/prompts/templates/system/preamble.md');
    let preamble = '';

    if (fs.existsSync(customPath)) {
      const custom = fs.readFileSync(customPath, 'utf-8');

      // Generate TX status for injection
      const txStatusPrompt = PromptBuilder._generateTXStatusPrompt();

      // Inject variables
      preamble = PromptBuilder._injectTemplateVariables(custom, {
        mesh,
        agent,
        txStatusPrompt
      });
    }

    return preamble;
  }

  /**
   * Generate TX status summary for preamble injection
   * Shows active meshes with state.json and their agents
   */
  static _generateTXStatusPrompt() {
    try {
      const meshDir = '.ai/tx/mesh';
      if (!fs.existsSync(meshDir)) {
        return 'No active meshes.\n\nUse `tx status` to see current system state.';
      }

      let meshes = fs.readdirSync(meshDir).filter(f => {
        return fs.statSync(path.join(meshDir, f)).isDirectory();
      });

      // Filter to only meshes with state.json (living meshes)
      meshes = meshes.filter(mesh => {
        const stateFile = path.join(meshDir, mesh, 'state.json');
        return fs.existsSync(stateFile);
      });

      if (meshes.length === 0) {
        return 'No active meshes.\n\nUse `tx status` to see current system state.';
      }

      let prompt = 'Active meshes and agents:';

      meshes.forEach(mesh => {
        // Strip UUID suffix to get base mesh name
        let baseMeshName = mesh;
        const lastDashIndex = mesh.lastIndexOf('-');
        if (lastDashIndex > 0) {
          const suffix = mesh.substring(lastDashIndex + 1);
          if (/^[0-9a-f]{6}$/.test(suffix)) {
            baseMeshName = mesh.substring(0, lastDashIndex);
          }
        }

        // Get agents from mesh config
        const configPath = path.join(TX_ROOT, 'meshes/mesh-configs', `${baseMeshName}.json`);
        let agentsList = [];

        if (fs.existsSync(configPath)) {
          try {
            const config = fs.readJsonSync(configPath);
            agentsList = config.agents || [];
          } catch (error) {
            // Silently ignore config read errors
          }
        }

        // Extract agent names only
        const agentNames = agentsList.map(agentPath => {
          return agentPath.includes('/') ? agentPath.split('/').pop() : agentPath;
        });

        // Format: mesh: agent1, agent2, agent3
        prompt += `${mesh}: ${agentNames.join(', ')}\n`;
      });

      prompt += '\nUse `tx status` to see current system state.';

      return prompt.trim();
    } catch (error) {
      Logger.error('prompt-builder', `Failed to generate TX status: ${error.message}`);
      return 'Unable to generate status.';
    }
  }

  /**
   * Get agent prompt
   */
  static _getAgentPrompt(agentDir) {
    const promptPath = path.join(agentDir, 'prompt.md');

    if (!fs.existsSync(promptPath)) {
      return '';
    }

    return fs.readFileSync(promptPath, 'utf-8');
  }

  /**
   * Get task (from parameter or task.md file)
   * @param {string} agentDir - Agent directory path
   * @param {string} [task] - Optional task string (from spawn --init)
   */
  static _getTask(agentDir, task = null) {
    // If task provided as parameter, use it
    if (task) {
      return `## Current Task\n\n${task}`;
    }

    // Otherwise, try to read from task.md file
    const taskPath = path.join(agentDir, 'task.md');

    if (!fs.existsSync(taskPath)) {
      return '';
    }

    return `## Current Task\n\n${fs.readFileSync(taskPath, 'utf-8')}`;
  }

  /**
   * Get capabilities - recursively load all .md files from each capability folder
   * Wraps each capability in <capabilities> tags with named subtags
   */
  static _getCapabilities(agentDir) {
    const configPath = path.join(agentDir, 'config.json');

    if (!fs.existsSync(configPath)) {
      return '';
    }

    try {
      const config = fs.readJsonSync(configPath);
      if (!config.capabilities || config.capabilities.length === 0) {
        return '';
      }

      let capabilities = '<capabilities>\n\n';

      config.capabilities.forEach(cap => {
        const capDir = path.join(TX_ROOT, 'meshes/prompts/capabilities', cap);
        if (fs.existsSync(capDir)) {
          // Check if capability has a config.json with templates
          const capConfigPath = path.join(capDir, 'config.json');
          let templates = [];

          if (fs.existsSync(capConfigPath)) {
            try {
              const capConfig = fs.readJsonSync(capConfigPath);
              templates = capConfig.templates || [];
            } catch (error) {
              Logger.warn('prompt-builder', `Failed to read capability config: ${capConfigPath}`, { error: error.message });
            }
          }

          capabilities += `<${cap}>\n\n`;

          // First, load templates if specified in config
          if (templates.length > 0) {
            templates.forEach(templateName => {
              const templatePath = path.join(TX_ROOT, 'meshes/prompts/templates', `${templateName}.md`);
              if (fs.existsSync(templatePath)) {
                let templateContent = fs.readFileSync(templatePath, 'utf-8');

                // Inject template variables
                templateContent = PromptBuilder._injectTemplateVariables(templateContent, {});

                capabilities += templateContent + '\n\n';
              } else {
                Logger.warn('prompt-builder', `Template not found: ${templatePath}`, { capability: cap, template: templateName });
              }
            });
          }

          // Then, load capability's own markdown files
          const mdFiles = this._findMarkdownFiles(capDir)
            .filter(f => f !== capConfigPath)  // Exclude config.json from markdown search
            .sort();

          if (mdFiles.length > 0) {
            mdFiles.forEach(mdFile => {
              let capContent = fs.readFileSync(mdFile, 'utf-8');

              // Inject template variables if this is a template file
              capContent = PromptBuilder._injectTemplateVariables(capContent, {});

              capabilities += capContent + '\n\n';
            });
          } else if (templates.length === 0) {
            Logger.warn('prompt-builder', `No markdown files or templates found for capability: ${capDir}`, { capability: cap });
          }

          capabilities += `</${cap}>\n\n`;
        } else {
          Logger.warn('prompt-builder', `Capability directory not found: ${capDir}`, { capability: cap });
        }
      });

      capabilities += '</capabilities>';

      return capabilities;
    } catch (error) {
      Logger.error('prompt-builder', `Failed to get capabilities: ${error.message}`, { error: error.stack });
      return '';
    }
  }

  /**
   * Recursively find all markdown files in a directory
   */
  static _findMarkdownFiles(dir) {
    const mdFiles = [];

    if (!fs.existsSync(dir)) {
      return mdFiles;
    }

    const items = fs.readdirSync(dir, { withFileTypes: true });

    items.forEach(item => {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        // Recursively search subdirectories
        mdFiles.push(...this._findMarkdownFiles(fullPath));
      } else if (item.isFile() && item.name.endsWith('.md')) {
        mdFiles.push(fullPath);
      }
    });

    return mdFiles;
  }


  /**
   * Get frontmatter (message routing rules and templates)
   */
  static _getFrontmatter(mesh, agent) {
    const frontmatterPath = path.join(TX_ROOT, 'meshes/prompts/templates/system/frontmatter.md');

    if (!fs.existsSync(frontmatterPath)) {
      return '';
    }

    let frontmatterContent = fs.readFileSync(frontmatterPath, 'utf-8');

    // Get next agent instructions based on mesh config
    const routingInstructions = PromptBuilder._getStatusRoutingInstructions(mesh, agent);

    // Check if self-modify is enabled in mesh config
    const selfModifyInstructions = PromptBuilder._getSelfModifyInstructions(mesh);

    // Inject variables
    frontmatterContent = PromptBuilder._injectTemplateVariables(frontmatterContent, {
      mesh,
      agent,
      routingInstructions
    });

    // Append self-modify instructions if enabled
    if (selfModifyInstructions) {
      frontmatterContent += '\n\n---\n\n' + selfModifyInstructions;
    }

    return frontmatterContent;
  }

  /**
   * Get self-modify instructions if enabled in mesh config
   * Loads template and injects lens configuration
   */
  static _getSelfModifyInstructions(mesh) {
    try {
      // Load mesh config to check frontmatter
      const configPath = path.join(TX_ROOT, 'meshes/mesh-configs', `${mesh}.json`);

      if (!fs.existsSync(configPath)) {
        return null;
      }

      const config = fs.readJsonSync(configPath);
      const frontmatter = config.frontmatter || {};

      // Only inject if self-modify is enabled
      if (!frontmatter['self-modify']) {
        return null;
      }

      // Load self-modify template
      const templatePath = path.join(TX_ROOT, 'lib/templates/self-modify.md');

      if (!fs.existsSync(templatePath)) {
        Logger.warn('prompt-builder', 'Self-modify template not found', { path: templatePath });
        return null;
      }

      let template = fs.readFileSync(templatePath, 'utf-8');

      // Load and format lens list based on mesh config
      const lensConfig = frontmatter.lens;
      let lensesList = '';

      if (lensConfig) {
        try {
          const lensIndexPath = path.join(TX_ROOT, 'meshes/prompts/lenses/index.json');
          if (fs.existsSync(lensIndexPath)) {
            const lensIndex = JSON.parse(fs.readFileSync(lensIndexPath, 'utf-8'));
            const filteredLenses = PromptBuilder._filterLenses(lensIndex, lensConfig);
            lensesList = PromptBuilder._formatLensesList(filteredLenses);
          }
        } catch (error) {
          Logger.warn('prompt-builder', `Failed to load lenses: ${error.message}`);
          lensesList = 'Error loading lens list';
        }
      } else {
        lensesList = 'Lenses not enabled for this mesh. Set `frontmatter.lens` in mesh config to enable.';
      }

      // Replace template variables
      template = template
        .replace(/{{agent-path}}/g, `${mesh}/${mesh}`)
        .replace(/{{max-iterations}}/g, frontmatter['max-iterations'] || 10)
        .replace(/{{iteration}}/g, 1)
        .replace(/{{next-iteration}}/g, 2)
        .replace(/{{previous-confidence}}/g, 0)
        .replace(/{{available-lenses}}/g, lensesList);

      return template;
    } catch (error) {
      Logger.error('prompt-builder', `Failed to get self-modify instructions: ${error.message}`);
      return null;
    }
  }

  /**
   * Filter lenses based on configuration
   */
  static _filterLenses(lensIndex, lensConfig) {
    if (!lensIndex.lenses) {
      return { lenses: {} };
    }

    // Mode 1: lens: true - All lenses
    if (lensConfig === true) {
      return lensIndex;
    }

    // Mode 2: lens: 'tag' or lens: ['tag1', 'tag2'] - Filter by tags or explicit list
    if (typeof lensConfig === 'string' || Array.isArray(lensConfig)) {
      const tags = Array.isArray(lensConfig) ? lensConfig : [lensConfig];
      const isTagFiltering = tags.some(tag => !lensIndex.lenses[tag]);

      if (isTagFiltering) {
        // Tag filtering mode
        const filtered = {};
        Object.entries(lensIndex.lenses).forEach(([name, lens]) => {
          if (lens.tags && tags.some(tag => lens.tags.includes(tag))) {
            filtered[name] = lens;
          }
        });
        return { lenses: filtered };
      } else {
        // Explicit lens list mode
        const filtered = {};
        tags.forEach(lensName => {
          if (lensIndex.lenses[lensName]) {
            filtered[lensName] = lensIndex.lenses[lensName];
          }
        });
        return { lenses: filtered };
      }
    }

    return { lenses: {} };
  }

  /**
   * Format lenses list for template injection
   */
  static _formatLensesList(lensIndex) {
    if (!lensIndex.lenses || Object.keys(lensIndex.lenses).length === 0) {
      return 'No lenses available';
    }

    const lensesList = Object.entries(lensIndex.lenses)
      .map(([name, lens]) => `- **${name}** (${lens.tags.join(', ')})`)
      .join('\n');

    return lensesList;
  }

  /**
   * Generate status-based routing instructions from mesh config
   * Returns formatted guide showing which status values route to which agents
   */
  static _getStatusRoutingInstructions(mesh, currentAgent) {
    try {
      const configPath = path.join(TX_ROOT, 'meshes/mesh-configs', `${mesh}.json`);

      if (!fs.existsSync(configPath)) {
        return 'No routing configuration found.';
      }

      const config = fs.readJsonSync(configPath);

      // Extract agent name without mesh prefix
      const agentName = currentAgent.includes('/')
        ? currentAgent.split('/')[1]
        : currentAgent;

      const routing = config.routing?.[agentName];

      if (!routing || Object.keys(routing).length === 0) {
        return 'No routing rules defined for this agent.';
      }

      let instructions = '## Status & Routing Decision Guide\n\n';
      instructions += 'Choose the appropriate status based on your work outcome:\n\n';

      // Iterate through each status
      for (const [status, targets] of Object.entries(routing)) {
        instructions += `### Status: \`${status}\`\n\n`;

        const targetAgents = Object.keys(targets);

        if (targetAgents.length === 1) {
          // Single route for this status
          const target = targetAgents[0];
          const when = targets[target];
          instructions += `**When:** ${when}\n`;
          instructions += `**Routes to:** \`${target}\`\n\n`;
        } else {
          // Multiple routes - branching decision
          instructions += 'Choose the appropriate destination:\n\n';
          for (const [target, when] of Object.entries(targets)) {
            instructions += `- → \`${target}\`\n`;
            instructions += `  **When:** ${when}\n\n`;
          }
        }
      }

      return instructions;
    } catch (error) {
      Logger.warn('prompt-builder', `Failed to generate status routing instructions: ${error.message}`);
      return 'Process and complete task.';
    }
  }

  /**
   * Save prompt to agent workspace for reference
   * Renames existing prompt.md to YYMMDDHHMM-prompt.md based on file creation date
   */
  static _savePrompt(mesh, agent, prompt) {
    const promptDir = `.ai/tx/mesh/${mesh}/agents/${agent}/prompts`;
    fs.ensureDirSync(promptDir);

    const promptPath = path.join(promptDir, 'prompt.md');

    // If prompt.md exists, rename it with file creation date
    if (fs.existsSync(promptPath)) {
      try {
        const stats = fs.statSync(promptPath);
        // Use birthtime (creation time) or fallback to mtime
        const fileDate = stats.birthtime || stats.mtime;

        // Format: YYMMDDHHMM
        const yy = String(fileDate.getFullYear()).slice(-2);
        const mm = String(fileDate.getMonth() + 1).padStart(2, '0');
        const dd = String(fileDate.getDate()).padStart(2, '0');
        const hh = String(fileDate.getHours()).padStart(2, '0');
        const min = String(fileDate.getMinutes()).padStart(2, '0');
        const dateStamp = `${yy}${mm}${dd}${hh}${min}`;

        const archivePath = path.join(promptDir, `${dateStamp}-prompt.md`);
        fs.renameSync(promptPath, archivePath);

        Logger.log('prompt-builder', 'Prompt archived', {
          mesh,
          agent,
          from: promptPath,
          to: archivePath
        });
      } catch (error) {
        Logger.warn('prompt-builder', `Failed to archive existing prompt: ${error.message}`, {
          mesh,
          agent,
          error: error.message
        });
      }
    }

    // Write new prompt.md
    fs.writeFileSync(promptPath, prompt);

    Logger.log('prompt-builder', 'Prompt saved', {
      mesh,
      agent,
      filepath: promptPath
    });
  }

  /**
   * Generate list of active meshes and agents for ask capability
   * Shows which agents are currently available to ask questions to
   */
  static _generateActiveMeshList() {
    try {
      const meshDir = '.ai/tx/mesh';
      if (!fs.existsSync(meshDir)) {
        return 'No active meshes.';
      }

      let meshes = fs.readdirSync(meshDir).filter(f => {
        return fs.statSync(path.join(meshDir, f)).isDirectory();
      });

      // Filter to only meshes with state.json (living meshes)
      meshes = meshes.filter(mesh => {
        const stateFile = path.join(meshDir, mesh, 'state.json');
        return fs.existsSync(stateFile);
      });

      if (meshes.length === 0) {
        return 'No active meshes.';
      }

      let listMarkdown = '';

      meshes.forEach(mesh => {
        // Get mesh description from config
        const configPath = path.join(TX_ROOT, 'meshes/mesh-configs', `${mesh}.json`);
        let description = '';
        if (fs.existsSync(configPath)) {
          try {
            const config = fs.readJsonSync(configPath);
            description = config.description || '';
          } catch (error) {
            // Silently ignore config read errors
          }
        }

        listMarkdown += `### Mesh: \`${mesh}\``;
        if (description) {
          listMarkdown += ` - ${description}`;
        }
        listMarkdown += '\n\n';

        // List agents in this mesh
        const agentsDir = path.join(meshDir, mesh, 'agents');
        if (fs.existsSync(agentsDir)) {
          const agents = fs.readdirSync(agentsDir).filter(f => {
            return fs.statSync(path.join(agentsDir, f)).isDirectory();
          });

          if (agents.length > 0) {
            agents.forEach(agent => {
              listMarkdown += `- **\`${mesh}/${agent}\`**`;

              // Get agent config for description
              const agentConfigPath = path.join('meshes', 'agents', mesh, agent, 'config.json');
              let agentDesc = '';
              if (fs.existsSync(agentConfigPath)) {
                try {
                  const agentConfig = fs.readJsonSync(agentConfigPath);
                  agentDesc = agentConfig.description || '';
                } catch (error) {
                  // Silently ignore config read errors
                }
              }

              if (agentDesc) {
                listMarkdown += ` - ${agentDesc}`;
              }
              listMarkdown += '\n';

              // Get current task/status
              const activeDir = path.join(meshDir, mesh, 'agents', agent, 'msgs', 'active');
              if (fs.existsSync(activeDir)) {
                const files = fs.readdirSync(activeDir);
                if (files.length > 0) {
                  listMarkdown += `  - Currently: ${files[0]}\n`;
                }
              }
            });
          } else {
            listMarkdown += '(No agents active)\n';
          }
        }

        listMarkdown += '\n';
      });

      return listMarkdown.trim();
    } catch (error) {
      Logger.error('prompt-builder', `Failed to generate active mesh list: ${error.message}`, {
        error: error.stack
      });
      return 'Unable to generate active mesh list.';
    }
  }

  /**
   * Inject template variables into content
   * Handles {{ variable }} style template placeholders
   */
  static _injectTemplateVariables(content, variables = {}) {
    try {
      let result = content;

      // Inject provided variables
      Object.entries(variables).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
          result = result.replace(pattern, value);
        }
      });

      // Handle special template variables that require computation
      // txMeshList - list of all meshes
      if (result.includes('txMeshList')) {
        try {
          const meshList = generateMeshListForTemplate();
          result = result.replace(/\{\{\s*txMeshList\s*\}\}/g, meshList);
        } catch (error) {
          Logger.warn('prompt-builder', `Failed to generate txMeshList: ${error.message}`);
          result = result.replace(/\{\{\s*txMeshList\s*\}\}/g, 'Unable to generate mesh list');
        }
      }

      // activeMeshList - list of active meshes and agents available for asking
      if (result.includes('activeMeshList')) {
        try {
          const meshList = PromptBuilder._generateActiveMeshList();
          result = result.replace(/\{\{\s*activeMeshList\s*\}\}/g, meshList);
        } catch (error) {
          Logger.warn('prompt-builder', `Failed to generate activeMeshList: ${error.message}`);
          result = result.replace(/\{\{\s*activeMeshList\s*\}\}/g, 'No active agents available.');
        }
      }

      return result;
    } catch (error) {
      Logger.error('prompt-builder', `Failed to inject template variables: ${error.message}`);
      return content;
    }
  }

  /**
   * Get prompt size (for deciding injection method)
   */
  static getSize(mesh, agent) {
    const prompt = PromptBuilder.build(mesh, agent);
    return prompt.length;
  }
}

module.exports = { PromptBuilder };
