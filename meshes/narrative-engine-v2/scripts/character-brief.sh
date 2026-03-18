#!/usr/bin/env bash
# character-brief.sh — Extract character data for voice agent
# Enforces information barrier: outputs ONLY what this character knows
# Maximizes voice-shaping data: traits, shadows, speech patterns, inner life
#
# Usage: character-brief.sh <character_id> <game_path>
# Output: YAML character brief on stdout
#
# FILTERS OUT:
#   - Narrator commentary (implication_expanded, why_this_matters)
#   - Cross-character predictions ({character}_will_discover, etc.)
#   - Backstory secrets of OTHER characters
#   - Arc pressure, narrative goals, story direction
#
# KEEPS (voice-critical):
#   - Trait shadows (how traits distort speech)
#   - lie/wants/needs/blind_spot (self-knowledge that shapes word choice)
#   - Full current_state (armor_status, vulnerability, trait_states)
#   - Sexuality self-knowledge (verbal comfort, physical reality)
#   - Habit contrast fields (comparative voice data)

set -euo pipefail

CHARACTER_ID="${1:?Usage: character-brief.sh <character_id> <game_path>}"
GAME_PATH="${2:?Usage: character-brief.sh <character_id> <game_path>}"

CHAR_FILE="$GAME_PATH/entities/characters/$CHARACTER_ID.yaml"
if [[ ! -f "$CHAR_FILE" ]]; then
  echo "error: Character file not found: $CHAR_FILE" >&2
  exit 1
fi

