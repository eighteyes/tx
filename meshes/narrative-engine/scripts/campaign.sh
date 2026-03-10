#!/usr/bin/env bash
# campaign.sh — unified campaign data access
# Single entry point for all campaign artifact reads and writes.
# Separates CURRENT STATE (bounded, overwritten) from HISTORY (append-only, queryable).
#
# Usage: campaign.sh <campaign_path> <domain> <action> [options]
#
# Domains:
#   arc        — bounded current state (pressure, momentum, seeds, questions)
#   facts      — established facts, secrets, barriers, appearances, factoids (append + query)
#   timeline   — structured time tracking (append + query)
#   episode    — entity episode management (append + query)
#   trajectory — Chekhov's guns (add, fire, interrupt, list)

set -euo pipefail

# ==========================================
# GLOBALS
# ==========================================

CAMPAIGN_PATH=""
DOMAIN=""
ACTION=""
CONTINUITY_FILE=""
ARC_FILE=""
TIMELINE_FILE=""
TRAJECTORIES_FILE=""

# ==========================================
# HELPERS
# ==========================================

usage() {
  cat <<'EOF'
Usage: campaign.sh <campaign_path> <domain> <action> [options]

Domains:
  arc        update|get
  facts      add|add-secret|reveal-secret|add-barrier|add-world-event|appearance|add-factoid|query
  timeline   add|current|get|range
  episode    append|list|traits
  trajectory add|fire|interrupt|list

Run: campaign.sh <campaign_path> <domain> --help for domain-specific usage.
EOF
  exit 1
}

die() { echo "ERROR: $1" >&2; exit 1; }

require_arg() {
  local name="$1" value="$2"
  [[ -z "$value" ]] && die "Missing required argument: --${name}"
}

parse_opts() {
  # Parse --key=value pairs into associative array
  local -n _opts=$1; shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --*=*) local key="${1%%=*}"; key="${key#--}"; _opts["$key"]="$1#*=}"; shift ;;
      --*)   local key="${1#--}"; shift; _opts["$key"]="${1:-}"; shift ;;
      *)     _opts["_positional_${#_opts[@]}"]="$1"; shift ;;
    esac
  done
}

# Robust option parser — handles --key=value and --key value
declare -A OPTS
parse_options() {
  OPTS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --*=*)
        local key="${1%%=*}"
        key="${key#--}"
        local val="${1#*=}"
        OPTS["$key"]="$val"
        shift
        ;;
      --*)
        local key="${1#--}"
        # Check if next arg exists and isn't another flag
        if [[ $# -gt 1 && "${2:0:2}" != "--" ]]; then
          OPTS["$key"]="$2"
          shift 2
        else
          OPTS["$key"]="true"
          shift
        fi
        ;;
      *)
        # Positional args stored as _pos_0, _pos_1, etc.
        local idx=0
        while [[ -n "${OPTS[_pos_$idx]:-}" ]]; do ((idx++)); done
        OPTS["_pos_$idx"]="$1"
        shift
        ;;
    esac
  done
}

opt() { echo "${OPTS[$1]:-}"; }
opt_or_die() { local v="${OPTS[$1]:-}"; [[ -z "$v" ]] && die "Missing required: --$1"; echo "$v"; }

ensure_file() {
  local file="$1" template="$2"
  if [[ ! -f "$file" ]]; then
    mkdir -p "$(dirname "$file")"
    echo "$template" > "$file"
  fi
}

# ==========================================
# ARC DOMAIN — bounded current state
# ==========================================

arc_usage() {
  cat <<'EOF'
arc domain — bounded current state

  campaign.sh $CP arc get
  campaign.sh $CP arc update [options]

Update options:
  --turn=N                  Turn number for timestamp
  --pressure-delta=N        Change arc_pressure by N (positive or negative)
  --momentum=VALUE          Set momentum (rising|peak|falling|stable|threshold|...)
  --phase=VALUE             Set phase.current
  --seed-bloom=ID           Move seed from planted/dormant to ready_to_activate
  --question-add=TEXT       Add new dramatic question
  --question-resolve=INDEX  Resolve question at 0-based index (move to answered)
EOF
  exit 1
}

cmd_arc() {
  local action="$1"; shift
  case "$action" in
    get) arc_get ;;
    update) arc_update "$@" ;;
    --help|-h) arc_usage ;;
    *) arc_usage ;;
  esac
}

