const yaml = require('js-yaml');

/**
 * RearmatterSchema - Parser and validator for rearmatter transparency metadata
 *
 * Validates and parses rearmatter YAML blocks that agents append to messages
 * to self-assess response quality and flag uncertainties.
 */
class RearmatterSchema {
  /**
   * Grade constants
   */
  static GRADES = ['A', 'B', 'C', 'D', 'F'];
  static GRADE_THRESHOLD = 'C'; // Grades below this require section breakdown
  static CONFIDENCE_THRESHOLD = 0.7; // Confidence below this requires section breakdown

  /**
   * Valid rearmatter field names
   */
  static VALID_FIELDS = [
    'confidence',
    'confidence_sections',
    'grade',
    'grade_sections',
    'speculation',
    'gaps',
    'assumptions',
    'spawn'
  ];

  /**
   * Parse and validate a rearmatter YAML block
   *
   * @param {string} yamlContent - Raw YAML content (without "rearmatter:" key)
   * @param {object} options - Validation options: { strict: boolean }
   * @returns {object} Parsed and validated rearmatter data
   * @throws {Error} If validation fails in strict mode
   */
  static parse(yamlContent, options = { strict: false }) {
    const errors = [];
    const warnings = [];

    try {
      // Parse YAML
      let data;
      try {
        data = yaml.load(yamlContent);
      } catch (parseError) {
        const error = `Failed to parse rearmatter YAML: ${parseError.message}`;
        if (options.strict) throw new Error(error);
        errors.push(error);
        return { valid: false, errors, warnings, data: null };
      }

      // Ensure data is an object
      if (typeof data !== 'object' || data === null) {
        const error = 'Rearmatter must be an object';
        if (options.strict) throw new Error(error);
        errors.push(error);
        return { valid: false, errors, warnings, data: null };
      }

      // Validate confidence if present
      if (data.confidence !== undefined) {
        const confResult = this.validateConfidence(data.confidence);
        if (!confResult.valid) {
          errors.push(...confResult.errors);
        }
        warnings.push(...confResult.warnings);
      }

      // Validate grade if present
      if (data.grade !== undefined) {
        const gradeResult = this.validateGrade(data.grade);
        if (!gradeResult.valid) {
          errors.push(...gradeResult.errors);
        }
        warnings.push(...gradeResult.warnings);
      }

      // Check if section breakdowns are required
      const requiresSections = this.requiresSectionBreakdown(data.confidence, data.grade);

      // Validate confidence_sections if present
      if (data.confidence_sections !== undefined) {
        const sectionsResult = this.validateConfidenceSections(data.confidence_sections);
        if (!sectionsResult.valid) {
          errors.push(...sectionsResult.errors);
        }
        warnings.push(...sectionsResult.warnings);

        // Warn if sections provided but not required
        if (!requiresSections) {
          warnings.push('Section breakdowns provided but not required (confidence >= 0.7 and grade >= C)');
        }
      } else if (requiresSections && data.confidence !== undefined) {
        warnings.push('Confidence below threshold (0.7) but no confidence_sections provided');
      }

      // Validate grade_sections if present
      if (data.grade_sections !== undefined) {
        const sectionsResult = this.validateGradeSections(data.grade_sections);
        if (!sectionsResult.valid) {
          errors.push(...sectionsResult.errors);
        }
        warnings.push(...sectionsResult.warnings);

        // Warn if sections provided but not required
        if (!requiresSections) {
          warnings.push('Section breakdowns provided but not required (confidence >= 0.7 and grade >= C)');
        }
      } else if (requiresSections && data.grade !== undefined) {
        warnings.push('Grade below threshold (C) but no grade_sections provided');
      }

      // Validate line-numbered items
      ['speculation', 'gaps', 'assumptions'].forEach(field => {
        if (data[field] !== undefined) {
          const itemResult = this.validateLineNumberedItems(data[field], field);
          if (!itemResult.valid) {
            errors.push(...itemResult.errors);
          }
          warnings.push(...itemResult.warnings);
        }
      });

      // Validate spawn if present
      if (data.spawn !== undefined) {
        const spawnResult = this.validateSpawn(data.spawn);
        if (!spawnResult.valid) {
          errors.push(...spawnResult.errors);
        }
        warnings.push(...spawnResult.warnings);
      }

      // Check for unknown fields
      Object.keys(data).forEach(field => {
        if (!this.VALID_FIELDS.includes(field)) {
          warnings.push(`Unknown rearmatter field: '${field}'`);
        }
      });

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        data,
        requiresSections
      };
    } catch (error) {
      const errorMsg = `Unexpected error parsing rearmatter: ${error.message}`;
      if (options.strict) throw new Error(errorMsg);
      return {
        valid: false,
        errors: [errorMsg],
        warnings,
        data: null
      };
    }
  }

  /**
   * Validate confidence value (must be 0.0-1.0)
   */
  static validateConfidence(confidence) {
    const errors = [];
    const warnings = [];

    if (typeof confidence !== 'number') {
      errors.push(`Confidence must be a number, got ${typeof confidence}`);
      return { valid: false, errors, warnings };
    }

    if (confidence < 0 || confidence > 1) {
      errors.push(`Confidence must be between 0.0 and 1.0, got ${confidence}`);
      return { valid: false, errors, warnings };
    }

    return { valid: true, errors, warnings };
  }

  /**
   * Validate grade value (must be A-F)
   */
  static validateGrade(grade) {
    const errors = [];
    const warnings = [];

    if (typeof grade !== 'string') {
      errors.push(`Grade must be a string, got ${typeof grade}`);
      return { valid: false, errors, warnings };
    }

    const upperGrade = grade.toUpperCase();
    if (!this.GRADES.includes(upperGrade)) {
      errors.push(`Grade must be one of [${this.GRADES.join(', ')}], got '${grade}'`);
      return { valid: false, errors, warnings };
    }

    return { valid: true, errors, warnings, normalizedGrade: upperGrade };
  }

  /**
   * Validate confidence_sections (object with section name keys and confidence values)
   */
  static validateConfidenceSections(sections) {
    const errors = [];
    const warnings = [];

    if (typeof sections !== 'object' || sections === null || Array.isArray(sections)) {
      errors.push('confidence_sections must be an object with section names as keys');
      return { valid: false, errors, warnings };
    }

    Object.entries(sections).forEach(([section, value]) => {
      const result = this.validateConfidence(value);
      if (!result.valid) {
        errors.push(`confidence_sections['${section}']: ${result.errors.join(', ')}`);
      }
    });

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate grade_sections (object with section name keys and grade values)
   */
  static validateGradeSections(sections) {
    const errors = [];
    const warnings = [];

    if (typeof sections !== 'object' || sections === null || Array.isArray(sections)) {
      errors.push('grade_sections must be an object with section names as keys');
      return { valid: false, errors, warnings };
    }

    Object.entries(sections).forEach(([section, value]) => {
      const result = this.validateGrade(value);
      if (!result.valid) {
        errors.push(`grade_sections['${section}']: ${result.errors.join(', ')}`);
      }
    });

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate line-numbered items (speculation, gaps, assumptions)
   * Format: { line_number: "description", ... }
   */
  static validateLineNumberedItems(items, fieldName) {
    const errors = [];
    const warnings = [];

    if (typeof items !== 'object' || items === null || Array.isArray(items)) {
      errors.push(`${fieldName} must be an object with line numbers as keys`);
      return { valid: false, errors, warnings };
    }

    Object.entries(items).forEach(([lineNum, description]) => {
      // Validate line number (should be numeric, but YAML may parse as string or number)
      const num = typeof lineNum === 'string' ? parseInt(lineNum, 10) : lineNum;
      if (isNaN(num) || num < 1) {
        warnings.push(`${fieldName}['${lineNum}']: Line number should be a positive integer`);
      }

      // Validate description (should be non-empty string)
      if (typeof description !== 'string') {
        errors.push(`${fieldName}['${lineNum}']: Description must be a string, got ${typeof description}`);
      } else if (description.trim() === '') {
        warnings.push(`${fieldName}['${lineNum}']: Description is empty`);
      }
    });

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate spawn field
   * Format: { mesh: string, lens?: string[], reason: string, context: string, priority?: string, entity_refs?: string[] }
   */
  static validateSpawn(spawn) {
    const errors = [];
    const warnings = [];

    if (typeof spawn !== 'object' || spawn === null || Array.isArray(spawn)) {
      errors.push('spawn must be an object');
      return { valid: false, errors, warnings };
    }

    // Validate required: mesh
    if (!spawn.mesh) {
      errors.push('spawn.mesh is required');
    } else if (typeof spawn.mesh !== 'string') {
      errors.push(`spawn.mesh must be a string, got ${typeof spawn.mesh}`);
    } else if (spawn.mesh.trim() === '') {
      errors.push('spawn.mesh cannot be empty');
    }

    // Validate required: reason
    if (!spawn.reason) {
      errors.push('spawn.reason is required');
    } else if (typeof spawn.reason !== 'string') {
      errors.push(`spawn.reason must be a string, got ${typeof spawn.reason}`);
    } else if (spawn.reason.trim() === '') {
      errors.push('spawn.reason cannot be empty');
    }

    // Validate required: context
    if (!spawn.context) {
      errors.push('spawn.context is required');
    } else if (typeof spawn.context !== 'string') {
      errors.push(`spawn.context must be a string, got ${typeof spawn.context}`);
    } else if (spawn.context.trim() === '') {
      errors.push('spawn.context cannot be empty');
    }

    // Validate optional: lens (array of strings)
    if (spawn.lens !== undefined) {
      if (!Array.isArray(spawn.lens)) {
        errors.push(`spawn.lens must be an array, got ${typeof spawn.lens}`);
      } else {
        spawn.lens.forEach((lens, index) => {
          if (typeof lens !== 'string') {
            errors.push(`spawn.lens[${index}] must be a string, got ${typeof lens}`);
          }
        });
      }
    }

    // Validate optional: priority (enum: high|normal|low)
    if (spawn.priority !== undefined) {
      const validPriorities = ['high', 'normal', 'low'];
      if (typeof spawn.priority !== 'string') {
        errors.push(`spawn.priority must be a string, got ${typeof spawn.priority}`);
      } else if (!validPriorities.includes(spawn.priority.toLowerCase())) {
        errors.push(`spawn.priority must be one of [${validPriorities.join(', ')}], got '${spawn.priority}'`);
      }
    }

    // Validate optional: entity_refs (array of strings)
    if (spawn.entity_refs !== undefined) {
      if (!Array.isArray(spawn.entity_refs)) {
        errors.push(`spawn.entity_refs must be an array, got ${typeof spawn.entity_refs}`);
      } else {
        spawn.entity_refs.forEach((ref, index) => {
          if (typeof ref !== 'string') {
            errors.push(`spawn.entity_refs[${index}] must be a string, got ${typeof ref}`);
          }
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Determine if section breakdown is required
   * Required when: confidence < 0.7 OR grade < C
   */
  static requiresSectionBreakdown(confidence, grade) {
    let requiresBreakdown = false;

    // Check confidence threshold
    if (confidence !== undefined && confidence < this.CONFIDENCE_THRESHOLD) {
      requiresBreakdown = true;
    }

    // Check grade threshold (A=0, B=1, C=2, D=3, F=4)
    if (grade !== undefined) {
      const upperGrade = typeof grade === 'string' ? grade.toUpperCase() : grade;
      const gradeIndex = this.GRADES.indexOf(upperGrade);
      const thresholdIndex = this.GRADES.indexOf(this.GRADE_THRESHOLD);

      if (gradeIndex > thresholdIndex) {
        requiresBreakdown = true;
      }
    }

    return requiresBreakdown;
  }

  /**
   * Extract rearmatter block from message content
   * Returns: { content: string, rearmatter: string | null }
   */
  static extractFromMessage(messageContent) {
    // Look for rearmatter block: ---\nrearmatter:\n...\n---
    const rearmatterRegex = /\n---\s*\nrearmatter:\s*\n([\s\S]*?)\n---\s*$/;
    const match = messageContent.match(rearmatterRegex);

    if (!match) {
      return { content: messageContent, rearmatter: null };
    }

    // Extract content without rearmatter block
    const content = messageContent.replace(rearmatterRegex, '').trim();
    const rearmatterYaml = match[1];

    return { content, rearmatter: rearmatterYaml };
  }

  /**
   * Format rearmatter data back to YAML string
   */
  static format(data) {
    return yaml.dump(data, {
      indent: 2,
      lineWidth: -1, // Don't wrap lines
      noRefs: true
    });
  }
}

module.exports = { RearmatterSchema };
