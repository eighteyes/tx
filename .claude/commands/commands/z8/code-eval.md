---
allowed-tools:
- Glob(*)
- Read(*)
- Write(*)
- Bash(find *)
- Bash(wc *)
- Bash(cloc *)
- mcp__zen__analyze(*)
- TodoWrite(*)
description: Evaluate AI-generated code using comprehensive software engineering framework
  and generate model performance report
permalink: commands/z8/code-eval
---

## Context
Target directory: `$ARGUMENTS` (defaults to current directory if not specified)

## Your task

Create a comprehensive code evaluation report by analyzing all code files in the specified directory using established software engineering evaluation frameworks.

### Evaluation Framework

Apply the following weighted scoring system to each code submission:

**Core Dimensions:**
1. **Functional Correctness (30%)** - Does the code work? Meets requirements? Handles edge cases?
2. **Code Quality (25%)** - Readability, maintainability, following best practices
3. **Architecture & Design (20%)** - Structure, patterns, modularity, scalability considerations
4. **Security & Robustness (15%)** - Input validation, error handling, security vulnerabilities
5. **Performance & Efficiency (10%)** - Time/space complexity, optimization, resource usage

**Scoring Scale:** 1-5 points per dimension (5 = production-ready, 1 = broken/unusable)

### Specialized Coding Roles

Evaluate each code submission for these specialized roles:

- **🎯 Problem Solver** - Understanding requirements, implementing correct logic
- **🏗️ Architect** - System design, component organization, scalability
- **🔒 Security Engineer** - Vulnerability assessment, secure coding practices
- **⚡ Performance Engineer** - Optimization, efficiency, algorithmic complexity
- **📚 Documentation Writer** - Comments, docstrings, README quality
- **🧪 Test Engineer** - Test coverage, test quality, edge case handling
- **🔧 Debugging Specialist** - Error handling, logging, fault tolerance
- **♻️ Refactoring Expert** - Code cleanup, pattern implementation, maintainability
- **🌐 Integration Specialist** - API design, external service interaction
- **🔗 Code Coordinator** - Best overall development team lead

### Code Analysis Process

1. **Use Glob** to find all code files (*.py, *.js, *.java, *.cpp, *.go, *.rs, etc.)
2. **Read each file** and extract code content
3. **Run basic static analysis** where possible (syntax check, line counts)
4. **Analyze for functionality** - Does it solve the given problem?
5. **Evaluate code quality** - Style, readability, maintainability
6. **Security assessment** - Look for common vulnerabilities
7. **Performance analysis** - Algorithm efficiency, optimization opportunities
8. **Generate code-model-report.md** with comprehensive analysis

### Report Structure

```markdown
# Code Model Evaluation Report

## Executive Summary
- Total models evaluated: [N]
- **Recommended Code Coordinator**: [Model] (Best overall development lead)
- Top performing model: [Name] (Score: X.X/5.0)
- Average score across all models: [X.X/5.0]
- Total lines of code analyzed: [N]

## Top Performers by Coding Role

**🎯 Problem Solver**: [Model] (X.X/5.0)
- [Brief description of problem-solving strengths]

**🏗️ Architect**: [Model] (X.X/5.0)
- [Brief description of architectural strengths]

[...continue for all roles]

## Overall Rankings
1. [Model Name] - X.X/5.0 ([LOC] lines)
2. [Model Name] - X.X/5.0 ([LOC] lines)
[...etc]

## Top 3 Model Detailed Analysis

### 1. [Model Name] (X.X/5.0)
**Strengths:** [Key coding strengths]
**Weaknesses:** [Areas for improvement]
**Best Roles:** [Which coding roles this model excels at]
**Code Quality Notes:** [Specific observations about style, patterns]
**Sample:** [Code snippet with analysis]

### 2. [Model Name] (X.X/5.0)
[Similar format]

### 3. [Model Name] (X.X/5.0)
[Similar format]

## Code Coordinator Recommendation
[Analysis of best overall development team coordinator]

## Team Assignment Recommendations
- **Code Coordinator**: [Model]
- **Lead Architect**: [Model]
- **Security Lead**: [Model]
- **Performance Specialist**: [Model]
- **QA/Test Lead**: [Model]
- **Documentation Lead**: [Model]

## Security Vulnerability Summary
[Summary of common security issues found across models]

## Performance Analysis
[Analysis of algorithmic efficiency and optimization patterns]

## Key Findings
[Summary of important insights about AI coding capabilities]

## Methodology
- Framework: 5 core dimensions + 10 specialized roles
- Static analysis tools used: [List any tools]
- Manual code review: Line-by-line analysis
- Total files analyzed: [N]
- Evaluation date: [Date]
```

### Evaluation Criteria Details

**Functional Correctness:**
- Does the code compile/run without errors?
- Does it solve the stated problem correctly?
- Are edge cases and error conditions handled?
- Is the logic sound and complete?

**Code Quality:**
- Readable variable/function names
- Consistent formatting and style
- Appropriate comments and documentation
- Following language-specific best practices
- DRY (Don't Repeat Yourself) principle
- SOLID principles adherence

**Architecture & Design:**
- Appropriate use of design patterns
- Separation of concerns
- Modularity and reusability
- Scalability considerations
- Maintainable structure

**Security & Robustness:**
- Input validation and sanitization
- SQL injection prevention
- XSS protection (for web code)
- Buffer overflow prevention
- Proper error handling
- Resource cleanup

**Performance & Efficiency:**
- Algorithmic time complexity
- Space complexity optimization
- Database query efficiency
- Network request optimization
- Caching strategies

### Important Notes

- Test code functionality where possible (compile/run basic tests)
- Look for common anti-patterns and code smells
- Evaluate documentation quality and completeness
- Consider production-readiness and enterprise standards
- Assess code for different experience levels (junior vs senior developer output)
- Focus on practical software engineering excellence
- Consider maintainability over cleverness