# TX Documentation Index

Complete guide to TX - Claude Orchestration for Augmented Workflows

---

## 📚 Core Documentation

### [Getting Started](./getting-started.md)
**Start here!** Complete setup guide from installation to your first mesh.

**Covers:**
- Prerequisites (Node.js, tmux, Claude Code)
- Installation steps
- Configuration (.env setup)
- First mesh spawn
- Understanding output
- Troubleshooting first-run issues

**Time:** 15-20 minutes

---

### [Commands Reference](./commands.md)
Complete CLI command documentation with examples.

**Sections:**
- User commands (`start`, `attach`, `status`, `stop`, `list`)
- Agent commands (`spawn`, `tool search`, `tool get-www`, `watch`)
- Developer commands (`logs`, `prompt`, `repo-install`)
- Command patterns and options

**Use when:** You need to know "how do I...?" for any TX command

---

### [Message System](./messages.md)
How agents communicate through file-based messages.

**Covers:**
- Stay-in-place architecture
- Message format (frontmatter + markdown)
- Message types (`ask`, `task`, `update`, etc.)
- Routing rules
- Message lifecycle
- Debugging messages

**Use when:** You're creating custom meshes or debugging workflows

---

### [Available Meshes](./meshes.md)
Catalog of all 18+ production-ready meshes.

**Meshes Documented:**
- **core** - Coordinator
- **brain** - Knowledge keeper
- **planner** - MAP architecture
- **deep-research** - HITL research
- **code-review** - Parallel code review
- **tdd-cycle** - Red-Green-Refactor
- **gtm-strategy** - Go-to-market
- **risk-experiment** - Risk reduction
- **hitl-3qa** - Requirements gathering
- And more...

**Use when:** Choosing the right mesh for your task

---

### [Architecture](./architecture.md)
System design, components, and technical deep-dive.

**Covers:**
- System overview and components
- Stay-in-place messaging architecture
- Mesh lifecycle
- Message flow
- File watcher system
- Routing system
- Capability system
- Security model
- Directory structure

**Use when:** Understanding how TX works under the hood

---

### [Troubleshooting](./troubleshooting.md)
Common issues and their solutions.

**Sections:**
- Installation issues
- Spawn issues
- Message issues
- Tmux issues
- Performance issues
- Configuration issues
- Debugging techniques
- Clean slate / reset

**Use when:** Something isn't working as expected

---

## 💡 Examples

### [Hello World](../examples/hello-world/)
**Difficulty:** Beginner
**Time:** 10 minutes

The simplest possible mesh - an echo agent that responds to messages.

**Learn:**
- Mesh configuration basics
- Agent prompt creation
- Message routing
- Testing a mesh

**Perfect for:** First-time mesh creators

---

### [Error Monitoring](../examples/error-monitoring/)
**Difficulty:** Intermediate
**Time:** 20 minutes

Watch error logs and automatically fix issues using the `tx watch` capability.

**Learn:**
- File watching with delta tracking
- Background mesh operation
- Multi-agent coordination (analyzer + fixer)
- Auto-fix workflows

**Perfect for:** Development automation

---

### [Code Review](../examples/code-review/)
**Difficulty:** Intermediate
**Time:** 30 minutes

Parallel code review with 4 specialized analyzers.

**Learn:**
- Parallel (fan-out) topology
- Coordinator pattern
- Report aggregation
- Multi-perspective analysis

**Perfect for:** Understanding parallel workflows

---

### [Custom Mesh](../examples/custom-mesh/)
**Difficulty:** Advanced
**Time:** 45 minutes

Build a complete blog-writer mesh from scratch.

**Learn:**
- Full mesh design process
- Sequential workflow
- Capability integration
- Testing strategies
- Best practices

**Perfect for:** Creating production meshes

---

## 🎯 Quick Reference

### Installation
```bash
npm install -g tx-cli
tx start
```

### Common Commands
```bash
tx start                    # Launch TX
tx spawn brain              # Start brain mesh
tx attach brain             # Watch brain work
tx status                   # View active meshes
tx stop                     # Stop all meshes
```

### Common Issues
- **tmux not found** → Install tmux: `brew install tmux`
- **claude not found** → Install: `npm install -g @anthropic-ai/claude-code`
- **Mesh not spawning** → Check: `tx logs error`
- **Message not routing** → Validate frontmatter YAML

---

## 📖 Documentation Structure

