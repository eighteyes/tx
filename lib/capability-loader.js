const fs = require('fs-extra');
const path = require('path');

/**
 * Load capability documentation from meshes/prompts/capabilities/
 */
class CapabilityLoader {
  static CAPABILITIES_DIR = path.join(__dirname, '..', 'meshes', 'prompts', 'capabilities');

  /**
   * Load a capability by name
   * @param {string} name - Capability name (e.g., 'know', 'hitl')
   * @returns {string} - Capability documentation content
   */
  static loadCapability(name) {
    const capabilityPath = path.join(CapabilityLoader.CAPABILITIES_DIR, `${name}.md`);

    if (!fs.existsSync(capabilityPath)) {
      throw new Error(`Capability not found: ${name} (${capabilityPath})`);
    }

    return fs.readFileSync(capabilityPath, 'utf8');
  }

  /**
   * List available capabilities
   * @returns {string[]} - Array of capability names
   */
  static listCapabilities() {
    if (!fs.existsSync(CapabilityLoader.CAPABILITIES_DIR)) {
      return [];
    }

    return fs.readdirSync(CapabilityLoader.CAPABILITIES_DIR)
      .filter(file => file.endsWith('.md'))
      .map(file => file.replace('.md', ''));
  }

  /**
   * Validate capability exists
   * @param {string} name - Capability name
   * @returns {boolean} - True if capability exists
   */
  static validateCapability(name) {
    const capabilityPath = path.join(CapabilityLoader.CAPABILITIES_DIR, `${name}.md`);
    return fs.existsSync(capabilityPath);
  }
}

module.exports = { CapabilityLoader };