# Find bond files involving this character
BOND_DIR="$GAME_PATH/entities/bonds"
BOND_LIST=""
if [[ -d "$BOND_DIR" ]]; then
  for f in "$BOND_DIR"/*.yaml; do
    [[ -f "$f" ]] && grep -q "$CHARACTER_ID" "$f" && BOND_LIST="$BOND_LIST $f"
  done
fi

# Export as env vars for python
export CB_CHAR_ID="$CHARACTER_ID"
export CB_CHAR_FILE="$CHAR_FILE"
export CB_BOND_FILES="$BOND_LIST"

python3 << 'PYEOF'
import os, yaml

char_id = os.environ['CB_CHAR_ID']
char_file = os.environ['CB_CHAR_FILE']
bond_files = os.environ.get('CB_BOND_FILES', '').split()

with open(char_file) as f:
    char = yaml.safe_load(f)

brief = {}

# Identity
name_field = char.get('name', char_id)
if isinstance(name_field, dict):
    brief['name'] = name_field.get('first', char_id)
else:
    brief['name'] = name_field
brief['id'] = char.get('id', char_id)

# Appearance (observable)
if 'appearance' in char:
    brief['appearance'] = char['appearance']

# Traits — use evolved if available, else starting
# Pull shadow fields — these shape HOW the character speaks
traits_source = char.get('traits', {})
evolved = traits_source.get('evolved', {})
starting = traits_source.get('starting', {})
traits_out = {}
for tid, tdata in (evolved if evolved else starting).items():
    entry = {}
    if isinstance(tdata, dict):
        entry['pressure'] = tdata.get('pressure', 1)
        entry['baseline'] = tdata.get('baseline', 1)
        if tid in starting and isinstance(starting[tid], dict):
            entry['description'] = starting[tid].get('description', '')
            entry['function'] = starting[tid].get('function', '')
            # Shadow = how this trait distorts speech and behavior
            if starting[tid].get('shadow'):
                entry['shadow'] = starting[tid]['shadow']
    else:
        entry['pressure'] = tdata
    traits_out[tid] = entry
brief['traits'] = traits_out

# Self-knowledge — role/armor/wound + lie/wants/needs/blind_spot
# These shape word choice, framing, what they can and can't say
self_awareness = {}
for field in ('role', 'armor', 'wound', 'lie', 'wants', 'needs', 'blind_spot', 'sexuality_insight'):
    if field in traits_source:
        self_awareness[field] = traits_source[field]
if self_awareness:
    brief['self_awareness'] = self_awareness

# Voice layers
if 'layers' in char:
    brief['voice_layers'] = char['layers']

# Habits — keep contrast fields (voice data), filter only narrator analysis
if 'habits' in char:
    habits_clean = {}
    for name, data in char['habits'].items():
        if isinstance(data, dict):
            clean = {k: v for k, v in data.items()
                     if not any(x in k.lower() for x in ['narrator', 'implication'])}
            habits_clean[name] = clean
        else:
            habits_clean[name] = data
    brief['habits'] = habits_clean

# Life context — active concerns, expertise, opinions, voice markers, memories, social web, desires
# All of this is self-knowledge — the character knows their own life
if 'life' in char:
    life = char['life']
    life_out = {}
    # Keep all life subsections — they're all character self-knowledge
    for k, v in life.items():
        life_out[k] = v
    brief['life'] = life_out

# Foundation
if 'foundation' in char:
    f = char['foundation']
    brief['foundation'] = {'ideology': f.get('ideology', ''), 'function': f.get('function', '')}

# Backstory — own knowledge only, filter narrator analysis
if 'backstory' in char:
    bs = char['backstory']
    clean = {}
    skip_keys = {'implication', 'implication_expanded', 'pattern', 'pattern_shape'}
    for k, v in bs.items():
        if k in skip_keys:
            continue
        if isinstance(v, dict):
            v = {sk: sv for sk, sv in v.items()
                 if sk not in ('implication', 'implication_expanded', 'connection_to_violence',
                               'what_it_reveals', 'deeper_pattern')}
        clean[k] = v
    brief['backstory'] = clean

# Sexuality — self-knowledge, keep voice-shaping data (verbal comfort, physical reality)
# Filter only cross-character predictions and narrator meta
if 'sexuality' in char:
    sex = char['sexuality']

    def clean_dict(d):
        """Recursively clean narrator/cross-character fields from nested dicts."""
        if not isinstance(d, dict):
            return d
        skip_keys = {'why_this_matters', 'misreading'}
        skip_patterns = ['_will_discover', '_will_', 'narrator', 'implication']
        out = {}
        for k, v in d.items():
            if k in skip_keys:
                continue
            if any(x in k.lower() for x in skip_patterns):
                continue
            out[k] = clean_dict(v) if isinstance(v, dict) else v
        return out

    cleaned = clean_dict(sex)
    if cleaned:
        brief['sexuality'] = cleaned

# Current state — full emotional/armor context for voice generation
if 'current_state' in char:
    cs = char['current_state']
    state_out = {}
    # Pull everything — location, emotional_state, armor_status, vulnerability, trait_states
    for k, v in cs.items():
        # Filter narrator-only fields
        if k in ('narrative_position', 'arc_direction'):
            continue
        state_out[k] = v
    brief['current_state'] = state_out

# Core psychology — the projection/wound dynamic that shapes all speech
# Filter deepest narrator analysis, keep character self-knowledge
if 'turn_0_psychology' in char:
    t0 = char['turn_0_psychology']
    if isinstance(t0, dict):
        t0_clean = {k: v for k, v in t0.items()
                    if k not in ('deepest',)}  # deepest is narrator-level insight
        brief['core_psychology'] = t0_clean

# Episodes — own history
if 'episodes' in char:
    brief['episode_history'] = [
        {'turn': ep.get('turn', '?'), 'event': ep.get('event', '')}
        for ep in char['episodes']
    ]

# Bonds — extract dimensions, baselines, and normalized acts
bonds = []
for bf in bond_files:
    if not bf.strip():
        continue
    with open(bf) as f:
        bond = yaml.safe_load(f)
    participants = bond.get('participants', [])
    other = [p for p in participants if p != char_id]
    other_name = other[0] if other else 'unknown'
    bond_brief = {'with': other_name, 'intensity': bond.get('intensity', 0)}

    # Bond dimensions — resolve asymmetry for this character
    dims = bond.get('dimensions', {})
    if dims:
        resolved_dims = {}
        # Map participant names to short keys used in asymmetry
        # e.g., {h: 2, k: 3} — figure out which key is this character
        name_to_key = {}
        for p in participants:
            # Try first letter, first two letters, full name
            for key_len in (1, 2, 3, len(p)):
                candidate = p[:key_len]
                if candidate not in name_to_key.values():
                    name_to_key[p] = candidate
                    break
        my_key = name_to_key.get(char_id, char_id[0])

        for axis, val in dims.items():
            if isinstance(val, dict):
                # Asymmetric — find this character's value
                resolved_dims[axis] = val.get(my_key, val.get(char_id, list(val.values())[0]))
            else:
                resolved_dims[axis] = val
        bond_brief['dimensions'] = resolved_dims

    # Baseline guidance — character-observable feelings about the bond
    baseline = bond.get('baseline', {})
    if baseline:
        bond_brief['baseline'] = baseline

    # Normalized acts — what's comfortable, don't hesitate
    established = bond.get('established', {})
    if established:
        normalized = []
        for axis, acts in established.items():
            if isinstance(acts, list):
                for act in acts:
                    if isinstance(act, dict) and act.get('status') == 'normalized':
                        normalized.append(f"{axis}/{act.get('act', '?')}")
        if normalized:
            bond_brief['normalized_acts'] = normalized

    if 'episodes' in bond:
        bond_brief['shared_history'] = [
            {'turn': e.get('turn', '?'), 'event': e.get('event', '')}
            for e in bond['episodes']
        ]
    bonds.append(bond_brief)

if bonds:
    brief['bonds'] = bonds

# Output
print('# Character Brief: ' + brief['name'])
print('# Information-isolated: only what this character knows')
print('# Generated by character-brief.sh')
print()
print(yaml.dump(brief, default_flow_style=False, allow_unicode=True, sort_keys=False, width=120))
PYEOF
