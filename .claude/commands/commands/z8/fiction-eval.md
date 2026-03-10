---
allowed-tools:
- Glob(*)
- Read(*)
- Write(*)
- mcp__zen__analyze(*)
- TodoWrite(*)
description: Evaluate fiction stories using a comprehensive framework and generate
  a model performance report
permalink: commands/z8/fiction-eval
---

## Context
Target directory: `$ARGUMENTS` (defaults to current directory if not specified)

## Your task

Create a comprehensive fiction evaluation report by analyzing all story files in the specified directory using the established fiction evaluation framework.

### Evaluation Framework

Apply the following weighted scoring system to each story:

**Core Dimensions:**
1. **Narrative Structure (25%)** - Plot coherence, pacing, story arc, conflict resolution
2. **Character Development (20%)** - Character consistency, dialogue, motivation, growth
3. **Technical Craft (20%)** - Grammar, prose quality, show vs tell, descriptive language
4. **Creative Elements (15%)** - Originality, imagination, unexpected developments
5. **Emotional Engagement (10%)** - Reader connection, emotional resonance, tension
6. **Genre/Style Adherence (10%)** - Genre conventions, consistent tone, style choices

**Scoring Scale:** 1-5 points per dimension (5 = exceptional, 1 = poor)

### Process

1. **Use Glob** to find all story files in the target directory (*.md, *.txt)
2. **Read each file** and extract the story content
3. **Analyze each story** using the evaluation framework
4. **Generate comprehensive scores** for each dimension
5. **Create model-report.md** with:
   - Executive summary with rankings
   - Individual model analysis
   - Comparative strengths/weaknesses
   - Detailed scoring breakdown
   - Recommendations for improvement

### Report Structure

```markdown
# Fiction Model Evaluation Report

## Executive Summary
- Total models evaluated: [N]
- Top performing model: [Name] (Score: X.X/5.0)
- Average score across all models: [X.X/5.0]

## Rankings
1. [Model Name] - [Score]/5.0
2. [Model Name] - [Score]/5.0
[...etc]

## Individual Model Analysis
### [Model Name 1]
**Overall Score: X.X/5.0**
- Narrative Structure: X.X/5.0 (25%)
- Character Development: X.X/5.0 (20%)
- Technical Craft: X.X/5.0 (20%)
- Creative Elements: X.X/5.0 (15%)
- Emotional Engagement: X.X/5.0 (10%)
- Genre/Style Adherence: X.X/5.0 (10%)

**Strengths:** [Key strengths]
**Weaknesses:** [Areas for improvement]
**Sample Analysis:** [Quote key passages with commentary]

## Comparative Analysis
[Cross-model comparisons and insights]

## Methodology Notes
- Evaluation date: [Date]
- Number of stories: [N]
- Evaluation framework version: 1.0
```

### Important Notes

- Be thorough but fair in evaluation
- Quote specific examples from the stories to support scores
- Consider the intended audience and genre context
- Focus on constructive analysis that could guide model improvement
- Maintain consistent evaluation criteria across all models