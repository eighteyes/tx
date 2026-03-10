---
allowed-tools:
- Bash(*)
- Read(*)
- Grep(*)
- WebSearch(*)
- Write(*)
description: Run existing security and quality tools based on project type
permalink: commands/lb/audit
---

## Context

**Project type**: !`find . -name "package.json" -o -name "requirements.txt" -o -name "Cargo.toml" -o -name "go.mod" -o -name "pom.xml" | head -1`

**Available tools**: !`which npm eslint bandit flake8 safety radon xenon cppcheck clang-tidy lizard gocyclo tokei 2>/dev/null | head -15`

**Dependencies**: !`find . -name "package-lock.json" -o -name "yarn.lock" -o -name "requirements.txt" -o -name "Cargo.lock" -o -name "go.sum" | head -3`

## Your task

Run existing security and quality tools based on detected project type. Arguments: $ARGUMENTS

### Tool Detection and Execution

**JavaScript/TypeScript Projects:**
```bash
# Dependency vulnerabilities
npm audit || yarn audit

# Security linting
eslint . --ext .js,.ts --config .eslintrc.js || npx eslint . --ext .js,.ts

# Code quality
npx jshint . || echo "jshint not available"

# Complexity analysis
npx complexity-report src/ || echo "complexity-report not available"
```

**Python Projects:**
```bash
# Security scanning
bandit -r . -f json || echo "bandit not installed"

# Dependency vulnerabilities  
safety check || pip-audit || echo "safety/pip-audit not available"

# Code quality
flake8 . || echo "flake8 not installed"
pylint . || echo "pylint not installed"

# Complexity analysis
radon cc . || echo "radon not installed"
xenon --max-absolute B --max-modules B . || echo "xenon not installed"
```

**C/C++ Projects:**
```bash
# Static analysis
cppcheck --enable=all --inconclusive . || echo "cppcheck not available"

# Clang static analyzer
clang-tidy *.cpp *.c || echo "clang-tidy not available"

# Complexity analysis
lizard . || echo "lizard not installed"
```

**Rust Projects:**
```bash
# Security audit
cargo audit || echo "cargo-audit not installed"

# Code quality
cargo clippy -- -D warnings || echo "clippy not available"

# Complexity analysis
tokei . || echo "tokei not installed"
```

**Go Projects:**
```bash
# Security scanning
gosec ./... || echo "gosec not installed"

# Code quality
go vet ./... || echo "go vet failed"

# Complexity analysis
gocyclo . || echo "gocyclo not installed"
```

### Execution Process

1. **Detect project type** from package files
2. **Check for available tools** before running
3. **Run appropriate tools** for detected language
4. **Parse and summarize results** 
5. **Provide installation instructions** for missing tools

### Output Format

```
# Code Quality Report
Generated: [timestamp]
Project Type: [detected type]

## Tool Results

### [Tool Name] - [Status]
[Raw output or "Not available - install with: [command]"]

### [Tool Name] - [Status]  
[Raw output or "Not available - install with: [command]"]

## Summary
- Total issues found: X
- Critical: X
- Warnings: X
- Missing tools: X

## Next Steps
1. Install missing tools: [list]
2. Fix critical issues first
3. Address warnings incrementally
```

### Installation Suggestions

**Missing tools will trigger installation guidance:**
- `npm install -g eslint complexity-report` for JavaScript
- `pip install bandit safety radon xenon` for Python
- `apt-get install cppcheck && pip install lizard` for C/C++
- `cargo install cargo-audit tokei` for Rust
- `go install github.com/fzipp/gocyclo/cmd/gocyclo@latest` for Go

### Realistic Scope

This command:
- ✅ Runs existing, proven tools
- ✅ Detects project type automatically
- ✅ Handles missing tools gracefully
- ✅ Provides actionable output
- ❌ Doesn't claim to be comprehensive
- ❌ Doesn't invent security scores
- ❌ Doesn't promise manual review

Begin tool-based audit now.