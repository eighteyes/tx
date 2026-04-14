#!/usr/bin/env bash
# arc-read.sh — Act-scoped arc filter for narrative agents
# Enforces information barrier: agents see only current-act context
# Seeds visible for foreshadowing, but activation_conditions stripped
#
# Usage: arc-read.sh <campaign_path> [--agent=narrator|dramaturg|architect]
# Output: Filtered YAML on stdout
#
# FILTERS OUT (director/author knowledge):
#   - Future act summaries, objectives, ends_when
#   - Future-act escalation rungs (filtered by act field)
#   - activation_condition on ALL seeds
#   - seeds_to_plant on escalation rungs
#   - Dormant question notes (often reference future mechanics)
#   - dramatic_question.meta + .reader_question
#   - central_tension.structural
#   - Recurring motif placements beyond next marker
#   - trajectory.critical_threshold
#
# KEEPS (agent-useful / foreshadowing):
#   - Current act summary + objective + current_position
#   - Current-act escalation rungs with full scene descriptions
#   - ALL seeds with id, status, note (visible for foreshadowing)
#   - Active/answered questions with notes
#   - Central tension: surface, deeper, deepest (lived experience)
#   - Primary + secondary dramatic questions
#   - Current trajectory note + volatility
#   - Arc pressure, momentum, phase
#   - Next recurring motif marker (content only, not placement)

set -euo pipefail

CAMPAIGN_PATH="${1:?Usage: arc-read.sh <campaign_path> [--agent=narrator|dramaturg|architect]}"
AGENT_LEVEL="default"

for arg in "${@:2}"; do
  case "$arg" in
    --agent=*) AGENT_LEVEL="${arg#--agent=}" ;;
    *) echo "error: Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

ARC_FILE="$CAMPAIGN_PATH/arc.yaml"
if [[ ! -f "$ARC_FILE" ]]; then
  echo "error: Arc file not found: $ARC_FILE" >&2
  exit 1
fi

export ARC_FILE AGENT_LEVEL

python3 << 'PYEOF'
import os
import sys
import yaml

arc_file = os.environ['ARC_FILE']
agent_level = os.environ.get('AGENT_LEVEL', 'default')

with open(arc_file, 'r') as f:
    arc = yaml.safe_load(f)

if not arc:
    print("error: Empty or invalid arc.yaml", file=sys.stderr)
    sys.exit(1)

# --- Determine current act ---
current_act = None
acts = arc.get('acts', {})
for act_id, act_data in acts.items():
    if isinstance(act_data, dict) and act_data.get('status') == 'in_progress':
        current_act = act_id
        break

if not current_act:
    # Fallback: find most recent non-dormant act
    for act_id, act_data in acts.items():
        if isinstance(act_data, dict) and act_data.get('status') != 'dormant':
            current_act = act_id
    if not current_act:
        print("error: No active act found in arc.yaml", file=sys.stderr)
        sys.exit(1)

# --- Build filtered output ---
out = {}

# Header fields (always visible)
for key in ['game', 'campaign', 'last_updated', 'turn_last_updated',
            'story_day', 'arc_pressure', 'momentum']:
    if key in arc:
        out[key] = arc[key]

# Phase (always visible)
if 'phase' in arc:
    out['phase'] = arc['phase']

# --- Dramatic question: strip meta + reader_question ---
dq = arc.get('dramatic_question', {})
if dq:
    filtered_dq = {}
    for key in ['primary', 'secondary']:
        if key in dq:
            filtered_dq[key] = dq[key]
    out['dramatic_question'] = filtered_dq

# --- Central tension: strip structural ---
ct = arc.get('central_tension', {})
if ct:
    filtered_ct = {}
    for key in ['surface', 'deeper', 'deepest']:
        if key in ct:
            filtered_ct[key] = ct[key]
    # 'structural' stripped — that's architecture, not lived experience
    out['central_tension'] = filtered_ct

# --- Acts: current act only ---
if acts:
    current_act_data = acts.get(current_act, {})
    filtered_act = {}
    for key in ['name', 'status', 'objective', 'summary', 'dramatic_question',
                'current_position', 'heathers_career']:
        if key in current_act_data:
            filtered_act[key] = current_act_data[key]
    # Strip: ends_when (tells agent when act concludes — director knowledge)
    # Strip: seeds_planted (meta-commentary on what gets planted)
    out['current_act'] = filtered_act

# --- Escalation ladder: current-act rungs only ---
ladder = arc.get('escalation_ladder', {})
if ladder:
    filtered_ladder = {}
    # Keep principle + reader_principle (general guidance)
    for key in ['principle', 'reader_principle']:
        if key in ladder:
            filtered_ladder[key] = ladder[key]

    rungs = {}
    for rung_key, rung_data in ladder.items():
        if not isinstance(rung_data, dict):
            continue
        if rung_data.get('act') != current_act:
            continue
        # Keep the rung but strip seeds_to_plant (director stage direction)
        filtered_rung = {}
        for key in ['name', 'status', 'capability', 'principle',
                     'scenes_needed', 'scenes_delivered', 'established',
                     'unlocks', 'bedroom_reward', 'danger', 'grandmother']:
            if key in rung_data:
                filtered_rung[key] = rung_data[key]
        # Strip: seeds_to_plant (tells agent what to plant — too directive)
        rungs[rung_key] = filtered_rung

    filtered_ladder['rungs'] = rungs
    out['escalation_ladder'] = filtered_ladder

