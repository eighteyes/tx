# Lens Configuration Guide

Complete guide to configuring cognitive lenses for self-modifying agents.

## Overview

Lenses provide different cognitive perspectives that agents can apply during self-modification iterations. The lens system supports multiple configuration modes to control which lenses are available to agents.

## Configuration Modes

### Mode 1: All Lenses (lens: true)

**Use when**: You want agents to have access to all available lenses

```json
{
  "frontmatter": {
    "self-modify": true,
    "lens": true
  }
}
```

**Result**: Agent sees all 8 lenses:
```
- **security-audit** (security, threat-modeling, validation, owasp)
- **edge-cases** (testing, robustness, qa, validation)
- **performance** (performance, optimization, profiling, benchmarking)
- **maintainability** (clean-code, solid, refactoring, architecture)
- **user-experience** (ux, usability, design, accessibility)
- **critical-analysis** (analysis, critique, logic, reasoning)
- **creative-exploration** (creativity, innovation, brainstorming, exploration)
- **cost-optimization** (simplicity, efficiency, minimalism, pragmatism)
```

---

### Mode 2: Tag Filtering (lens: 'tag' or lens: ['tag1', 'tag2'])

**Use when**: You want to limit lenses to specific domains or concerns

#### Single Tag

```json
{
  "frontmatter": {
    "self-modify": true,
    "lens": "security"
  }
}
```

**Result**: Only lenses with the `security` tag:
```
- **security-audit** (security, threat-modeling, validation, owasp)
```

#### Multiple Tags

```json
{
  "frontmatter": {
    "self-modify": true,
    "lens": ["security", "performance"]
  }
}
```

**Result**: Lenses with ANY of the specified tags:
```
- **security-audit** (security, threat-modeling, validation, owasp)
- **performance** (performance, optimization, profiling, benchmarking)
```

**Note**: Tag filtering uses OR logic - a lens is included if it has ANY of the specified tags.

---

### Mode 3: Explicit Lens List (lens: ['lens1', 'lens2'])

**Use when**: You want precise control over which specific lenses are available

```json
{
  "frontmatter": {
    "self-modify": true,
    "lens": ["security-audit", "edge-cases", "performance"]
  }
}
```

**Result**: Only the specified lenses:
```
- **security-audit** (security, threat-modeling, validation, owasp)
- **edge-cases** (testing, robustness, qa, validation)
- **performance** (performance, optimization, profiling, benchmarking)
```

**Detection**: The system automatically detects explicit lens mode when all specified values match existing lens names.

---

### Mode 4: No Lenses (lens: undefined or omitted)

**Use when**: Lenses are not needed for this mesh

```json
{
  "frontmatter": {
    "self-modify": true
    // lens omitted
  }
}
```

**Result**: Agent sees:
```
Lenses not enabled for this mesh. Set `frontmatter.lens` in mesh config to enable.
```

## Tag Reference

Current tags in the lens index:

| Tag | Lenses Using This Tag |
|-----|----------------------|
| security | security-audit |
| threat-modeling | security-audit |
| validation | security-audit, edge-cases |
| owasp | security-audit |
| testing | edge-cases |
| robustness | edge-cases |
| qa | edge-cases |
| performance | performance |
| optimization | performance |
| profiling | performance |
| benchmarking | performance |
| clean-code | maintainability |
| solid | maintainability |
| refactoring | maintainability |
| architecture | maintainability |
| ux | user-experience |
| usability | user-experience |
| design | user-experience |
| accessibility | user-experience |
| analysis | critical-analysis |
| critique | critical-analysis |
| logic | critical-analysis |
| reasoning | critical-analysis |
| creativity | creative-exploration |
| innovation | creative-exploration |
| brainstorming | creative-exploration |
| exploration | creative-exploration |
| simplicity | cost-optimization |
| efficiency | cost-optimization |
| minimalism | cost-optimization |
| pragmatism | cost-optimization |

## Use Cases

### Code Review Mesh

Focus on code quality concerns:

```json
{
  "mesh": "code-review",
  "frontmatter": {
    "self-modify": true,
    "lens": ["maintainability", "security-audit", "performance"]
  }
}
```

Agent can choose between maintainability, security, and performance perspectives.

---

### Security Audit Mesh

Only security-related lenses:

```json
{
  "mesh": "security-audit",
  "frontmatter": {
    "self-modify": true,
    "lens": "security"
  }
}
```

Agent only sees `security-audit` lens.

---

### Creative Brainstorming Mesh

Creative and analytical lenses:

```json
{
  "mesh": "brainstorm",
  "frontmatter": {
    "self-modify": true,
    "lens": ["creative-exploration", "critical-analysis"]
  }
}
```

