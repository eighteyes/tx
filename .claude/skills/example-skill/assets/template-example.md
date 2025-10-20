# Template Example

This is an example template file that skills can use for generating output.

## Usage

Skills often need to generate files from templates. Store templates in `assets/` so they can be copied and customized.

## Message Template

```markdown
---
from: {from-agent}
to: {to-agent}
type: {message-type}
status: pending
msg-id: {unique-id}
timestamp: {iso-timestamp}
---

# Message Title

## Section 1

Your content here.

## Section 2

More content here.
```

## Document Template

```markdown
# Document Title

## Executive Summary

Brief overview.

## Details

- Point 1
- Point 2
- Point 3

## Next Steps

1. Action 1
2. Action 2
```

## How to Use

When a skill needs to generate output:

1. Load this template from `assets/template-example.md`
2. Replace placeholder variables (e.g., `{from-agent}`)
3. Write the filled template to output file
4. Return path/confirmation to user

Example in JavaScript:

```javascript
const fs = require('fs');
const template = fs.readFileSync('assets/template-example.md', 'utf-8');
const filled = template
  .replace('{from-agent}', 'agent-name')
  .replace('{to-agent}', 'target-agent');
fs.writeFileSync('output.md', filled);
```
