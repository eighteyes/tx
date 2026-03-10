---
allowed-tools:
- Read(*)
- Grep(*)
- LS(*)
- Bash(git *)
- Bash(find *)
- Bash(wc *)
- Write(*)
description: Research any project and create ai-summary.md (overview/progress) and
  ai-todo.md (granular checklist)
permalink: commands/prepare-project
---

## Context Analysis

**Project structure:** !`find . -type f -name "*.md" -o -name "*.txt" -o -name "*.json" -o -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.sh" -o -name "*.docx" -o -name "*.pdf" | grep -v node_modules | head -20`

**Recent git activity:** !`git log --oneline -10 2>/dev/null || echo "No git history available"`

**Current branch and status:** !`git branch --show-current 2>/dev/null && git status --porcelain 2>/dev/null || echo "No git repository"`

**Project files:** !`find . -maxdepth 2 -name "package.json" -o -name "Cargo.toml" -o -name "pyproject.toml" -o -name "go.mod" -o -name "pom.xml" -o -name "Makefile" -o -name "README*" -o -name "*.md" -o -name "*.txt" 2>/dev/null`

**Total files:** !`find . -type f | grep -v node_modules | grep -v .git | wc -l 2>/dev/null || echo "0"` files

## Your Task

You are a project analysis specialist. Your goal is to thoroughly research ANY type of project (code, writing, business, creative, research, etc.) and create two comprehensive output files for AI daily planning:

**Primary objective:** Create `ai-summary.md` and `ai-todo.md` based on project research and Q&A iterations.

**Additional context (if provided):** $ARGUMENTS

## Research Phase

**Step 1: Project Discovery**
- Read README files, documentation, and project descriptions
- Analyze project structure and identify main components/sections
- Review recent changes (git commits, file modifications, notes)
- Identify project type: code, writing, business, research, creative, etc.
- Look for planning documents, outlines, specifications, or requirements

**Step 2: Progress Assessment**
- Look for TODO comments, notes, or task lists
- Review drafts, work-in-progress, or incomplete sections
- Identify completed milestones and achievements
- Assess overall project maturity and current phase

**Step 3: Q&A Iteration**
- Ask clarifying questions about project goals and priorities
- Confirm understanding of current state and desired outcomes
- Identify missing information or areas needing more detail
- Understand timeline, deadlines, or target completion dates

## Output Requirements

**Create `ai-summary.md` with:**
- **Project Overview**: Brief description of what the project is about
- **Project Type**: Code, writing, business, research, creative, etc.
- **Current State**: What's completed, what's in progress
- **Recent Progress**: Summary of recent changes and developments
- **Structure/Organization**: High-level overview of how project is organized
- **Key Metrics**: Size indicators, complexity, scope
- **Status Assessment**: Overall project health and progress toward goals

**Create `ai-todo.md` with:**
- **Immediate Actions**: Critical tasks that need attention now
- **Core Work**: Main tasks advancing the project goals
- **Organization**: Structure, planning, and process improvements
- **Documentation**: Missing docs, outdated information, notes
- **Review/Quality**: Proofreading, testing, validation tasks
- **External**: Dependencies, collaborations, communications
- **Nice-to-Have**: Future enhancements and optional improvements

## Guidelines

- **Be thorough but concise**: Focus on actionable insights
- **Prioritize tasks**: Use priority indicators (High/Medium/Low)
- **Include context**: Add brief explanations for complex items
- **Make it actionable**: Each todo item should be clear and specific
- **Update iteratively**: Use Q&A to refine and improve outputs
- **Cross-reference**: Link related items between summary and todos
- **Adapt to project type**: Tailor analysis to the specific domain

Start with project discovery and then engage in Q&A to refine your understanding before creating the final outputs.