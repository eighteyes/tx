# Custom Mesh Example

Learn how to create your own mesh from scratch with custom agents and workflows.

---

## What You'll Learn

- Mesh configuration structure
- Agent prompt creation
- Routing rule design
- Capability integration
- Testing and debugging

---

## Scenario

Create a **"blog-writer"** mesh that:
1. Researches a topic
2. Generates an outline
3. Writes content
4. Reviews and refines

---

## Step 1: Design the Workflow

### Agents
- **researcher**: Gathers information on topic
- **outliner**: Creates structured outline
- **writer**: Generates blog content
- **reviewer**: Reviews and suggests improvements

### Workflow Topology
Sequential: researcher → outliner → writer → reviewer → core

---

## Step 2: Create Mesh Configuration

Create `meshes/mesh-configs/blog-writer.json`:

```json
{
  "mesh": "blog-writer",
  "type": "sequential",
  "description": "Multi-stage blog writing workflow with research, outlining, writing, and review",
  "agents": [
    "researcher",
    "outliner",
    "writer",
    "reviewer"
  ],
  "entry_point": "researcher",
  "completion_agent": "reviewer",
  "capabilities": ["search"],
  "workflow_topology": "sequential",
  "routing": {
    "researcher": {
      "complete": {
        "outliner": "Research complete, proceed to outlining"
      },
      "insufficient-sources": {
        "core": "Cannot find enough information on this topic"
      }
    },
    "outliner": {
      "complete": {
        "writer": "Outline approved, proceed to writing"
      },
      "blocked": {
        "core": "Need clarification on outline structure"
      }
    },
    "writer": {
      "complete": {
        "reviewer": "Draft complete, ready for review"
      },
      "blocked": {
        "core": "Need additional guidance on tone/style"
      }
    },
    "reviewer": {
      "complete": {
        "core": "Blog post complete and reviewed"
      },
      "revisions-needed": {
        "writer": "Revisions requested"
      },
      "needs-more-research": {
        "researcher": "Additional research required"
      }
    }
  }
}
```

---

## Step 3: Create Agent Prompts

### Researcher Agent

Create `meshes/agents/blog-writer/researcher/prompt.md`:

```markdown
# Researcher Agent - Blog Writer Mesh

## Your Role

Research the given topic and gather high-quality sources.

## Capabilities

You have access to:
- `tx tool search` - Multi-source search

## Tasks

1. **Understand topic**: Parse the blog topic request
2. **Search multiple sources**: Use search capability
   - Academic sources (arxiv, scholar)
   - Community discussions (reddit, hackernews)
   - Technical docs (stackoverflow, github)
3. **Evaluate sources**: Rate relevance and quality
4. **Compile findings**: Create structured research document

## Output Format

Write to your workspace: `research-findings.md`

Then send message to outliner:

\```markdown
---
to: blog-writer/outliner
from: blog-writer/researcher
type: task
status: start
msg-id: [generate-unique-id]
headline: Research complete for [topic]
timestamp: [ISO-8601]
---

# Research Complete

**Topic:** [topic]
**Sources Found:** [number]
**Quality:** [high/medium/low]

## Key Findings

1. [Finding 1]
2. [Finding 2]
3. [Finding 3]

## Recommended Sources

- [Source 1 with URL]
- [Source 2 with URL]

**Research document:** @workspace/research-findings.md
\```

## Decision Points

- If < 3 quality sources found → route to core with "insufficient-sources"
- If >= 3 quality sources found → route to outliner with "complete"
```

### Outliner Agent

Create `meshes/agents/blog-writer/outliner/prompt.md`:

```markdown
# Outliner Agent - Blog Writer Mesh

## Your Role

Create a structured outline based on research findings.

## Input

You'll receive research findings from researcher agent.

## Tasks

1. **Read research**: Review @workspace/research-findings.md
2. **Identify structure**: Determine sections and flow
3. **Create outline**: Build hierarchical outline
4. **Validate completeness**: Ensure all key points covered

## Output Format

Write to workspace: `outline.md`

Then send message to writer:

\```markdown
---
to: blog-writer/writer
from: blog-writer/outliner
type: task
status: start
msg-id: [generate-unique-id]
headline: Outline ready for [topic]
---

# Outline Complete

**Topic:** [topic]
**Sections:** [number]
**Target Length:** [words]

## Outline

@workspace/outline.md

## Writing Instructions

- Tone: [formal/conversational/technical]
- Audience: [beginner/intermediate/expert]
- Focus: [primary focus area]
\```
```