```
docs/
├── new/
│   ├── INDEX.md               ← You are here
│   ├── getting-started.md     ← Start here for setup
│   ├── commands.md            ← Command reference
│   ├── messages.md            ← Agent communication
│   ├── meshes.md              ← Available meshes
│   ├── architecture.md        ← Technical deep-dive
│   └── troubleshooting.md     ← Problem solving
└── examples/
    ├── hello-world/           ← Beginner: Simple echo
    ├── error-monitoring/      ← Intermediate: File watching
    ├── code-review/           ← Intermediate: Parallel workflow
    └── custom-mesh/           ← Advanced: Full mesh creation
```

---

## 🚀 Learning Paths

### Path 1: Quick Start (30 minutes)
1. [Getting Started](./getting-started.md) - Setup
2. [Hello World Example](../examples/hello-world/) - First mesh
3. [Available Meshes](./meshes.md) - Explore options

**Goal:** Get TX running and spawn your first mesh

---

### Path 2: Practical Usage (1-2 hours)
1. [Getting Started](./getting-started.md)
2. [Commands Reference](./commands.md)
3. [Error Monitoring Example](../examples/error-monitoring/)
4. [Code Review Example](../examples/code-review/)
5. [Available Meshes](./meshes.md)

**Goal:** Use TX for real development workflows

---

### Path 3: Mesh Development (2-3 hours)
1. [Getting Started](./getting-started.md)
2. [Message System](./messages.md)
3. [Architecture](./architecture.md)
4. [Custom Mesh Example](../examples/custom-mesh/)
5. [Troubleshooting](./troubleshooting.md)

**Goal:** Create custom meshes for your needs

---

### Path 4: Deep Understanding (3-4 hours)
1. [Getting Started](./getting-started.md)
2. [Architecture](./architecture.md)
3. [Message System](./messages.md)
4. [All Examples](../examples/)
5. [Commands Reference](./commands.md)
6. [Available Meshes](./meshes.md)
7. [Troubleshooting](./troubleshooting.md)

**Goal:** Master TX internals and advanced patterns

---

## 🔗 External Resources

- **[Main README](../../README.md)** - Project overview
- **[CLAUDE.md](../../CLAUDE.md)** - TX internal instructions
- **[DOCKER.md](../../DOCKER.md)** - Docker deployment
- **[GitHub Issues](https://github.com/your-repo/tx-cli/issues)** - Report bugs
- **[GitHub Discussions](https://github.com/your-repo/tx-cli/discussions)** - Ask questions

---

## 📝 Contributing to Docs

Found an error or want to improve documentation?

1. **Fork the repo**
2. **Edit docs** in `docs/new/` or `docs/examples/`
3. **Test your changes** (spawn meshes, run examples)
4. **Submit PR** with clear description

**Documentation standards:**
- Use markdown formatting
- Include code examples
- Add troubleshooting tips
- Keep it beginner-friendly
- Update INDEX.md if adding new docs

---

## 🎓 Additional Topics

### For Developers
- **Testing meshes:** `npm test`
- **E2E tests:** `npm run test:e2e`
- **Debugging:** `tx logs debug -f`

### For Contributors
- **Project structure:** See [Architecture](./architecture.md)
- **Adding meshes:** See [Custom Mesh Example](../examples/custom-mesh/)
- **Code style:** Follow existing patterns

### For DevOps
- **Docker deployment:** See [DOCKER.md](../../DOCKER.md)
- **CI/CD integration:** See [Code Review Example](../examples/code-review/)
- **Monitoring:** Use `tx status` and log files

---

## 🆘 Getting Help

### Search Documentation
Use your browser's search (Ctrl+F / Cmd+F) on:
- This INDEX page - Find the right document
- Individual doc pages - Find specific information

### Check Examples
Most questions are answered in [examples/](../examples/)

### Troubleshooting First
Check [Troubleshooting Guide](./troubleshooting.md) before asking

### Community Support
- **[GitHub Issues](https://github.com/your-repo/issues)** - Bugs and feature requests
- **[GitHub Discussions](https://github.com/your-repo/discussions)** - Questions and ideas
- **[Discord](https://discord.gg/your-invite)** - Real-time chat (if available)

---

## 📈 Documentation Roadmap

### Coming Soon
- Video tutorials
- Interactive playground
- API reference
- Plugin development guide
- Performance tuning guide

### Want to Help?
Contributions welcome! See [Contributing Guide](../../CONTRIBUTING.md)

---

**Last Updated:** 2025-10-30

**Questions?** [Open an issue](https://github.com/your-repo/issues/new)