arc_get() {
  # Output current arc state (bounded fields only — no turn_history)
  yq eval '{
    "arc_pressure": .arc_pressure,
    "momentum": .momentum,
    "phase": .phase,
    "dramatic_question": .dramatic_question,
    "central_tension": .central_tension,
    "seeds": .seeds,
    "questions": .questions,
    "ending": .ending
  }' "$ARC_FILE"
}

arc_update() {
  parse_options "$@"

  local turn=$(opt "turn")

  # Pressure delta
  local pdelta=$(opt "pressure-delta")
  if [[ -n "$pdelta" ]]; then
    yq -i ".arc_pressure = .arc_pressure + $pdelta" "$ARC_FILE"
  fi

  # Momentum
  local momentum=$(opt "momentum")
  if [[ -n "$momentum" ]]; then
    yq -i ".momentum = \"$momentum\"" "$ARC_FILE"
  fi

  # Phase
  local phase=$(opt "phase")
  if [[ -n "$phase" ]]; then
    yq -i ".phase.current = \"$phase\"" "$ARC_FILE"
  fi

  # Seed bloom — move from planted/dormant to ready_to_activate
  local bloom=$(opt "seed-bloom")
  if [[ -n "$bloom" ]]; then
    # Try planted first, then dormant
    local found=""
    for bucket in planted dormant; do
      local exists
      exists=$(yq ".seeds.$bucket[] | select(.id == \"$bloom\") | .id" "$ARC_FILE" 2>/dev/null || true)
      if [[ -n "$exists" ]]; then
        # Extract the seed
        local seed_yaml
        seed_yaml=$(yq ".seeds.$bucket[] | select(.id == \"$bloom\")" "$ARC_FILE")
        # Remove from source bucket
        yq -i "del(.seeds.$bucket[] | select(.id == \"$bloom\"))" "$ARC_FILE"
        # Add to ready_to_activate with updated status
        yq -i ".seeds.ready_to_activate += [{\"id\": \"$bloom\", \"status\": \"ready\", \"bloomed_from\": \"$bucket\"}]" "$ARC_FILE"
        found="true"
        break
      fi
    done
    [[ -z "$found" ]] && die "Seed '$bloom' not found in planted or dormant"
  fi

  # Question add
  local qadd=$(opt "question-add")
  if [[ -n "$qadd" ]]; then
    local qid="q_$(date +%s)"
    yq -i ".questions += [{\"id\": \"$qid\", \"question\": \"$qadd\", \"pressure\": 10, \"status\": \"active\"}]" "$ARC_FILE"
  fi

  # Question resolve
  local qres=$(opt "question-resolve")
  if [[ -n "$qres" ]]; then
    yq -i ".questions[$qres].status = \"answered\"" "$ARC_FILE"
  fi

  # Update timestamp
  if [[ -n "$turn" ]]; then
    yq -i ".turn_last_updated = $turn | .last_updated = \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" "$ARC_FILE"
  fi

  echo "OK: arc updated"
}

# ==========================================
# FACTS DOMAIN — append + query
# ==========================================

facts_usage() {
  cat <<'EOF'
facts domain — established facts, secrets, barriers, appearances, factoids

Write:
  campaign.sh $CP facts add --turn=N --fact=TEXT --entities=a,b
  campaign.sh $CP facts add-secret --turn=N --secret=TEXT --known-by=CHAR
  campaign.sh $CP facts reveal-secret --id=N --to=CHAR --turn=N
  campaign.sh $CP facts add-barrier --character=CHAR --does-not-know=TEXT [--dramatic-irony]
  campaign.sh $CP facts add-world-event --turn=N --event=TEXT --category=CAT
  campaign.sh $CP facts appearance --entity=ID --turn=N --context=TEXT
  campaign.sh $CP facts add-factoid --turn=N --factoid=TEXT --context=TEXT

Query:
  campaign.sh $CP facts query --secrets [--character=X]
  campaign.sh $CP facts query --barriers
  campaign.sh $CP facts query --entities=a,b [--since=N]
  campaign.sh $CP facts query --world-events [--since=N]
  campaign.sh $CP facts query --for-turn=N
  campaign.sh $CP facts query --last-seen=ENTITY
  campaign.sh $CP facts query --last-seen --all
  campaign.sh $CP facts query --factoids [--since=N]
EOF
  exit 1
}