### Writer Agent

Create `meshes/agents/blog-writer/writer/prompt.md`:

```markdown
# Writer Agent - Blog Writer Mesh

## Your Role

Write blog content following the outline and research.

## Input

- Research: @workspace/research-findings.md
- Outline: @workspace/outline.md

## Tasks

1. **Review materials**: Read research and outline
2. **Write draft**: Follow outline structure
3. **Cite sources**: Include references
4. **Format properly**: Use markdown

## Output Format

Write to workspace: `blog-draft.md`

Then send message to reviewer:

\```markdown
---
to: blog-writer/reviewer
from: blog-writer/writer
type: task
status: start
msg-id: [generate-unique-id]
headline: Draft ready for review
---

# Draft Complete

**Word Count:** [number]
**Sections:** [completed/total]

## Draft

@workspace/blog-draft.md

Ready for review.
\```

## Guidelines

- Clear, engaging writing
- Use examples where appropriate
- Break up long paragraphs
- Include code blocks for technical content
- Add links to sources
```

### Reviewer Agent

Create `meshes/agents/blog-writer/reviewer/prompt.md`:

```markdown
# Reviewer Agent - Blog Writer Mesh

## Your Role

Review blog draft and provide feedback or approval.

## Review Criteria

1. **Accuracy**: Facts match research
2. **Clarity**: Writing is clear and accessible
3. **Structure**: Follows outline logic
4. **Completeness**: All sections covered
5. **Quality**: Grammar, style, flow

## Decision Points

### If Approved (score >= 8/10):

\```markdown
---
to: core/core
from: blog-writer/reviewer
type: task-complete
status: complete
msg-id: [generate-unique-id]
headline: Blog post complete
---

# Blog Post Ready

**Quality Score:** [X/10]
**Word Count:** [number]

## Final Post

@workspace/blog-draft.md

## Strengths
- [Strength 1]
- [Strength 2]

## Minor Suggestions (optional)
- [Suggestion 1]
- [Suggestion 2]

Ready for publication.
\```

### If Revisions Needed (score 6-7/10):

Route to writer with specific feedback.

### If Major Issues (score < 6/10):

Route to researcher if content gaps found.

## Output

Write review to: `workspace/review-feedback.md`
```

---

## Step 4: Test the Mesh

### 1. Validate Configuration

```bash
# Check JSON is valid
cat meshes/mesh-configs/blog-writer.json | jq .

# Check all agent prompts exist
ls meshes/agents/blog-writer/*/prompt.md
```

### 2. Spawn the Mesh

```bash
tx start
```

Inside core:
```
spawn blog-writer mesh for topic: "Getting Started with TDD in JavaScript"
```

### 3. Watch Progress

```bash
# In another terminal
tx status
```

You'll see agents activate sequentially:
```
Active Meshes:
  🟡 blog-writer-abc123 (sequential)
     Current agent: researcher
     Progress: 1/4 agents
```

### 4. Monitor Messages

```bash
# Watch researcher
tail -f .ai/tx/mesh/blog-writer-abc123/agents/researcher/workspace/research-findings.md

# Watch outline
tail -f .ai/tx/mesh/blog-writer-abc123/agents/outliner/workspace/outline.md

# Watch draft
tail -f .ai/tx/mesh/blog-writer-abc123/agents/writer/workspace/blog-draft.md
```

---

## Step 5: Review Output

### Final Blog Post

```bash
cat .ai/tx/mesh/blog-writer-abc123/agents/writer/workspace/blog-draft.md
```

### Review Feedback

```bash
cat .ai/tx/mesh/blog-writer-abc123/agents/reviewer/workspace/review-feedback.md
```

---

## Customization Ideas

### Add HITL Review

Add human approval before publishing:

```json
{
  "reviewer": {
    "complete": {
      "human-approver": "Ready for human review"
    }
  },
  "human-approver": {
    "approved": {
      "core": "Blog approved for publication"
    },
    "rejected": {
      "writer": "Revisions requested"
    }
  }
}
```

### Add SEO Optimizer

Insert between writer and reviewer:

