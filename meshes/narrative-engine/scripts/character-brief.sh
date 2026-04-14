#!/usr/bin/env bash
# character-brief.sh — Extract character data with mode-based filtering
# Enforces information barrier: outputs ONLY what this character knows
#
# Usage: character-brief.sh <character_id> <primary_path> [game_path] [--mode=MODE]
#   primary_path: campaign dir (evolving state) or game dir (full entity)
#   game_path:    game dir for static identity (visual, habits, voice, backstory)
#
# Modes:
#   full     (default) — everything voice-shaping (~4,900w). For sim-planner.
#   task     — minimum necessary for isolated Tasks (~1,400w). For sim-scene/sim-chars.
#              Strips: self_awareness, habits, opinions, desires, memories, foundation,
#              core_psychology, episode_history, full bonds, sexuality, backstory.
#              Keeps: name, id, appearance, traits as numbers, voice_layers,
#              life.active_concerns/expertise/social_web, current_state, conditions.
#   narrator — rendering essentials (~2,000w). For narrator opus Tasks.
#              Strips: backstory, episode_history, social_web, core_psychology, full bonds.
#              Keeps: voice_layers, traits+pressure, visual, active_concerns, habits, self_awareness.

set -euo pipefail

# Parse args — positional + optional --mode flag
MODE="full"
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --mode=*) MODE="${arg#--mode=}" ;;
    --help|-h) echo "Usage: character-brief.sh <character_id> <primary_path> [game_path] [--mode=full|task|narrator]" >&2; exit 0 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

CHARACTER_ID="${POSITIONAL[0]:?Usage: character-brief.sh <character_id> <primary_path> [game_path] [--mode=MODE]}"
PRIMARY_PATH="${POSITIONAL[1]:?Usage: character-brief.sh <character_id> <primary_path> [game_path] [--mode=MODE]}"
GAME_PATH="${POSITIONAL[2]:-}"

# Resolve primary entity file
CHAR_FILE="$PRIMARY_PATH/entities/characters/$CHARACTER_ID.yaml"
if [[ ! -f "$CHAR_FILE" ]]; then
  echo "error: Character file not found: $CHAR_FILE" >&2
  exit 1
fi

# Resolve game-level entity file (static identity source)
GAME_CHAR_FILE=""
if [[ -n "$GAME_PATH" && "$GAME_PATH" != "$PRIMARY_PATH" ]]; then
  candidate="$GAME_PATH/entities/characters/$CHARACTER_ID.yaml"
  [[ -f "$candidate" ]] && GAME_CHAR_FILE="$candidate"
fi

