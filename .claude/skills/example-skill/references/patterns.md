# Common Skill Patterns

## Pattern 1: Single Purpose Script

For simple, focused skills with one main operation.

```
simple-skill/
├── SKILL.md
├── scripts/
│   └── main-operation.js
└── references/
    └── usage.md
```

**Example**: PDF rotation skill with one script

## Pattern 2: Multiple Related Scripts

For skills with several related operations.

```
multi-script-skill/
├── SKILL.md
├── scripts/
│   ├── validate.js
│   ├── transform.js
│   └── output.js
└── references/
    ├── workflow.md
    └── api.md
```

**Example**: Data processing skill with validation → transform → output

## Pattern 3: Heavy Documentation

For complex domains needing extensive reference material.

```
documented-skill/
├── SKILL.md (navigation guide)
├── scripts/
│   └── helper-script.js
└── references/
    ├── getting-started.md
    ├── api-reference.md
    ├── database-schema.md
    ├── error-codes.md
    └── troubleshooting.md
```

**Example**: BigQuery skill with multiple domain reference files

## Pattern 4: Template/Boilerplate

For skills focused on generating code or documents.

```
template-skill/
├── SKILL.md
├── assets/
│   ├── react-app/
│   ├── html-template.html
│   └── styles.css
└── references/
    └── customization.md
```

**Example**: Frontend starter kit skill

## Pattern 5: Framework/Library-Specific

For skills supporting multiple frameworks with diverging guidance.

```
framework-skill/
├── SKILL.md (framework selection logic)
├── references/
│   ├── react.md
│   ├── vue.md
│   └── vanilla.md
└── scripts/
    └── setup.js
```

**Example**: Frontend skill with React/Vue/Vanilla guides

## Best Practices Across Patterns

1. **Keep SKILL.md under 500 lines** - Refactor into references if larger
2. **Use clear filenames** - `database-schema.md` not `db.md`
3. **Link from SKILL.md** - Reference files should be discoverable from main file
4. **One level deep** - Keep references directly under skill, not nested folders
5. **Test scripts** - Run scripts at least once to ensure they work
6. **Include examples** - Both in SKILL.md and in reference files
