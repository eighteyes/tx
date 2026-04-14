# World Rules Reference
# Shared rules for what shapes entropy tables — distributions, registers, traits
# Used by: character outcome Tasks, direction table Tasks

## Chaos Register

Controls the **tone** of chaos and register-toned entries. Read `chaos_register` from `author.yaml`. Default: `naturalistic`.

| Register | Chaos tone | Subtable character |
|----------|-----------|-------------------|
| `mundane` | Boring, inconvenient, anti-dramatic | Flat, annoying, life-is-tedious |
| `naturalistic` | Colorful, specific, life-like | Vivid but believable, specific details |
| `gothic` | Ominous, uncanny, atmospheric | Unsettling, things feel wrong |
| `surreal` | Dream-logic, reality slips | Disorienting, can't-quite-name-it |
| `comic` | Situationally funny, awkward, cringe | Embarrassing, socially painful, wince-worthy |
| `farcical` | Slapstick, absurdist, full cartoon | Escalating disasters, physical comedy, zany |
| `hostile` | World fights back, noir energy | Antagonistic, punishing, Murphy's Law |

**Weighted blend format** (percentage mix across ALL register-toned slots):
```yaml
chaos_register:
  naturalistic: 60
  comic: 20
  hostile: 10
  farcical: 10
```

**Single register format:** 3 of 4 subtable entries match the register tone, 1 thematic.

**Character register entries follow the same blend.** The outcome TYPE is unchanged — the TEXTURE carries the register. A `comic` success might be: they speak perfectly unguarded, then realize they have pillow creases on their face. A `hostile` failure: they try to respond but the words come out wrong and land as accusation.

**Anti-bias:** LLMs default to hostile and comic. Naturalistic IS chaos — a raccoon on the porch, a delivery driver having a bad day. Farcical IS chaos — 47 rubber ducks. Match the target percentages, not your instinct.

## Distribution Shapes (Arc-Driven)

| Arc Phase | Pressure | Shape | Character |
|-----------|----------|-------|-----------|
| Hook | 0-25 | `hook` | Interesting things happen |
| Rising | 26-60 | `normal` | Middle dominates |
| Complication | 61-85 | `right_skew` | Success becomes available |
| Crisis | 86-120 | `bimodal` | Outcomes polarize |
| Climax | 121-160 | `fat_tails` | Extremes dominate |
| Catastrophe | 161+ | `explosive` | Past breaking point |

## Arc Position to Shape Emphasis

| Arc Position | Shapes to Emphasize |
|--------------|---------------------|
| Early (building) | mixed, failure — complicate everything |
| Mid (pressurized) | failure, mixed — questions should HURT |
| Pre-climax | failure, catastrophic — stakes are real |
| Climax | transformational, catastrophic — extremes only |
| Denouement | success, transformational — earned rest |

## NPC Trait Pressures (Mechanical)

| NPC Trait State | Weight Adjustment |
|-----------------|-------------------|
| EXHAUSTED: 5 | +20% shutdown/enforcement, -20% warmth |
| BOUNDARIED: 4+ | +15% boundary enforcement, -15% opening |
| WARM: 1 | -25% any warm response |
| MERCURIAL: 3+ | Wider distribution — unpredictable |

NPC trait pressures are as binding as protagonist traits. An NPC with EXHAUSTED: 5 doesn't suddenly have patience.

## Trait Friction (Player Agency)

Traits affect EXECUTION quality, not WHETHER action happens. The player is the author. Their action is canon.

- Trait-aligned → easier success, less friction
- Trait-opposing → harder success, MORE dramatic weight, evolution potential unlocked
- NEVER underweight because "character wouldn't"