cmd_facts() {
  local action="$1"; shift
  case "$action" in
    add)             facts_add "$@" ;;
    add-secret)      facts_add_secret "$@" ;;
    reveal-secret)   facts_reveal_secret "$@" ;;
    add-barrier)     facts_add_barrier "$@" ;;
    add-world-event) facts_add_world_event "$@" ;;
    appearance)      facts_appearance "$@" ;;
    add-factoid)     facts_add_factoid "$@" ;;
    query)           facts_query "$@" ;;
    --help|-h)       facts_usage ;;
    *)               facts_usage ;;
  esac
}

facts_init() {
  ensure_file "$CONTINUITY_FILE" "$(cat <<'YAML'
# continuity.yaml — oracle-focused campaign facts
established_facts: []
revealed_secrets: []
knowledge_barriers: []
world_events: []
appearances: {}
used_factoids: []
YAML
)"
}

facts_add() {
  parse_options "$@"
  facts_init
  local turn=$(opt_or_die "turn")
  local fact=$(opt_or_die "fact")
  local entities=$(opt "entities")

  local entities_arr="[]"
  if [[ -n "$entities" ]]; then
    # Build JSON array from comma-separated list
    entities_arr="["
    local first=true
    IFS=',' read -ra ENT_ARR <<< "$entities"
    for ent in "${ENT_ARR[@]}"; do
      [[ "$first" == "true" ]] && first=false || entities_arr+=","
      entities_arr+="\"$ent\""
    done
    entities_arr+="]"
  fi

  yq -i ".established_facts += [{
    \"turn\": $turn,
    \"fact\": \"$fact\",
    \"entities\": $entities_arr
  }]" "$CONTINUITY_FILE"
  echo "OK: fact added"
}

facts_add_secret() {
  parse_options "$@"
  facts_init
  local turn=$(opt_or_die "turn")
  local secret=$(opt_or_die "secret")
  local known_by=$(opt_or_die "known-by")

  local known_arr="["
  local first=true
  IFS=',' read -ra KB_ARR <<< "$known_by"
  for kb in "${KB_ARR[@]}"; do
    [[ "$first" == "true" ]] && first=false || known_arr+=","
    known_arr+="\"$kb\""
  done
  known_arr+="]"

  yq -i ".revealed_secrets += [{
    \"turn_established\": $turn,
    \"secret\": \"$secret\",
    \"known_by\": $known_arr,
    \"revealed_to\": []
  }]" "$CONTINUITY_FILE"
  echo "OK: secret added"
}

facts_reveal_secret() {
  parse_options "$@"
  facts_init
  local id=$(opt_or_die "id")
  local to=$(opt_or_die "to")
  local turn=$(opt_or_die "turn")

  # id is 0-based index into revealed_secrets
  yq -i ".revealed_secrets[$id].revealed_to += [{\"character\": \"$to\", \"turn\": $turn}]" "$CONTINUITY_FILE"
  # Also add to known_by
  yq -i ".revealed_secrets[$id].known_by += [\"$to\"] | .revealed_secrets[$id].known_by |= unique" "$CONTINUITY_FILE"
  echo "OK: secret revealed to $to"
}

facts_add_barrier() {
  parse_options "$@"
  facts_init
  local character=$(opt_or_die "character")
  local does_not_know=$(opt_or_die "does-not-know")
  local dramatic_irony=$(opt "dramatic-irony")

  local di_val="false"
  [[ "$dramatic_irony" == "true" ]] && di_val="true"

  yq -i ".knowledge_barriers += [{
    \"character\": \"$character\",
    \"does_not_know\": \"$does_not_know\",
    \"dramatic_irony\": $di_val
  }]" "$CONTINUITY_FILE"
  echo "OK: barrier added"
}

facts_add_world_event() {
  parse_options "$@"
  facts_init
  local turn=$(opt_or_die "turn")
  local event=$(opt_or_die "event")
  local category=$(opt "category")

  yq -i ".world_events += [{
    \"turn\": $turn,
    \"event\": \"$event\",
    \"category\": \"${category:-unspecified}\"
  }]" "$CONTINUITY_FILE"
  echo "OK: world event added"
}

