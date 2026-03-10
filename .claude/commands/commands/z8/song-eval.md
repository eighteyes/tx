---
allowed-tools:
- Glob(*)
- Read(*)
- Write(*)
- mcp__zen__analyze(*)
- TodoWrite(*)
description: Evaluate AI-generated songs using a comprehensive songwriting framework
  and generate model performance report
permalink: commands/z8/song-eval
---

## Context
Target directory: `$ARGUMENTS` (defaults to current directory if not specified)

## Your task

Create a comprehensive songwriting evaluation report by analyzing all song files in the specified directory using the established songwriting evaluation framework.

### Evaluation Framework

Apply the following weighted scoring system to each song:

**Core Dimensions:**
1. **Lyrical Content (25%)** - Meaning, storytelling, imagery, word choice, poetic quality
2. **Rhyme & Meter (20%)** - Rhyme scheme consistency, rhythm, flow, syllable count
3. **Song Structure (15%)** - Verse/chorus/bridge organization, logical progression
4. **Emotional Resonance (15%)** - Emotional authenticity, listener connection, impact
5. **Creativity & Originality (15%)** - Fresh perspectives, unique approaches, innovative elements
6. **Genre & Style (10%)** - Genre conventions, voice consistency, stylistic coherence

**Scoring Scale:** 1-5 points per dimension (5 = exceptional, 1 = poor)

### Specialized Songwriting Roles

Evaluate each song for these specialized writing roles:

- **🎤 Lyricist** - Word craft, meaning, poetic language
- **🎵 Melody Writer** - Rhythm, meter, musical flow compatibility
- **📖 Song Storyteller** - Narrative structure within songs
- **🎯 Hook Creator** - Memorable choruses, catchy phrases
- **💝 Emotional Architect** - Building emotional journey and authenticity
- **🏗️ Song Structurer** - Organizing verses, choruses, bridges effectively
- **🔤 Rhyme Engineer** - Technical rhyming skills and consistency
- **🎭 Theme Developer** - Deeper meanings and message coherence
- **🎨 Voice Stylist** - Distinctive vocal personality and style
- **🔗 Song Coordinator** - Best overall songwriting team lead

### Process

1. **Use Glob** to find all song files in the target directory (*.md, *.txt, *.lyrics)
2. **Read each file** and extract the song content
3. **Analyze each song** using the evaluation framework
4. **Generate comprehensive scores** for each dimension and specialized role
5. **Create song-model-report.md** with:
   - Executive summary with rankings
   - Top performers by songwriting role
   - Top 3 detailed model analysis
   - Song coordinator recommendation
   - Comparative analysis and insights
   - Methodology notes

### Report Structure

```markdown
# Songwriting Model Evaluation Report

## Executive Summary
- Total models evaluated: [N]
- **Recommended Song Coordinator**: [Model] (Best overall songwriting lead)
- Top performing model: [Name] (Score: X.X/5.0)
- Average score across all models: [X.X/5.0]

## Top Performers by Songwriting Role

**🎤 Lyricist**: [Model] (X.X/5.0)
- [Brief description of strengths]

**🎵 Melody Writer**: [Model] (X.X/5.0)
- [Brief description of strengths]

[...continue for all roles]

## Overall Rankings
1. [Model Name] - X.X/5.0
2. [Model Name] - X.X/5.0
[...etc]

## Top 3 Model Detailed Analysis

### 1. [Model Name] (X.X/5.0)
**Strengths:** [Key strengths in songwriting]
**Weaknesses:** [Areas for improvement]
**Best Roles:** [Which songwriting roles this model excels at]
**Sample:** *[Quote memorable lyric lines with commentary]*

### 2. [Model Name] (X.X/5.0)
[Similar format]

### 3. [Model Name] (X.X/5.0)
[Similar format]

## Song Coordinator Recommendation
[Analysis of best overall songwriting team coordinator]

## Role Assignment Recommendations
- **Song Coordinator**: [Model]
- **Lead Lyricist**: [Model]
- **Melody Specialist**: [Model]
- **Hook Writer**: [Model]
- **Emotional Designer**: [Model]
- **Structure Expert**: [Model]

## Key Findings
[Summary of important insights about AI songwriting capabilities]

## Methodology
- Framework: 6 core dimensions + 10 specialized roles
- Scoring: 1-5 scale with weighted averages
- Total songs analyzed: [N]
- Evaluation date: [Date]
```

### Important Notes

- Evaluate both technical craft (rhyme, meter) and artistic merit (emotion, meaning)
- Consider singability and how lyrics would work with music
- Quote specific lyrical examples to support scores
- Assess genre appropriateness and stylistic consistency
- Focus on constructive analysis for model improvement
- Maintain consistent evaluation criteria across all models
- Pay attention to hook memorability and emotional authenticity
- Consider both commercial and artistic songwriting values