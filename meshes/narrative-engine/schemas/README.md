# Narrative Engine Schemas

Canonical data formats for the narrative engine. All agents read these schemas to understand artifact structure.

## Overview

| Schema | File | Purpose |
|--------|------|---------|
| Entity | `entity.yaml` | Character definition — identity, psychology, appearance, backstory, habits, life, traits |
| Bond | `bond.yaml` | Relationship between two characters — 12-dimensional measurement system |
| Author | `author.yaml` | Prose voice, pacing, content permissions, interpretive frames |

## Entity Schema

Defines characters (protagonists and NPCs). Key sections:

| Section | Required | Description |
|---------|----------|-------------|
| `id`, `name`, `entity_type` | Yes | Identity — kebab-case id, structured name (first/surname) |
| `appearance` | Yes | Physical description including `visual_tags` for image generation |
| `foundation` | Yes | Psychological bedrock — ideology, function, shadow |
| `backstory` | No | Origin, escape, pattern, implication |
| `habits` | No | Substances/practices — each requires pattern, function, visibility |
| `life` | No | World beyond plot — concerns, expertise, social web, opinions, memories |
| `sexuality` | No | The gap between verbal comfort and physical reality |
| `traits` | Yes | Starting traits (pressure 1), evolved traits, wound/lie/wants/needs, voices |
| `hidden_past` | No | Secrets, criminal history — incident, knowledge, pattern, implications |
| `layers` | Yes | Progressive disclosure — first_glance, familiar, intimate |
| `episodes` | No | Brief event log (scribe-maintained) |
| `current_state` | No | Armor/vulnerability status (scribe-maintained) |
| `bonds` | No | List of bond entity IDs |

### Entity Validation

- `name.first` and `name.surname` required (surname must not be from forbidden AI-default list)
- `appearance.visual_tags`: 10-25 words, self-contained, no character names
- Every trait in `traits.starting` must have a `traits.voices` entry
- `traits.voices.{TRAIT}.speaks_as` must be first-person internal voice, not third-person description
- If `habits` present: each entry needs `pattern`, `function`, `visibility`
- If `sexuality` present: `the_gap` needs both `verbal_comfort` and `physical_reality`
- If `hidden_past.exists: true`: `incident.what` and `knowledge.who_knows` required

## Bond Schema

Tracks relationships via 12 independent dimensions, each scored 0-5.

### Dimensions

| Dimension | Measures |
|-----------|----------|
| `physical` | Touch, proximity, body comfort |
| `emotional` | Vulnerability, openness, emotional access |
| `intellectual` | Ideas, discourse, mutual intellectual respect |
| `trust` | Reliability, belief in intentions |
| `sexual` | Desire, erotic charge, sexual acknowledgment |
| `public` | Visibility to others, willingness to be seen together |
| `power` | Control, influence, who sets terms |
| `familiarity` | Knowledge of patterns, tells, habits |
| `loyalty` | Commitment, staying, choosing each other |
| `fear` | What each fears about the other or the bond |
| `obligation` | Debts, duties, what is owed |
| `hope` | Shared future, what they're building toward |

### Scale

`0`: nonexistent, `1`: emerging, `2`: tested, `3`: established, `4`: deep, `5`: foundational

### Asymmetry

When experiences differ between participants, use initial-keyed notation: `{h: 3, k: 4}`. Symmetric values use a single number.

### Bond Sections

- `dimensions` — all 12 axes (required)
- `baseline` — prose per dimension describing what is settled vs. frontier
- `established` — per-dimension moment log with act, since, status, moment
- `traits` — bond-specific evolved traits and voices
- `episodes` — brief event history

## Author Schema

Controls how the story is told. One per game.

| Section | Required | Description |
|---------|----------|-------------|
| `voice` | Yes | Overall style descriptor |
| `pov` | Yes | Narrative perspective — lens, technique, default distance |
| `tense` | Yes | Present or past tense baseline |
| `cadence` | Yes | Sentence length distribution (long/medium/short percentages) |
| `style` | No | Detail level, summary descriptor |
| `diction` | No | Dialect/register rendering guidelines |
| `somatic_emphasis` | No | How bodies are rendered in prose |
| `adult_content` | No | Content permissions — language, explicit content, violence |
| `pacing` | Yes | Turn length target, tempo options (close-up/scene/sequence/montage) |
| `balance` | Yes | Dialogue/description ratio, internal/external ratio, emotional dwelling |
| `endings` | No | Turn ending style, resolution preference |
| `interpretive_frames` | No | Narrative lenses with relative weights |
| `chaos_register` | Yes | Tone of random world events — single value or weighted blend |
| `intellectual_engagement` | No | How academic/theoretical content is rendered |
| `retroactive_continuity` | No | Rules for referencing unrendered events |

## Cross-References

Which agents read which schemas:

| Agent | Reads | Writes |
|-------|-------|--------|
| **Calibrator** | entity, bond, author (all — for creation/validation) | entity files, bond files, author.yaml |
| **Narrator** | entity (traits.voices, layers), bond (dimensions, baseline), author (all) | — |
| **Scribe** | entity (traits, episodes, current_state), bond (dimensions, established, episodes) | entity updates, bond updates |
| **Dramaturg** | entity (traits, foundation), bond (dimensions), author (pacing) | — |
| **Fates** | entity (traits, hidden_past), bond (dimensions, fear, obligation) | — |
| **Possibility** | entity (traits), bond (dimensions) | — |
| **Cast** | entity (traits.voices, layers, life), bond (baseline) | — |

## Validation Summary

| Check | Applies To | Rule |
|-------|-----------|------|
| Required fields present | Entity | id, name.first, name.surname, appearance.visual_tags, foundation.*, traits.starting (2+), traits.wound/lie/wants/needs, layers.first_glance (2+) |
| Voices complete | Entity | Every trait in `traits.starting` has `traits.voices.{TRAIT}.speaks_as` |
| Visual tags clean | Entity | 10-25 words, no character names, includes gender/age/ethnicity/hair/skin/build |
| Surname not AI-default | Entity | Not in forbidden surname list |
| All 12 dimensions | Bond | physical, emotional, intellectual, trust, sexual, public, power, familiarity, loyalty, fear, obligation, hope |
| No legacy fields | Bond | No `intensity`, no `dynamic.power`, no `dynamic.pattern` |
| Dimension range | Bond | Each dimension 0-5 |
| Required voice fields | Author | voice, pov.lens, tense.baseline, cadence, pacing.turn_length.target, balance ratios, chaos_register |
| Habits complete | Entity | If habits present, each entry has pattern + function + visibility |
| Sexuality complete | Entity | If present, the_gap has verbal_comfort + physical_reality |