# Find bond files — check both paths
BOND_LIST=""
for bond_dir in "$PRIMARY_PATH/entities/bonds" "$GAME_PATH/entities/bonds"; do
  [[ -z "$bond_dir" || ! -d "$bond_dir" ]] && continue
  for f in "$bond_dir"/*.yaml; do
    [[ -f "$f" ]] && grep -q "$CHARACTER_ID" "$f" && BOND_LIST="$BOND_LIST $f"
  done
done
# Deduplicate bond files (same bond may exist at both levels)
BOND_LIST=$(echo "$BOND_LIST" | tr ' ' '\n' | sort -u | tr '\n' ' ')

# Export as env vars for python
export CB_CHAR_ID="$CHARACTER_ID"
export CB_CHAR_FILE="$CHAR_FILE"
export CB_GAME_CHAR_FILE="${GAME_CHAR_FILE:-}"
export CB_BOND_FILES="$BOND_LIST"
export CB_MODE="$MODE"

python3 << 'PYEOF'
import os, yaml, copy

char_id = os.environ['CB_CHAR_ID']
char_file = os.environ['CB_CHAR_FILE']
game_char_file = os.environ.get('CB_GAME_CHAR_FILE', '')
bond_files = os.environ.get('CB_BOND_FILES', '').split()
mode = os.environ.get('CB_MODE', 'full')

def deep_merge(base, overlay):
    """Merge overlay into base. Overlay wins on conflicts. Dicts merge recursively."""
    result = copy.deepcopy(base)
    for k, v in overlay.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = deep_merge(result[k], v)
        else:
            result[k] = copy.deepcopy(v)
    return result

# Load primary entity (campaign-level if caller passes campaign path)
with open(char_file) as f:
    primary = yaml.safe_load(f) or {}

# Load game-level entity and merge if available
# Game provides static identity (visual, habits, voice, backstory, sexuality)
# Primary provides evolving state (traits.evolved, episodes, conditions, current_state)
if game_char_file and os.path.isfile(game_char_file):
    with open(game_char_file) as f:
        game = yaml.safe_load(f) or {}
    char = deep_merge(game, primary)
else:
    char = primary

brief = {}

# ── Identity (all modes) ──
name_field = char.get('name', char_id)
if isinstance(name_field, dict):
    brief['name'] = name_field.get('first', char_id)
else:
    brief['name'] = name_field
brief['id'] = char.get('id', char_id)

# ── Appearance (all modes — but task mode merges into single block) ──
if 'appearance' in char:
    brief['appearance'] = char['appearance']
if 'visual' in char and mode != 'task':
    brief['visual'] = char['visual']

# ── Traits ──
traits_source = char.get('traits', {})
evolved = traits_source.get('evolved', {})
starting = traits_source.get('starting', {})
traits_out = {}
for tid, tdata in (evolved if evolved else starting).items():
    entry = {}
    if isinstance(tdata, dict):
        entry['pressure'] = tdata.get('pressure', 1)
        if mode != 'task':
            entry['baseline'] = tdata.get('baseline', 1)
            if tid in starting and isinstance(starting[tid], dict):
                entry['description'] = starting[tid].get('description', '')
                entry['function'] = starting[tid].get('function', '')
                if starting[tid].get('shadow'):
                    entry['shadow'] = starting[tid]['shadow']
    else:
        entry['pressure'] = tdata
    traits_out[tid] = entry
brief['traits'] = traits_out

# ── Self-awareness (full + narrator only) ──
if mode != 'task':
    self_awareness = {}
    for field in ('role', 'armor', 'wound', 'lie', 'wants', 'needs', 'blind_spot', 'sexuality_insight'):
        if field in traits_source:
            self_awareness[field] = traits_source[field]
    if self_awareness:
        brief['self_awareness'] = self_awareness

# ── Voice layers (all modes — critical for character sound) ──
if 'layers' in char:
    brief['voice_layers'] = char['layers']

# ── Habits (full + narrator only) ──
if mode != 'task' and 'habits' in char:
    habits_clean = {}
    for name, data in char['habits'].items():
        if isinstance(data, dict):
            clean = {k: v for k, v in data.items()
                     if not any(x in k.lower() for x in ['narrator', 'implication'])}
            habits_clean[name] = clean
        else:
            habits_clean[name] = data
    brief['habits'] = habits_clean

# ── Life context ──
if 'life' in char:
    life = char['life']
    life_out = {}
    if mode == 'task':
        # Task mode: only concerns, expertise, social_web
        for k in ('active_concerns', 'expertise', 'social_web'):
            if k in life:
                life_out[k] = life[k]
    elif mode == 'narrator':
        # Narrator: concerns, expertise, habits-related context
        for k in ('active_concerns', 'expertise'):
            if k in life:
                life_out[k] = life[k]
    else:
        # Full: everything
        for k, v in life.items():
            life_out[k] = v
    if life_out:
        brief['life'] = life_out

# ── Foundation (full only) ──
if mode == 'full' and 'foundation' in char:
    f = char['foundation']
    brief['foundation'] = {'ideology': f.get('ideology', ''), 'function': f.get('function', '')}

# ── Backstory (full only) ──
if mode == 'full' and 'backstory' in char:
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

# ── Sexuality (full only) ──
if mode == 'full' and 'sexuality' in char:
    sex = char['sexuality']

    def clean_dict(d):
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

# ── Current state (all modes — but task mode keeps only trait_pressures) ──
if 'current_state' in char:
    cs = char['current_state']
    if mode == 'task':
        # Task: just trait pressures and conditions as numbers
        state_out = {}
        if 'trait_pressures' in cs:
            state_out['trait_pressures'] = cs['trait_pressures']
        if 'conditions' in cs:
            state_out['conditions'] = cs['conditions']
    else:
        state_out = {}
        for k, v in cs.items():
            if k in ('narrative_position', 'arc_direction'):
                continue
            state_out[k] = v
    if state_out:
        brief['current_state'] = state_out

# ── Core psychology (full only) ──
if mode == 'full' and 'turn_0_psychology' in char:
    t0 = char['turn_0_psychology']
    if isinstance(t0, dict):
        t0_clean = {k: v for k, v in t0.items() if k not in ('deepest',)}
        brief['core_psychology'] = t0_clean

# ── Episodes (full only) ──
if mode == 'full' and 'episodes' in char:
    brief['episode_history'] = [
        {'turn': ep.get('turn', '?'), 'event': ep.get('event', '')}
        for ep in char['episodes']
    ]

# ── Bonds ──
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

    if mode == 'task':
        # Task mode: intensity only, no dimensions/baselines/history
        pass
    else:
        # Full + narrator: resolve dimensions
        dims = bond.get('dimensions', {})
        if dims:
            resolved_dims = {}
            name_to_key = {}
            for p in participants:
                for key_len in (1, 2, 3, len(p)):
                    candidate = p[:key_len]
                    if candidate not in name_to_key.values():
                        name_to_key[p] = candidate
                        break
            my_key = name_to_key.get(char_id, char_id[0])
            for axis, val in dims.items():
                if isinstance(val, dict):
                    resolved_dims[axis] = val.get(my_key, val.get(char_id, list(val.values())[0]))
                else:
                    resolved_dims[axis] = val
            bond_brief['dimensions'] = resolved_dims

        if mode == 'full':
            # Full: baselines, normalized acts, shared history
            baseline = bond.get('baseline', {})
            if baseline:
                bond_brief['baseline'] = baseline
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

# ── Output ──
mode_label = {'full': 'full', 'task': 'task-filtered', 'narrator': 'narrator-filtered'}
print('# Character Brief: ' + brief['name'])
print('# Mode: ' + mode_label.get(mode, mode))
print('# Generated by character-brief.sh')
print()
print(yaml.dump(brief, default_flow_style=False, allow_unicode=True, sort_keys=False, width=120))
PYEOF
