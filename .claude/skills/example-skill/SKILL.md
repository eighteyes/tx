---
name: example-skill
description: Template skill demonstrating the full structure with scripts, references, and assets. Use this as a blueprint when creating new skills.
---

# Example Skill Template

This skill demonstrates the complete structure for creating reusable capabilities with bundled resources.

## Structure

A skill consists of:

- **SKILL.md** - Metadata and core instructions (this file)
- **scripts/** - Executable code (Python, JavaScript, Bash, etc.)
- **references/** - Documentation to load as needed
- **assets/** - Templates and files for output

## When to Use This Template

When creating a new skill:

1. Copy this directory and rename it
2. Update frontmatter (name, description)
3. Add executable scripts in `scripts/`
4. Add reference documentation in `references/`
5. Add template files in `assets/`
6. Update this section with actual instructions

## Example Workflow

### Step 1: Run a Script

Your skill can include executable scripts that agents call:

```bash
node scripts/example-script.js --input "data"
```

See `scripts/example-script.js` for implementation.

### Step 2: Reference Documentation

For detailed information, see:
- `references/concepts.md` - Core concepts
- `references/patterns.md` - Common patterns
- `references/troubleshooting.md` - Problem solving

Load these when needed rather than keeping everything in SKILL.md.

### Step 3: Use Templates

Common templates are in `assets/`:
- `assets/template-example.md` - Message template

Copy and customize as needed.

## Key Design Principles

- **Progressive Disclosure** - Keep SKILL.md lean, put details in references/
- **Reusable Scripts** - Deterministic code that can be executed repeatedly
- **Clear Metadata** - Name and description help Claude choose the right skill
- **Bundled Resources** - Everything needed is in one place

## Next Steps

1. Replace this with your actual skill content
2. Add scripts in `scripts/` for repeatable tasks
3. Add references in `references/` for detailed docs
4. Add templates in `assets/` for output generation