# --- Seeds: ALL visible (foreshadowing), but activation_condition stripped ---
seeds = arc.get('seeds', {})
if seeds:
    filtered_seeds = {}
    for category in ['dormant', 'planted', 'ready_to_activate',
                     'negotiable_seeds', 'bloomed']:
        seed_list = seeds.get(category, [])
        if not seed_list:
            filtered_seeds[category] = []
            continue
        filtered_list = []
        for seed in seed_list:
            if not isinstance(seed, dict):
                continue
            filtered_seed = {}
            for key in ['id', 'status', 'note', 'planted_turn',
                        'activated_turn', 'reinforced_turn', 'bloomed_turn',
                        'surface_when']:
                if key in seed:
                    filtered_seed[key] = seed[key]
            # Strip: activation_condition (director knowledge — WHEN it fires)
            # Keep: surface_when (how it manifests — actor knowledge)
            filtered_list.append(filtered_seed)
        filtered_seeds[category] = filtered_list
    out['seeds'] = filtered_seeds

# --- Questions: active visible, dormant stripped of future-mechanic notes ---
questions = arc.get('questions', [])
if questions:
    filtered_questions = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        fq = {}
        for key in ['id', 'question', 'pressure', 'status']:
            if key in q:
                fq[key] = q[key]
        # Keep note for active/answered questions
        # Strip note for dormant questions (references future mechanics)
        if q.get('status') in ('active', 'answered'):
            if 'note' in q:
                fq['note'] = q['note']
            if 'resolution' in q:
                fq['resolution'] = q['resolution']
        filtered_questions.append(fq)
    out['questions'] = filtered_questions

# --- Recurring motifs / depth charges: next marker only ---
# Detect any top-level key with a 'remaining' dict containing location+content
# Handles: grandmother, recurring_dream, the_photograph, etc.
known_structural_keys = set(out.keys()) | {
    'acts', 'escalation_ladder', 'seeds', 'questions', 'trajectory',
    'dramatic_question', 'central_tension', 'phase',
    'game', 'campaign', 'last_updated', 'turn_last_updated',
    'story_day', 'arc_pressure', 'momentum'
}
for key, value in arc.items():
    if key in known_structural_keys:
        continue
    if not isinstance(value, dict):
        continue
    remaining = value.get('remaining', {})
    if not remaining or not isinstance(remaining, dict):
        continue
    # Check if this looks like a motif structure (has location/content keys)
    sample = next(iter(remaining.values()), {})
    if not isinstance(sample, dict) or 'content' not in sample:
        continue
    # It's a recurring motif — filter to next marker only
    filtered_motif = {}
    if 'principle' in value:
        filtered_motif['principle'] = value['principle']
    for m_key in sorted(remaining.keys()):
        m_data = remaining[m_key]
        if isinstance(m_data, dict):
            filtered_motif['next'] = {
                'id': m_key,
                'content': m_data.get('content', '')
            }
            break  # Only the next one
    out[key] = filtered_motif

# --- Trajectory: strip critical_threshold ---
trajectory = arc.get('trajectory', {})
if trajectory:
    filtered_t = {}
    for key in ['current', 'updated_turn', 'note', 'volatility']:
        if key in trajectory:
            filtered_t[key] = trajectory[key]
    # Strip: critical_threshold (director-level analysis of what triggers next)
    out['trajectory'] = filtered_t

# --- Agent-level overrides ---
if agent_level == 'narrator':
    # Narrator gets minimal arc context — no pressure numbers, no trajectory
    out.pop('arc_pressure', None)
    out.pop('trajectory', None)
    out.pop('momentum', None)
    # Keep: current_act summary, escalation rung scenes, seeds, central_tension
    # This prevents the narrator from "writing toward" pressure targets

elif agent_level == 'architect':
    # Architect gets entropy-relevant fields — pressure, momentum, seeds
    # Strip: escalation ladder scene descriptions (not entropy-relevant)
    if 'escalation_ladder' in out:
        ladder = out['escalation_ladder']
        for rung_key, rung_data in ladder.get('rungs', {}).items():
            if isinstance(rung_data, dict):
                rung_data.pop('scenes_needed', None)
                rung_data.pop('scenes_delivered', None)
                rung_data.pop('bedroom_reward', None)

# --- Output ---
header = f"# Arc context — filtered for current act ({current_act})\n"
header += f"# Agent level: {agent_level}\n"
header += "# Future acts, activation conditions, and meta-analysis redacted.\n"
header += "# Seeds visible for foreshadowing. Outcomes hidden.\n"
header += "---\n"

print(header)
print(yaml.dump(out, default_flow_style=False, allow_unicode=True,
                width=120, sort_keys=False))
PYEOF