facts_appearance() {
  parse_options "$@"
  facts_init
  local entity=$(opt_or_die "entity")
  local turn=$(opt_or_die "turn")
  local context=$(opt_or_die "context")

  # Upsert: overwrite last-seen for this entity
  yq -i ".appearances.\"$entity\" = {
    \"last_turn\": $turn,
    \"context\": \"$context\"
  }" "$CONTINUITY_FILE"
  echo "OK: appearance logged for $entity"
}

facts_add_factoid() {
  parse_options "$@"
  facts_init
  local turn=$(opt_or_die "turn")
  local factoid=$(opt_or_die "factoid")
  local context=$(opt_or_die "context")

  yq -i ".used_factoids += [{
    \"turn\": $turn,
    \"factoid\": \"$factoid\",
    \"context\": \"$context\"
  }]" "$CONTINUITY_FILE"
  echo "OK: factoid logged"
}

facts_query() {
  parse_options "$@"
  facts_init

  # --secrets [--character=X]
  if [[ -n "$(opt "secrets")" ]]; then
    local char=$(opt "character")
    if [[ -n "$char" ]]; then
      yq ".revealed_secrets[] | select(.known_by[] == \"$char\")" "$CONTINUITY_FILE"
    else
      yq ".revealed_secrets" "$CONTINUITY_FILE"
    fi
    return
  fi

  # --barriers
  if [[ -n "$(opt "barriers")" ]]; then
    yq ".knowledge_barriers" "$CONTINUITY_FILE"
    return
  fi

  # --entities=a,b [--since=N]
  local entities=$(opt "entities")
  if [[ -n "$entities" ]]; then
    local since=$(opt "since")
    local since_filter=""
    [[ -n "$since" ]] && since_filter="and .turn >= $since"

    # Query established_facts matching any of the entity names
    IFS=',' read -ra ENTITY_ARR <<< "$entities"
    for ent in "${ENTITY_ARR[@]}"; do
      echo "--- facts for: $ent ---"
      if [[ -n "$since" ]]; then
        yq ".established_facts[] | select(.entities[] == \"$ent\" and .turn >= $since)" "$CONTINUITY_FILE"
      else
        yq ".established_facts[] | select(.entities[] == \"$ent\")" "$CONTINUITY_FILE"
      fi
    done
    return
  fi

  # --world-events [--since=N]
  if [[ -n "$(opt "world-events")" ]]; then
    local since=$(opt "since")
    if [[ -n "$since" ]]; then
      yq ".world_events[] | select(.turn >= $since)" "$CONTINUITY_FILE"
    else
      yq ".world_events" "$CONTINUITY_FILE"
    fi
    return
  fi

  # --for-turn=N — everything relevant to a turn
  local for_turn=$(opt "for-turn")
  if [[ -n "$for_turn" ]]; then
    echo "--- facts from turn $for_turn ---"
    yq ".established_facts[] | select(.turn == $for_turn)" "$CONTINUITY_FILE"
    echo "--- secrets from turn $for_turn ---"
    yq ".revealed_secrets[] | select(.turn_established == $for_turn)" "$CONTINUITY_FILE"
    echo "--- world events from turn $for_turn ---"
    yq ".world_events[] | select(.turn == $for_turn)" "$CONTINUITY_FILE"
    return
  fi

  # --last-seen=ENTITY or --last-seen --all
  local last_seen=$(opt "last-seen")
  if [[ -n "$last_seen" ]]; then
    if [[ "$last_seen" == "true" ]]; then
      # --last-seen --all
      local all=$(opt "all")
      if [[ "$all" == "true" ]]; then
        yq ".appearances" "$CONTINUITY_FILE"
      else
        die "Use --last-seen=ENTITY or --last-seen --all"
      fi
    else
      yq ".appearances.\"$last_seen\"" "$CONTINUITY_FILE"
    fi
    return
  fi

  # --factoids [--since=N]
  if [[ -n "$(opt "factoids")" ]]; then
    local since=$(opt "since")
    if [[ -n "$since" ]]; then
      yq ".used_factoids[] | select(.turn >= $since)" "$CONTINUITY_FILE"
    else
      yq ".used_factoids" "$CONTINUITY_FILE"
    fi
    return
  fi

  facts_usage
}

# ==========================================
# TIMELINE DOMAIN — structured time tracking
# ==========================================

