const { Logger } = require('./logger');
const { ConfigLoader } = require('./config-loader');
const { AgentPath } = require('./utils/agent-path');

/**
 * Routing Utility
 *
 * Centralized routing logic for mesh message routing.
 * Handles validation and instruction generation from mesh config routing rules.
 */
class Routing {
  /**
   * Validate a routing decision
   * @param {string} sourceMesh - Source mesh name
   * @param {string} sourceAgent - Source agent name
   * @param {string} status - Message status
   * @param {string} to - Target agent (with or without mesh prefix)
   * @returns {{valid: boolean, error?: string}} Validation result
   */
  static validateRoute(sourceMesh, sourceAgent, status, to) {
    try {
      // Extract agent name from sourceAgent (remove mesh prefix if present)
      const agentName = AgentPath.extractName(sourceAgent);

      // Load mesh routing config
      const routing = ConfigLoader.getMeshRouting(sourceMesh);
      const agentRouting = routing[agentName];

      if (!agentRouting) {
        return { valid: true }; // No routing rules = no validation
      }

      // Check if status is defined in routing rules
      const statusRoutes = agentRouting[status];
      if (!statusRoutes) {
        return {
          valid: false,
          error: `Unknown status "${status}" for agent ${agentName}. Valid statuses: ${Object.keys(agentRouting).join(', ')}`
        };
      }

      // Extract target agent name
      const targetAgent = AgentPath.extractName(to);

      // Check if target agent is valid for this status
      const validTargets = Object.keys(statusRoutes);
      if (!validTargets.includes(targetAgent)) {
        return {
          valid: false,
          error: `Status "${status}" cannot route to "${targetAgent}". Valid targets: ${validTargets.join(', ')}`
        };
      }

      return { valid: true };
    } catch (error) {
      Logger.warn('routing', `Routing validation error: ${error.message}`);
      return { valid: true }; // Don't block routing on validation errors
    }
  }

  /**
   * Get routing rules for a specific agent
   * @param {string} meshName - Mesh name
   * @param {string} agentName - Agent name (without mesh/category prefix)
   * @returns {object|null} Routing rules or null if not found
   */
  static getAgentRouting(meshName, agentName) {
    try {
      const routing = ConfigLoader.getMeshRouting(meshName);
      return routing[agentName] || null;
    } catch (error) {
      Logger.warn('routing', `Failed to get routing for ${meshName}/${agentName}: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate status routing instructions for agent prompt
   * @param {string} meshName - Mesh name
   * @param {string} agentName - Agent name (can include category prefix)
   * @returns {string} Formatted routing instructions
   */
  static formatRoutingInstructions(meshName, agentName) {
    try {
      // Extract agent name without category prefix
      const name = AgentPath.extractName(agentName);

      const routing = Routing.getAgentRouting(meshName, name);

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
      Logger.warn('routing', `Failed to generate routing instructions: ${error.message}`);
      return 'Process and complete task.';
    }
  }

  /**
   * Get valid statuses for an agent
   * @param {string} meshName - Mesh name
   * @param {string} agentName - Agent name
   * @returns {string[]} Array of valid status values
   */
  static getValidStatuses(meshName, agentName) {
    const routing = Routing.getAgentRouting(meshName, agentName);
    return routing ? Object.keys(routing) : [];
  }

  /**
   * Get valid targets for a specific status
   * @param {string} meshName - Mesh name
   * @param {string} agentName - Agent name
   * @param {string} status - Status value
   * @returns {string[]} Array of valid target agents
   */
  static getValidTargets(meshName, agentName, status) {
    const routing = Routing.getAgentRouting(meshName, agentName);
    if (!routing || !routing[status]) {
      return [];
    }
    return Object.keys(routing[status]);
  }

  /**
   * Count routing iterations for a specific route
   * @param {string} from - Source agent
   * @param {string} to - Target agent
   * @param {string} status - Status value
   * @returns {number} Iteration count
   */
  static countRoutingIterations(from, to, status) {
    try {
      const fs = require('fs-extra');
      const path = require('path');

      // Extract agent names without mesh prefix
      const fromAgent = AgentPath.extractName(from);
      const toAgent = AgentPath.extractName(to);

      const msgsDir = '.ai/tx/msgs';
      if (!fs.existsSync(msgsDir)) {
        return 0;
      }

      // Read all message files
      const files = fs.readdirSync(msgsDir).filter(f => f.endsWith('.md'));

      let count = 0;

      for (const file of files) {
        // Check filename pattern: *-{from}>{to}-*.md
        if (file.includes(`${fromAgent}>${toAgent}`)) {
          // Parse message to check status
          const filepath = path.join(msgsDir, file);
          const content = fs.readFileSync(filepath, 'utf8');

          // Extract status from frontmatter
          const statusMatch = content.match(/^status:\s*(.+)$/m);
          if (statusMatch && statusMatch[1].trim() === status) {
            count++;
          }
        }
      }

      return count;
    } catch (error) {
      Logger.warn('routing', `Failed to count iterations: ${error.message}`);
      return 0;
    }
  }

  /**
   * Check if routing would exceed iteration limit
   * @param {string} from - Source agent
   * @param {string} to - Target agent
   * @param {string} status - Status value
   * @param {number} maxIterations - Maximum allowed iterations (default: 3)
   * @returns {{exceeded: boolean, count: number, limit: number}} Iteration check result
   */
  static checkIterationLimit(from, to, status, maxIterations = 3) {
    const count = Routing.countRoutingIterations(from, to, status);
    return {
      exceeded: count >= maxIterations,
      count: count,
      limit: maxIterations
    };
  }
}

module.exports = { Routing };
