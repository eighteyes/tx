const { describe, it } = require('node:test');
const assert = require('node:assert');
const { RearmatterSchema } = require('../../lib/rearmatter-schema');

describe('RearmatterSchema', () => {
  describe('parse() - basic validation', () => {
    it('should parse valid confidence value', () => {
      const yaml = 'confidence: 0.85\n';
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true, 'Should be valid');
      assert.strictEqual(result.data.confidence, 0.85);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should parse valid grade value', () => {
      const yaml = 'grade: B\n';
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.data.grade, 'B');
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject confidence out of range (> 1.0)', () => {
      const yaml = 'confidence: 1.5\n';
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('between 0.0 and 1.0')));
    });

    it('should reject confidence out of range (< 0.0)', () => {
      const yaml = 'confidence: -0.5\n';
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('between 0.0 and 1.0')));
    });

    it('should reject invalid grade value', () => {
      const yaml = 'grade: X\n';
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('must be one of')));
    });

    it('should accept lowercase grade and validate', () => {
      const yaml = 'grade: b\n';
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.data.grade, 'b');
    });
  });

  describe('parse() - line-numbered items', () => {
    it('should parse speculation with line numbers', () => {
      const yaml = `speculation:
  15: "uncertain about API stability"
  23: "timeline may change"
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.data.speculation[15], 'uncertain about API stability');
      assert.strictEqual(result.data.speculation[23], 'timeline may change');
    });

    it('should parse gaps with line numbers', () => {
      const yaml = `gaps:
  34: "missing production load data"
  89: "no budget information"
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.data.gaps[34], 'missing production load data');
      assert.strictEqual(result.data.gaps[89], 'no budget information');
    });

    it('should parse assumptions with line numbers', () => {
      const yaml = `assumptions:
  8: "assuming infrastructure can handle 10x traffic"
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.data.assumptions[8], 'assuming infrastructure can handle 10x traffic');
    });

    it('should warn about empty descriptions', () => {
      const yaml = `speculation:
  15: ""
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes('Description is empty')));
    });

    it('should error on non-string descriptions', () => {
      const yaml = `speculation:
  15: 123
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Description must be a string')));
    });
  });

  describe('parse() - section breakdowns', () => {
    it('should parse confidence_sections', () => {
      const yaml = `confidence: 0.58
confidence_sections:
  "Technical Analysis": 0.92
  "Timeline Estimates": 0.43
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.data.confidence_sections['Technical Analysis'], 0.92);
      assert.strictEqual(result.data.confidence_sections['Timeline Estimates'], 0.43);
    });

    it('should parse grade_sections', () => {
      const yaml = `grade: D
grade_sections:
  "Technical Analysis": A
  "Timeline Estimates": F
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.data.grade_sections['Technical Analysis'], 'A');
      assert.strictEqual(result.data.grade_sections['Timeline Estimates'], 'F');
    });

    it('should warn if sections provided but not required', () => {
      const yaml = `confidence: 0.92
confidence_sections:
  "Section 1": 0.95
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes('not required')));
    });

    it('should warn if sections missing when required (low confidence)', () => {
      const yaml = 'confidence: 0.5\n';
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes('below threshold')));
    });

    it('should warn if sections missing when required (low grade)', () => {
      const yaml = 'grade: F\n';
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes('below threshold')));
    });
  });

  describe('requiresSectionBreakdown()', () => {
    it('should require breakdown when confidence < 0.7', () => {
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(0.6, undefined), true);
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(0.69, undefined), true);
    });

    it('should not require breakdown when confidence >= 0.7', () => {
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(0.7, undefined), false);
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(0.85, undefined), false);
    });

    it('should require breakdown when grade < C (D or F)', () => {
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(undefined, 'D'), true);
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(undefined, 'F'), true);
    });

    it('should not require breakdown when grade >= C', () => {
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(undefined, 'C'), false);
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(undefined, 'B'), false);
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(undefined, 'A'), false);
    });

    it('should require breakdown if either threshold is violated', () => {
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(0.6, 'A'), true, 'Low conf, high grade');
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(0.9, 'F'), true, 'High conf, low grade');
    });

    it('should not require breakdown if both thresholds are met', () => {
      assert.strictEqual(RearmatterSchema.requiresSectionBreakdown(0.85, 'B'), false);
    });
  });

  describe('extractFromMessage()', () => {
    it('should extract rearmatter from message', () => {
      const message = `# Task Complete

Implementation done.

---
rearmatter:
  confidence: 0.85
  grade: B
---`;
      const result = RearmatterSchema.extractFromMessage(message);

      assert.strictEqual(result.content.includes('# Task Complete'), true);
      assert.strictEqual(result.content.includes('Implementation done.'), true);
      assert.ok(result.rearmatter);
      assert.ok(result.rearmatter.includes('confidence: 0.85'));
    });

    it('should return null rearmatter if not present', () => {
      const message = '# Task Complete\n\nImplementation done.';
      const result = RearmatterSchema.extractFromMessage(message);

      assert.strictEqual(result.content, message);
      assert.strictEqual(result.rearmatter, null);
    });

    it('should handle multiline rearmatter', () => {
      const message = `Content here

---
rearmatter:
  confidence: 0.58
  confidence_sections:
    "Section 1": 0.92
    "Section 2": 0.43
  speculation:
    15: "uncertain"
---`;
      const result = RearmatterSchema.extractFromMessage(message);

      assert.ok(result.rearmatter);
      assert.ok(result.rearmatter.includes('confidence: 0.58'));
      assert.ok(result.rearmatter.includes('confidence_sections'));
      assert.ok(result.rearmatter.includes('speculation'));
    });
  });

  describe('format()', () => {
    it('should format data back to YAML', () => {
      const data = {
        confidence: 0.85,
        grade: 'B'
      };
      const yaml = RearmatterSchema.format(data);

      assert.ok(yaml.includes('confidence: 0.85'));
      assert.ok(yaml.includes('grade: B'));
    });

    it('should format complex data structure', () => {
      const data = {
        confidence: 0.58,
        confidence_sections: {
          'Section 1': 0.92,
          'Section 2': 0.43
        },
        speculation: {
          15: 'uncertain about API'
        }
      };
      const yaml = RearmatterSchema.format(data);

      assert.ok(yaml.includes('confidence: 0.58'));
      assert.ok(yaml.includes('confidence_sections'));
      assert.ok(yaml.includes('Section 1'));
      assert.ok(yaml.includes('speculation'));
    });
  });

  describe('parse() - complete examples', () => {
    it('should parse complete rearmatter above threshold', () => {
      const yaml = `confidence: 0.85
grade: B
speculation:
  15: "uncertain about API stability"
gaps:
  34: "missing production load data"
assumptions:
  8: "assuming infrastructure can handle 10x traffic"
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.data.confidence, 0.85);
      assert.strictEqual(result.data.grade, 'B');
      assert.strictEqual(result.requiresSections, false);
    });

    it('should parse complete rearmatter below threshold with sections', () => {
      const yaml = `confidence: 0.58
confidence_sections:
  "Technical Analysis": 0.92
  "Timeline Estimates": 0.43
grade: D
grade_sections:
  "Technical Analysis": A
  "Timeline Estimates": F
speculation:
  98: "timeline is speculative"
gaps:
  105: "no budget info"
assumptions:
  42: "team comfortable with TypeScript"
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.requiresSections, true);
      assert.strictEqual(result.data.confidence, 0.58);
      assert.strictEqual(result.data.grade, 'D');
      assert.ok(result.data.confidence_sections);
      assert.ok(result.data.grade_sections);
    });
  });

  describe('parse() - error handling', () => {
    it('should handle invalid YAML', () => {
      const yaml = 'confidence: [invalid: yaml:';
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Failed to parse')));
    });

    it('should handle non-object data', () => {
      const yaml = '"just a string"';
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('must be an object')));
    });

    it('should warn about unknown fields', () => {
      const yaml = `confidence: 0.85
unknown_field: "something"
`;
      const result = RearmatterSchema.parse(yaml);

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes('Unknown rearmatter field')));
    });

    it('should return errors in strict mode (does not throw for validation errors)', () => {
      const yaml = 'confidence: 2.0\n'; // Out of range

      // In strict mode, parsing errors throw, but validation errors are returned
      const result = RearmatterSchema.parse(yaml, { strict: true });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('between 0.0 and 1.0')));
    });
  });
});