timeline_usage() {
  cat <<'EOF'
timeline domain — structured time tracking

  campaign.sh $CP timeline add --turn=N --day=N --period=PERIOD --summary=TEXT
  campaign.sh $CP timeline current
  campaign.sh $CP timeline get --turn=N | --day=N
  campaign.sh $CP timeline range --from=N --to=N
EOF
  exit 1
}

cmd_timeline() {
  local action="$1"; shift
  case "$action" in
    add)     timeline_add "$@" ;;
    current) timeline_current ;;
    get)     timeline_get "$@" ;;
    range)   timeline_range "$@" ;;
    --help|-h) timeline_usage ;;
    *)       timeline_usage ;;
  esac
}

timeline_init() {
  ensure_file "$TIMELINE_FILE" "$(cat <<'YAML'
# timeline.yaml — canonical time tracking
campaign_start: ""
entries: []
YAML
)"
}

timeline_add() {
  parse_options "$@"
  timeline_init
  local turn=$(opt_or_die "turn")
  local day=$(opt_or_die "day")
  local period=$(opt_or_die "period")
  local summary=$(opt_or_die "summary")
  local time_skip=$(opt "time-skip")
  local hour=$(opt "hour")

  local entry="{\"turn\": $turn, \"day\": $day, \"period\": \"$period\", \"summary\": \"$summary\"}"
  [[ -n "$time_skip" ]] && entry=$(echo "$entry" | yq ".time_skip = \"$time_skip\"")
  [[ -n "$hour" ]] && entry=$(echo "$entry" | yq ".hour = $hour")

  yq -i ".entries += [$entry]" "$TIMELINE_FILE"
  echo "OK: timeline entry added for turn $turn"
}

timeline_current() {
  timeline_init
  yq ".entries[-1]" "$TIMELINE_FILE"
}

timeline_get() {
  parse_options "$@"
  timeline_init

  local turn=$(opt "turn")
  local day=$(opt "day")

  if [[ -n "$turn" ]]; then
    yq ".entries[] | select(.turn == $turn)" "$TIMELINE_FILE"
  elif [[ -n "$day" ]]; then
    yq ".entries[] | select(.day == $day)" "$TIMELINE_FILE"
  else
    timeline_usage
  fi
}

timeline_range() {
  parse_options "$@"
  timeline_init
  local from=$(opt_or_die "from")
  local to=$(opt_or_die "to")
  yq ".entries[] | select(.turn >= $from and .turn <= $to)" "$TIMELINE_FILE"
}

# ==========================================
# EPISODE DOMAIN — entity episode management
# ==========================================

episode_usage() {
  cat <<'EOF'
episode domain — entity episode management

  campaign.sh $CP episode append <entity_file> --turn=N --event=TEXT [--trait-changes=TRAIT:+N,...]
  campaign.sh $CP episode list <entity_file> [--since=N]
  campaign.sh $CP episode traits <entity_file>
EOF
  exit 1
}

cmd_episode() {
  local action="$1"; shift
  case "$action" in
    append) episode_append "$@" ;;
    list)   episode_list "$@" ;;
    traits) episode_traits "$@" ;;
    --help|-h) episode_usage ;;
    *)      episode_usage ;;
  esac
}

