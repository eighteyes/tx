const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { AtomicState } = require('./atomic-state');

class PromptBuilder {
  /**
   * Build complete agent prompt from components
   * Assembles: preamble + agent prompt + task + capabilities + workflow
   */
  static build(mesh, agent) {
    try {
      const agentDir = `meshes/agents/${mesh}/${agent || mesh}`;

      // 1. Preamble
      let preamble = PromptBuilder._getPreamble(mesh, agent || mesh);

      // 2. Agent Prompt
      let agentPrompt = PromptBuilder._getAgentPrompt(agentDir);

      // 3. Task
      let task = PromptBuilder._getTask(agentDir);

      // 4. Capabilities
      let capabilities = PromptBuilder._getCapabilities(agentDir);

      // 5. Workflow instructions
      let workflow = PromptBuilder._getWorkflow();

      // Combine all sections
      const fullPrompt = [
        preamble,
        agentPrompt,
        task,
        capabilities,
        workflow
      ]
        .filter(s => s && s.trim())
        .join('\n\n---\n\n');

      // Save to agent workspace for reference
      PromptBuilder._savePrompt(mesh, agent || mesh, fullPrompt);

      Logger.log('prompt-builder', 'Prompt built', {
        mesh,
        agent: agent || mesh,
        sections: [
          preamble.length,
          agentPrompt.length,
          task.length,
          capabilities.length,
          workflow.length
        ]
      });

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
    let preamble = `# TX Watch - Agent Session

You are running as Claude inside a tmux session managed by TX Watch.

## Your Context
- **Mesh**: ${mesh}
- **Agent**: ${agent}
- **Workspace**: \`.ai/tx/mesh/${mesh}/agents/${agent}/\`

## How to Work
1. Read your incoming task from: \`.ai/tx/mesh/${mesh}/agents/${agent}/msgs/active/\`
2. Save your work to: \`.ai/tx/mesh/${mesh}/shared/output/\`
3. When done, use \`/tx-done\` to mark task complete

## File Paths
- **Inbox** (incoming tasks): \`.ai/tx/mesh/${mesh}/agents/${agent}/msgs/inbox/\`
- **Active** (current task): \`.ai/tx/mesh/${mesh}/agents/${agent}/msgs/active/\`
- **Outbox** (your responses): \`.ai/tx/mesh/${mesh}/agents/${agent}/msgs/outbox/\`
- **Complete** (finished tasks): \`.ai/tx/mesh/${mesh}/agents/${agent}/msgs/complete/\`
- **Shared output**: \`.ai/tx/mesh/${mesh}/shared/output/\`

## Important Commands
- \`/tx-done\` - Mark current task complete
- \`/tx-next\` - Request next task
- \`/search query\` - Search the web (SearXNG)
- \`/ask agent-name "question"\` - Ask another agent`;

    // Try to read custom preamble
    const customPath = 'prompts/templates/system/preamble.md';
    if (fs.existsSync(customPath)) {
      const custom = fs.readFileSync(customPath, 'utf-8');
      preamble = custom
        .replace(/\{\{mesh\}\}/g, mesh)
        .replace(/\{\{agent\}\}/g, agent);
    }

    return preamble;
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
   * Get task (if exists)
   */
  static _getTask(agentDir) {
    const taskPath = path.join(agentDir, 'task.md');

    if (!fs.existsSync(taskPath)) {
      return '';
    }

    return `## Current Task\n\n${fs.readFileSync(taskPath, 'utf-8')}`;
  }

  /**
   * Get capabilities
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

      let capabilities = '## Available Capabilities\n\n';

      config.capabilities.forEach(cap => {
        const capPath = `prompts/capabilities/${cap}/${cap}.md`;
        if (fs.existsSync(capPath)) {
          capabilities += fs.readFileSync(capPath, 'utf-8') + '\n\n';
        }
      });

      return capabilities;
    } catch (error) {
      return '';
    }
  }

  /**
   * Get workflow instructions
   */
  static _getWorkflow() {
    const workflowPath = 'prompts/templates/system/workflow.md';

    if (!fs.existsSync(workflowPath)) {
      return '';
    }

    return `## Workflow\n\n${fs.readFileSync(workflowPath, 'utf-8')}`;
  }

  /**
   * Save prompt to agent workspace for reference
   */
  static _savePrompt(mesh, agent, prompt) {
    const promptDir = `.ai/tx/mesh/${mesh}/agents/${agent}/prompts`;
    fs.ensureDirSync(promptDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const promptFile = path.join(promptDir, `${timestamp}-prompt.md`);

    fs.writeFileSync(promptFile, prompt);

    Logger.log('prompt-builder', 'Prompt saved', {
      mesh,
      agent,
      filepath: promptFile
    });
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
