# Core Concepts

## What are Skills?

Skills are modular, self-contained packages that extend Claude's capabilities by providing specialized knowledge, workflows, and bundled resources.

## Key Principles

### 1. Progressive Disclosure

Keep the main SKILL.md file concise. Use reference files for:
- Detailed explanations
- API documentation
- Troubleshooting guides
- Configuration options

Load these files only when needed.

### 2. Deterministic Reusability

Scripts should:
- Produce consistent output for the same input
- Handle errors gracefully
- Exit with appropriate status codes
- Be executable multiple times

### 3. Context Efficiency

Use context wisely:
- Metadata (name + description) = always visible (~100 words)
- SKILL.md body = when skill is triggered (<5k words)
- Bundled resources = as needed (unlimited)

## Skill Structure

```
skill-name/
├── SKILL.md              (required - metadata + core instructions)
├── scripts/              (optional - executable code)
│   ├── script1.js
│   └── script2.py
├── references/           (optional - documentation)
│   ├── api.md
│   └── patterns.md
└── assets/               (optional - templates/files for output)
    ├── template.md
    └── boilerplate.html
```

## When to Use Each Component

### Scripts

Use scripts for:
- Deterministic, frequently-rewritten code
- Complex transformations
- Validation logic
- Integration with external tools

Example: `validate-data.js`, `transform-xml.py`, `build-template.sh`

### References

Use references for:
- API documentation
- Detailed workflows
- Company-specific knowledge
- Troubleshooting guides
- Configuration schemas

Example: `api-reference.md`, `database-schema.md`, `error-handling.md`

### Assets

Use assets for:
- HTML/React boilerplate
- CSS frameworks
- Logo files
- Document templates
- Sample data

Example: `starter-template/`, `brand-logo.png`, `contract-template.docx`