```json
{
  "writer": {
    "complete": {
      "seo-optimizer": "Draft ready for SEO optimization"
    }
  },
  "seo-optimizer": {
    "complete": {
      "reviewer": "SEO optimization complete"
    }
  }
}
```

### Add Parallel Fact-Checking

During review, spawn fact-checker in parallel:

```json
{
  "workflow_topology": "hybrid",
  "reviewer": {
    "distribute": {
      "fact-checker": "Verify facts",
      "grammar-checker": "Check grammar"
    }
  }
}
```

---

## Advanced: Capability Integration

### Add Web Scraping

1. Create capability prompt: `meshes/prompts/capabilities/scrape/capability.md`

2. Add to mesh config:
```json
{
  "capabilities": ["search", "scrape"]
}
```

3. Use in researcher agent:
```markdown
Use `tx tool get-www <url>` to fetch and parse web content.
```

---

## Testing

### Unit Test: Single Agent

```bash
# Test researcher in isolation
tx spawn blog-writer

# Send test message
cat > .ai/tx/mesh/blog-writer-test/agents/researcher/inbox/test-msg.md <<EOF
---
to: blog-writer-test/researcher
from: core/core
type: task
---

Research topic: "Docker fundamentals"
EOF

# Watch output
tx attach blog-writer-test
```

### Integration Test: Full Mesh

```bash
# Create test script
# test/e2e/test-blog-writer.js

import { spawn, waitForCompletion } from 'tx-test-utils';

async function testBlogWriter() {
  const mesh = await spawn('blog-writer');

  await mesh.sendTask({
    agent: 'researcher',
    content: 'Research topic: "Test-driven development"'
  });

  const result = await waitForCompletion(mesh, { timeout: 600000 });

  // Assertions
  assert(result.status === 'complete');
  assert(result.workspace['blog-draft.md'].length > 1000);
}
```

---

## Deployment

### Add to Production

1. Commit mesh files:
```bash
git add meshes/mesh-configs/blog-writer.json
git add meshes/agents/blog-writer/
git commit -m "feat: Add blog-writer mesh"
```

2. Share with team:
```bash
# Team members pull and install
git pull
tx repo-install
tx list  # blog-writer now available
```

---

## Best Practices

1. **Start simple**: Begin with 2-3 agents, add complexity iteratively
2. **Clear routing**: Every agent should have "complete" and "blocked" routes
3. **Workspace organization**: Use consistent file names across agents
4. **Error handling**: Always provide escape routes to core
5. **Documentation**: Keep agent prompts clear and detailed
6. **Testing**: Test each agent individually before full mesh
7. **Versioning**: Track mesh config versions in git
8. **Monitoring**: Watch first few runs, refine prompts based on behavior

---

## Common Patterns

### Fan-Out (Parallel)
```json
{
  "workflow_topology": "fan-out",
  "coordinator": {
    "distribute": {
      "worker-1": "Task 1",
      "worker-2": "Task 2",
      "worker-3": "Task 3"
    }
  }
}
```

### Iterative Loop
```json
{
  "worker": {
    "complete": {
      "reviewer": "Work done"
    }
  },
  "reviewer": {
    "approved": {
      "core": "Final approval"
    },
    "revise": {
      "worker": "Needs revision"
    }
  }
}
```

### HITL Checkpoint
```json
{
  "agent": {
    "needs-approval": {
      "core": "Waiting for human decision"
    }
  }
}
```

---

## Next Steps

- **[Architecture Guide](../../new/architecture.md)** - Deep dive into TX architecture
- **[Message System](../../new/messages.md)** - Master agent communication
- **[Available Meshes](../../new/meshes.md)** - Study existing meshes for patterns

---

## Troubleshooting

### Issue: Agent not routing correctly

```bash
# Validate routing logic
cat meshes/mesh-configs/blog-writer.json | jq .routing

# Check agent sent correct status
grep "status:" .ai/tx/mesh/blog-writer-*/agents/*/msgs/*.md

# View routing logs
tx logs debug | grep routing
```

### Issue: Agent stuck

```bash
# Attach and observe
tx attach blog-writer

# Check for errors
tx logs error | grep blog-writer

# Manual intervention
# Send message to unstuck agent or route to core
```

---

**Questions?** See [Troubleshooting Guide](../../new/troubleshooting.md)