episode_append() {
  # First positional arg is entity file path
  local entity_file="$1"; shift
  [[ ! -f "$entity_file" ]] && die "Entity file not found: $entity_file"

  parse_options "$@"
  local turn=$(opt_or_die "turn")
  local event=$(opt_or_die "event")
  local trait_changes=$(opt "trait-changes")

  # Build episode entry as temp YAML file (avoids yq inline parsing issues)
  local tmpfile
  tmpfile=$(mktemp /tmp/episode-XXXXXX.yaml)
  trap "rm -f $tmpfile" RETURN

  cat > "$tmpfile" <<EYAML
turn: $turn
event: "$event"
EYAML

  if [[ -n "$trait_changes" ]]; then
    echo "trait_changes:" >> "$tmpfile"
    IFS=',' read -ra TC_ARR <<< "$trait_changes"
    for tc in "${TC_ARR[@]}"; do
      local trait="${tc%%:*}"
      local delta="${tc#*:}"
      delta="${delta#+}"  # Strip leading +
      echo "  $trait: $delta" >> "$tmpfile"
    done
  fi

  # Ensure episodes array exists
  local has_episodes
  has_episodes=$(yq '.episodes // "null"' "$entity_file")
  if [[ "$has_episodes" == "null" ]]; then
    yq -i '.episodes = []' "$entity_file"
  fi

  # Append episode from temp file
  yq -i ".episodes += [load(\"$tmpfile\")]" "$entity_file"

  # If trait changes, update traits.evolved pressures
  if [[ -n "$trait_changes" ]]; then
    IFS=',' read -ra TC_ARR <<< "$trait_changes"
    for tc in "${TC_ARR[@]}"; do
      local trait="${tc%%:*}"
      local delta="${tc#*:}"
      # Check if trait exists in evolved
      local existing
      existing=$(yq ".traits.evolved.\"$trait\".pressure // \"null\"" "$entity_file" 2>/dev/null || echo "null")
      if [[ "$existing" == "null" ]]; then
        # New evolved trait
        yq -i ".traits.evolved.\"$trait\" = {\"pressure\": ${delta#+}, \"baseline\": 0, \"decay_type\": \"acute\", \"last_pressured\": $turn}" "$entity_file"
      else
        # Update existing
        local new_pressure=$((existing + delta))
        [[ $new_pressure -lt 0 ]] && new_pressure=0
        yq -i ".traits.evolved.\"$trait\".pressure = $new_pressure" "$entity_file"
        # Update last_pressured only if pressure increased
        if [[ "${delta:0:1}" != "-" && "$delta" != "0" ]]; then
          yq -i ".traits.evolved.\"$trait\".last_pressured = $turn" "$entity_file"
        fi
      fi
    done
  fi

  echo "OK: episode appended to $(basename "$entity_file")"
}

episode_list() {
  local entity_file="$1"; shift
  [[ ! -f "$entity_file" ]] && die "Entity file not found: $entity_file"

  parse_options "$@"
  local since=$(opt "since")

  if [[ -n "$since" ]]; then
    yq ".episodes[] | select(.turn >= $since)" "$entity_file"
  else
    yq ".episodes" "$entity_file"
  fi
}

episode_traits() {
  local entity_file="$1"
  [[ ! -f "$entity_file" ]] && die "Entity file not found: $entity_file"
  yq ".traits.evolved" "$entity_file"
}

# ==========================================
# TRAJECTORY DOMAIN — Chekhov's guns
# ==========================================

trajectory_usage() {
  cat <<'EOF'
trajectory domain — Chekhov's guns (committed futures)

  campaign.sh $CP trajectory add --id=ID --desc=TEXT --deadline=N [--source=TEXT] [--category=CAT] [--weight=WEIGHT] [--interruptible-by=TEXT]
  campaign.sh $CP trajectory fire --id=ID --turn=N --outcome=TEXT
  campaign.sh $CP trajectory interrupt --id=ID --turn=N --reason=TEXT
  campaign.sh $CP trajectory list [--include-archived]
EOF
  exit 1
}

cmd_trajectory() {
  local action="$1"; shift
  case "$action" in
    add)       trajectory_add "$@" ;;
    fire)      trajectory_fire "$@" ;;
    interrupt) trajectory_interrupt "$@" ;;
    list)      trajectory_list "$@" ;;
    --help|-h) trajectory_usage ;;
    *)         trajectory_usage ;;
  esac
}

trajectory_init() {
  ensure_file "$TRAJECTORIES_FILE" "$(cat <<'YAML'
# trajectories.yaml — Chekhov's guns
trajectories: []
archived_fired: []
archived_interrupted: []
YAML
)"
}

trajectory_add() {
  parse_options "$@"
  trajectory_init
  local id=$(opt_or_die "id")
  local desc=$(opt_or_die "desc")
  local deadline=$(opt_or_die "deadline")
  local source=$(opt "source")
  local category=$(opt "category")
  local weight=$(opt "weight")
  local interruptible=$(opt "interruptible-by")

  local entry="{
    \"id\": \"$id\",
    \"outcome_when_fires\": \"$desc\",
    \"fires_at_turn\": $deadline,
    \"setup_turn\": ${OPTS[turn]:-$deadline},
    \"source\": \"${source:-unspecified}\",
    \"category\": \"${category:-consequence}\",
    \"weight_when_firing\": \"${weight:-medium}\"
  }"

  if [[ -n "$interruptible" ]]; then
    entry=$(echo "$entry" | yq ".interruptible_by = [\"$interruptible\"]")
  fi

  yq -i ".trajectories += [$entry]" "$TRAJECTORIES_FILE"
  echo "OK: trajectory '$id' added, fires at turn $deadline"
}

