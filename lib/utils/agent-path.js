/**
 * AgentPath Utility
 *
 * Centralized parsing and formatting of agent paths.
 * Agents can be in two formats:
 * - Simple: "agentName"
 * - Categorized: "category/agentName"
 */
class AgentPath {
  /**
   * Extract agent name from path
   * @param {string} agentPath - Agent path (e.g., "core" or "category/agent")
   * @returns {string} Agent name
   *
   * @example
   * AgentPath.extractName('core') // => 'core'
   * AgentPath.extractName('editorial/reviewer') // => 'reviewer'
   */
  static extractName(agentPath) {
    if (!agentPath) return '';
    return agentPath.includes('/') ? agentPath.split('/').pop() : agentPath;
  }

  /**
   * Extract category from path
   * @param {string} agentPath - Agent path (e.g., "core" or "category/agent")
   * @returns {string|null} Category or null if no category
   *
   * @example
   * AgentPath.extractCategory('core') // => null
   * AgentPath.extractCategory('editorial/reviewer') // => 'editorial'
   */
  static extractCategory(agentPath) {
    if (!agentPath) return null;
    return agentPath.includes('/') ? agentPath.split('/')[0] : null;
  }

  /**
   * Format category and name into agent path
   * @param {string|null} category - Category (can be null)
   * @param {string} name - Agent name
   * @returns {string} Formatted agent path
   *
   * @example
   * AgentPath.format(null, 'core') // => 'core'
   * AgentPath.format('editorial', 'reviewer') // => 'editorial/reviewer'
   */
  static format(category, name) {
    return category ? `${category}/${name}` : name;
  }

  /**
   * Parse agent path into components
   * @param {string} agentPath - Agent path
   * @returns {{name: string, category: string|null, fullPath: string}}
   *
   * @example
   * AgentPath.parse('core') // => {name: 'core', category: null, fullPath: 'core'}
   * AgentPath.parse('editorial/reviewer') // => {name: 'reviewer', category: 'editorial', fullPath: 'editorial/reviewer'}
   */
  static parse(agentPath) {
    return {
      name: AgentPath.extractName(agentPath),
      category: AgentPath.extractCategory(agentPath),
      fullPath: agentPath
    };
  }

  /**
   * Check if agent path has a category
   * @param {string} agentPath - Agent path
   * @returns {boolean}
   */
  static hasCategory(agentPath) {
    return !!(agentPath && agentPath.includes('/'));
  }
}

module.exports = { AgentPath };