Agent can alternate between creative and critical perspectives.

---

### Research Mesh

All lenses for comprehensive analysis:

```json
{
  "mesh": "research",
  "frontmatter": {
    "self-modify": true,
    "lens": true
  }
}
```

Agent has access to all perspectives for thorough research.

---

### Optimization Focus

Tag filtering for optimization-related lenses:

```json
{
  "mesh": "optimizer",
  "frontmatter": {
    "self-modify": true,
    "lens": ["optimization", "efficiency"]
  }
}
```

Agent sees lenses tagged with optimization OR efficiency.

## How Detection Works

The system uses the following logic to determine mode:

1. **Check if `lens` is `true`** → Mode 1 (all lenses)
2. **Check if `lens` is string or array**:
   - If any value doesn't match a lens name → Mode 2 (tag filtering)
   - If all values match lens names → Mode 3 (explicit list)
3. **Otherwise** → Mode 4 (no lenses)

### Example Detection

```javascript
// lens: true
→ Mode 1: All lenses

// lens: "security"
→ "security" is a tag, not a lens name
→ Mode 2: Tag filtering

// lens: ["security", "performance"]
→ "security" and "performance" are tags
→ Mode 2: Tag filtering

// lens: ["security-audit", "performance"]
→ Both are valid lens names
→ Mode 3: Explicit list

// lens: undefined
→ Mode 4: No lenses
```

## Adding Custom Lenses

Add to `meshes/prompts/lenses/index.json`:

```json
{
  "lenses": {
    "database-optimization": {
      "role": "Optimize database queries, indexes, and schema design.",
      "tags": ["database", "optimization", "sql", "performance"]
    }
  }
}
```

Immediately available via:
- `lens: true` (all lenses)
- `lens: "database"` (tag filtering)
- `lens: ["database-optimization"]` (explicit)

## Best Practices

1. **Start broad, refine later**: Use `lens: true` initially, then restrict based on actual usage

2. **Use tag filtering for domains**: Group related concerns with tags
   ```json
   "lens": ["security", "validation"]
   ```

3. **Use explicit lists for workflows**: Define exact lens progression
   ```json
   "lens": ["edge-cases", "performance", "maintainability"]
   ```

4. **Document lens choices**: Comment in mesh config why specific lenses were chosen

5. **Consistent tags**: When adding lenses, use existing tags where possible

## Examples in Practice

### Evolver Mesh (All Lenses)

```json
{
  "mesh": "evolver",
  "frontmatter": {
    "self-modify": true,
    "lens": true,
    "max-iterations": 5
  }
}
```

Agent can apply any lens across iterations for comprehensive analysis.

### Security Scanner (Tag Filtering)

```json
{
  "mesh": "security-scanner",
  "frontmatter": {
    "self-modify": true,
    "lens": ["security", "validation"],
    "max-iterations": 3
  }
}
```

Agent focuses on security and validation lenses only.

### TDD Refactor (Explicit Lenses)

```json
{
  "mesh": "tdd-refactor",
  "frontmatter": {
    "self-modify": true,
    "lens": ["edge-cases", "maintainability", "performance"],
    "max-iterations": 3
  }
}
```

Agent follows a specific lens progression: edge cases → maintainability → performance.

## Troubleshooting

### Lens not appearing

**Problem**: Specified a lens but agent doesn't see it

**Solution**: Check spelling - lens names must match exactly
```json
// Wrong
"lens": ["security-check"]  // ✗ Doesn't exist

// Correct
"lens": ["security-audit"]  // ✓
```

### Tag filtering not working

**Problem**: Tag filter returns no lenses

**Solution**: Check tag exists in lens index
```bash
# View all tags
node -e "
const fs = require('fs-extra');
fs.readJson('meshes/prompts/lenses/index.json').then(idx => {
  const tags = new Set();
  Object.values(idx.lenses).forEach(lens =>
    lens.tags.forEach(tag => tags.add(tag))
  );
  console.log([...tags].sort());
});
"
```

### Ambiguous mode detection

**Problem**: Want tag filtering but system thinks it's explicit list

**Solution**: Use a tag that doesn't match any lens name
```json
// Ambiguous (both are valid lens names)
"lens": ["performance", "maintainability"]  // → Explicit list

// Clear (uses tag)
"lens": ["optimization", "refactoring"]  // → Tag filtering
```

## Reference

### Lens Index Location
```
meshes/prompts/lenses/index.json
```

### Test Lens Filtering
```bash
node test-lens-filtering.js
```

### Mesh Config Location
```
meshes/mesh-configs/{mesh-name}.json
```