trajectory_fire() {
  parse_options "$@"
  trajectory_init
  local id=$(opt_or_die "id")
  local turn=$(opt_or_die "turn")
  local outcome=$(opt_or_die "outcome")

  # Extract trajectory
  local exists
  exists=$(yq ".trajectories[] | select(.id == \"$id\") | .id" "$TRAJECTORIES_FILE" 2>/dev/null || true)
  [[ -z "$exists" ]] && die "Trajectory '$id' not found in active trajectories"

  # Move to archived_fired
  local traj
  traj=$(yq ".trajectories[] | select(.id == \"$id\")" "$TRAJECTORIES_FILE")
  yq -i "del(.trajectories[] | select(.id == \"$id\"))" "$TRAJECTORIES_FILE"

  # Ensure archived_fired exists
  local has_archive
  has_archive=$(yq '.archived_fired // "null"' "$TRAJECTORIES_FILE")
  [[ "$has_archive" == "null" ]] && yq -i '.archived_fired = []' "$TRAJECTORIES_FILE"

  yq -i ".archived_fired += [{
    \"id\": \"$id\",
    \"fired_at_turn\": $turn,
    \"outcome\": \"$outcome\"
  }]" "$TRAJECTORIES_FILE"

  echo "OK: trajectory '$id' fired at turn $turn"
}

trajectory_interrupt() {
  parse_options "$@"
  trajectory_init
  local id=$(opt_or_die "id")
  local turn=$(opt_or_die "turn")
  local reason=$(opt_or_die "reason")

  local exists
  exists=$(yq ".trajectories[] | select(.id == \"$id\") | .id" "$TRAJECTORIES_FILE" 2>/dev/null || true)
  [[ -z "$exists" ]] && die "Trajectory '$id' not found in active trajectories"

  yq -i "del(.trajectories[] | select(.id == \"$id\"))" "$TRAJECTORIES_FILE"

  local has_archive
  has_archive=$(yq '.archived_interrupted // "null"' "$TRAJECTORIES_FILE")
  [[ "$has_archive" == "null" ]] && yq -i '.archived_interrupted = []' "$TRAJECTORIES_FILE"

  yq -i ".archived_interrupted += [{
    \"id\": \"$id\",
    \"interrupted_at_turn\": $turn,
    \"reason\": \"$reason\"
  }]" "$TRAJECTORIES_FILE"

  echo "OK: trajectory '$id' interrupted at turn $turn"
}

trajectory_list() {
  parse_options "$@"
  trajectory_init

  local include_archived=$(opt "include-archived")
  if [[ "$include_archived" == "true" ]]; then
    yq '{
      "active": .trajectories,
      "fired": .archived_fired,
      "interrupted": .archived_interrupted
    }' "$TRAJECTORIES_FILE"
  else
    yq ".trajectories" "$TRAJECTORIES_FILE"
  fi
}

# ==========================================
# MAIN
# ==========================================

[[ $# -lt 3 ]] && usage

CAMPAIGN_PATH="$1"; shift
DOMAIN="$1"; shift
ACTION="$1"; shift

# Validate campaign path
[[ ! -d "$CAMPAIGN_PATH" ]] && die "Campaign path not found: $CAMPAIGN_PATH"

# Set file paths
ARC_FILE="$CAMPAIGN_PATH/arc.yaml"
CONTINUITY_FILE="$CAMPAIGN_PATH/continuity.yaml"
TIMELINE_FILE="$CAMPAIGN_PATH/timeline.yaml"
TRAJECTORIES_FILE="$CAMPAIGN_PATH/trajectories.yaml"

case "$DOMAIN" in
  arc)        cmd_arc "$ACTION" "$@" ;;
  facts)      cmd_facts "$ACTION" "$@" ;;
  timeline)   cmd_timeline "$ACTION" "$@" ;;
  episode)    cmd_episode "$ACTION" "$@" ;;
  trajectory) cmd_trajectory "$ACTION" "$@" ;;
  *)          usage ;;
esac
